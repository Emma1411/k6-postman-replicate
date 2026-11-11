import "server-only";

import dns from "node:dns";
import { BlockList, isIP } from "node:net";

import { AppError } from "@/server/utils/errors";
import type { Limits } from "@/server/config/limits";

/**
 * Plages IPv4 privées, réservées ou non routables.
 */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * Plages IPv6 privées, réservées ou non routables.
 */
const BLOCKED_V6: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

/**
 * Conversion IPv4 vers entier non signé 32 bits.
 */
function ipv4ToNumber(address: string): number {
  return address
    .split(".")
    .reduce((result, octet) => (result * 256 + Number(octet)) >>> 0, 0);
}

/**
 * Vérifie si une IPv4 appartient à un sous-réseau CIDR.
 */
function isInIPv4Subnet(
  address: string,
  network: string,
  prefix: number,
): boolean {
  const ip = ipv4ToNumber(address);
  const base = ipv4ToNumber(network);

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (ip & mask) >>> 0 === (base & mask) >>> 0;
}

/**
 * BlockList est conservé uniquement pour IPv6.
 */
const blockedV6 = new BlockList();

for (const [network, prefix] of BLOCKED_V6) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
];

/**
 * Une adresse invalide est considérée comme bloquée.
 * Politique fail-closed.
 */
export function isBlockedAddress(raw: string): boolean {
  const address = raw.split("%")[0];
  const family = isIP(address);

  // Adresse invalide.
  if (family === 0) {
    return true;
  }

  // IPv4 : comparaison CIDR explicite.
  if (family === 4) {
    return BLOCKED_V4.some(([network, prefix]) =>
      isInIPv4Subnet(address, network, prefix),
    );
  }

  // IPv4-mapped IPv6 : refus systématique.
  if (address.toLowerCase().startsWith("::ffff:")) {
    return true;
  }

  // IPv6 : vérification BlockList.
  return blockedV6.check(address, "ipv6");
}

/**
 * Vérification des noms d'hôtes locaux ou internes.
 */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");

  return (
    BLOCKED_HOSTNAMES.has(h) ||
    BLOCKED_SUFFIXES.some((suffix) => h.endsWith(suffix))
  );
}

/**
 * Résolution DNS.
 */
export interface ResolvedAddress {
  address: string;
  family: number;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const DNS_TIMEOUT_MS = 5_000;

/**
 * Résolveur DNS par défaut.
 */
export const defaultResolver: Resolver = async (hostname) => {
  const lookup = dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
  });

  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new AppError("TIMEOUT", "Résolution DNS trop longue."));
    }, DNS_TIMEOUT_MS);
  });

  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Destination validée.
 */
export interface ValidatedTarget {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
  dnsMs: number | null;
  allowPrivateNetworks: boolean;

}

/**
 * Erreur SSRF.
 */
function ssrfBlocked(hostname: string): AppError {
  return new AppError(
    "SSRF_BLOCKED",
    "Destination non autorisée : le serveur refuse d'envoyer des requêtes vers des adresses privées ou internes.",
    { host: hostname },
  );
}

/**
 * Valide une URL de destination.
 *
 * À appeler pour la requête initiale ET pour chaque redirection.
 *
 * Toutes les adresses DNS résolues doivent être autorisées.
 */

export async function validateTarget(
  rawUrl: string,
  limits: Pick<Limits, "network">,
  resolve: Resolver = defaultResolver,
): Promise<ValidatedTarget> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("VALIDATION_ERROR", "URL invalide.");
  }

  // Protocoles autorisés.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Seuls les protocoles http et https sont autorisés.",
    );
  }

  // Identifiants interdits.
  if (url.username || url.password) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Les identifiants dans l'URL sont interdits : utilise la section Authentification.",
    );
  }

  // Normalisation du hostname.
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (!hostname) {
    throw new AppError(
      "VALIDATION_ERROR",
      "URL invalide : hôte manquant.",
    );
  }

  const allowPrivate = limits.network.allowPrivateNetworks;

  // Blocage des noms d'hôtes internes.
  if (!allowPrivate && isBlockedHostname(hostname)) {
    throw ssrfBlocked(hostname);
  }

  let addresses: ResolvedAddress[];
  let dnsMs: number | null = null;

  // Détection des IP littérales.
  const literalFamily = isIP(hostname);

  if (literalFamily !== 0) {
    addresses = [
      {
        address: hostname,
        family: literalFamily,
      },
    ];
  } else {
    const startedAt = performance.now();

    try {
      addresses = await resolve(hostname);
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

      throw new AppError(
        "UPSTREAM_ERROR",
        `Résolution DNS impossible pour ${hostname}.`,
      );
    }

    dnsMs = Math.round(
      (performance.now() - startedAt) * 100,
    ) / 100;
  }

  // Aucun résultat DNS.
  if (addresses.length === 0) {
    throw new AppError(
      "UPSTREAM_ERROR",
      `Aucune adresse trouvée pour ${hostname}.`,
    );
  }

  // Vérification de toutes les adresses obtenues.
  if (
    !allowPrivate &&
    addresses.some(
      (entry) =>
        ![4, 6].includes(entry.family) ||
        isIP(entry.address) !== entry.family ||
        isBlockedAddress(entry.address),
    )
  ) {
    throw ssrfBlocked(hostname);
  }

  // Vérification de cohérence de l'adresse sélectionnée.
  const first = addresses[0];

  const family = isIP(first.address);

  if (family !== 4 && family !== 6) {
    throw ssrfBlocked(hostname);
  }

   return { url, hostname, address: first.address, family: first.family === 6 ? 6 : 4, dnsMs , allowPrivateNetworks: allowPrivate,};
}


/**
 * Callback DNS personnalisé.
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * Lookup épinglé sur l'adresse IP validée.
 *
 * Empêche une nouvelle résolution DNS entre validation
 * et connexion.
 */
export function createPinnedLookup(
  address: string,
  family: 4 | 6,
  allowPrivate = false,
) {
  if (
    isIP(address) !== family ||
    (!allowPrivate && isBlockedAddress(address))
  ) {
    throw new TypeError("Adresse IP non valide ou non autorisée.");
  }

  return function pinnedLookup(
    _hostname: string,
    optionsOrCallback: dns.LookupOptions | LookupCallback,
    maybeCallback?: LookupCallback,
  ): void {
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback;

    const options =
      typeof optionsOrCallback === "function" ? {} : optionsOrCallback;

    if (!callback) {
      throw new TypeError("Callback manquant.");
    }

    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}
