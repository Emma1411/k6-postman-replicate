import "server-only";
import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import { AppError } from "@/server/utils/errors";
import type { Limits } from "@/server/config/limits";

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local + serveur de métadonnées cloud (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // réservé + broadcast
];

const BLOCKED_V6: Array<[string, number]> = [
  ["::", 96], // non spécifiée, loopback, IPv4-compatible
  ["::ffff:0:0", 96], // IPv4-mapped : refusé par principe (fail closed)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10],
  ["ff00::", 8], // multicast
];

const blocked = new BlockList();
for (const [net, prefix] of BLOCKED_V4) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of BLOCKED_V6) blocked.addSubnet(net, prefix, "ipv6");

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];

/** Une adresse invalide est considérée comme bloquée (fail closed). */
export function isBlockedAddress(raw: string): boolean {
  const address = raw.split("%")[0]; // retire la zone IPv6 (fe80::1%eth0)
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return BLOCKED_HOSTNAMES.has(h) || BLOCKED_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const DNS_TIMEOUT_MS = 5_000;

export const defaultResolver: Resolver = async (hostname) => {
  const lookup = dns.promises.lookup(hostname, { all: true, verbatim: true });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError("TIMEOUT", "Résolution DNS trop longue.")), DNS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export interface ValidatedTarget {
  url: URL;
  hostname: string;
  /** Adresse validée sur laquelle la connexion doit être forcée (voir createPinnedLookup). */
  address: string;
  family: 4 | 6;
}

function ssrfBlocked(hostname: string): AppError {
  return new AppError(
    "SSRF_BLOCKED",
    "Destination non autorisée : le serveur refuse d'envoyer des requêtes vers des adresses privées ou internes.",
    { host: hostname },
  );
}

/**
 * Valide une URL de destination. À appeler pour la requête initiale ET pour chaque redirection.
 * Toutes les adresses résolues doivent être publiques, sinon la requête est refusée.
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

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("VALIDATION_ERROR", "Seuls les protocoles http et https sont autorisés.");
  }
  if (url.username || url.password) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Les identifiants dans l'URL sont interdits : utilise la section Authentification.",
    );
  }

  // Le parseur WHATWG normalise déjà les IPv4 en décimal/hexa/octal (http://2130706433 → 127.0.0.1).
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!hostname) throw new AppError("VALIDATION_ERROR", "URL invalide : hôte manquant.");

  const allowPrivate = limits.network.allowPrivateNetworks;
  if (!allowPrivate && isBlockedHostname(hostname)) throw ssrfBlocked(hostname);

  let addresses: ResolvedAddress[];
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("UPSTREAM_ERROR", `Résolution DNS impossible pour ${hostname}.`);
    }
  }
  if (addresses.length === 0) {
    throw new AppError("UPSTREAM_ERROR", `Aucune adresse trouvée pour ${hostname}.`);
  }

  if (!allowPrivate && addresses.some((a) => isBlockedAddress(a.address))) {
    throw ssrfBlocked(hostname);
  }

  const first = addresses[0];
  return { url, hostname, address: first.address, family: first.family === 6 ? 6 : 4 };
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * Fonction `lookup` qui renvoie toujours l'adresse déjà validée.
 * Elle empêche le DNS rebinding : entre la validation et la connexion, le nom ne peut pas
 * être résolu vers une autre adresse. L'URL garde son nom d'hôte, donc le SNI et la
 * vérification du certificat TLS continuent d'utiliser le nom.
 */
export function createPinnedLookup(address: string, family: 4 | 6) {
  return function pinnedLookup(
    _hostname: string,
    optionsOrCallback: dns.LookupOptions | LookupCallback,
    maybeCallback?: LookupCallback,
  ): void {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    if (!callback) throw new TypeError("Callback manquant.");
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}