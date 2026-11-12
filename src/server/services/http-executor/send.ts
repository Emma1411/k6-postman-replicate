import "server-only";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";
import type { LookupFunction } from "node:net";
import type { Readable, Transform } from "node:stream";
import type { Timings } from "@/shared/schemas";
import { AppError } from "@/server/utils/errors";
import {
  createPinnedLookup,
  type ValidatedTarget,
} from "@/server/middlewares/ssrf-guard";

export interface SendOptions {
  method: string;
  target: ValidatedTarget;
  headers: Record<string, string>;
  body: Buffer | null;
  /** Délai total demandé (pour le message d'erreur). */
  timeoutMs: number;
  /** Temps restant avant l'échéance globale. */
  remainingMs: number;
  maxResponseBytes: number;
}

export interface HopResult {
  status: number;
  statusText: string;
  headers: Array<{ key: string; value: string }>;
  location: string | null;
  /** Body décodé (décompressé), tronqué à maxResponseBytes. */
  body: Buffer;
  truncated: boolean;
  timings: Omit<Timings, "totalMs">;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function mapNetworkError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const message = (err as Error | undefined)?.message ?? "erreur inconnue";

  switch (code) {
    case "ECONNREFUSED":
      return new AppError(
        "UPSTREAM_ERROR",
        "Connexion refusée par le serveur cible.",
        { code },
      );
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return new AppError("UPSTREAM_ERROR", "Nom d'hôte introuvable.", {
        code,
      });
    case "ECONNRESET":
      return new AppError(
        "UPSTREAM_ERROR",
        "Connexion interrompue par le serveur cible.",
        { code },
      );
    case "ETIMEDOUT":
      return new AppError("UPSTREAM_ERROR", "Délai de connexion dépassé.", {
        code,
      });
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return new AppError("UPSTREAM_ERROR", "Serveur cible injoignable.", {
        code,
      });
  }
  if (
    code &&
    /^(CERT_|ERR_TLS_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/.test(code)
  ) {
    return new AppError(
      "UPSTREAM_ERROR",
      `Erreur de certificat TLS (${code}).`,
      { code },
    );
  }
  if (code?.startsWith("HPE_")) {
    return new AppError(
      "UPSTREAM_ERROR",
      "Réponse HTTP invalide du serveur cible.",
      { code },
    );
  }
  if (code?.startsWith("ERR_INVALID_")) {
    return new AppError("VALIDATION_ERROR", `Requête invalide : ${message}`, {
      code,
    });
  }
  return new AppError("UPSTREAM_ERROR", `Erreur réseau : ${code ?? message}.`, {
    code,
  });
}

function pairHeaders(raw: string[]): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (let i = 0; i + 1 < raw.length; i += 2)
    out.push({ key: raw[i], value: raw[i + 1] });
  return out;
}

export function createDecoder(encoding: string): Transform | null {
  switch (encoding) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null; // identity ou encodage non géré : octets renvoyés tels quels
  }
}

/** Lit le flux en comptant les octets décodés : protège aussi des bombes de décompression. */
export async function collect(
  stream: Readable,
  maxBytes: number,
): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    if (total + buf.length > maxBytes) {
      const remaining = maxBytes - total;
      if (remaining > 0) chunks.push(buf.subarray(0, remaining));
      stream.destroy();
      return { body: Buffer.concat(chunks), truncated: true };
    }
    chunks.push(buf);
    total += buf.length;
  }
  return { body: Buffer.concat(chunks), truncated: false };
}

async function readBody(
  res: http.IncomingMessage,
  method: string,
  maxBytes: number,
): Promise<{ body: Buffer; truncated: boolean }> {
  const status = res.statusCode ?? 0;
  if (
    method === "HEAD" ||
    status === 204 ||
    status === 304 ||
    (status >= 100 && status < 200)
  ) {
    res.on("error", () => {});
    res.resume();
    return { body: Buffer.alloc(0), truncated: false };
  }

  const encoding = String(res.headers["content-encoding"] ?? "")
    .toLowerCase()
    .trim();
  const decoder = createDecoder(encoding);
  let responseFailed = false;
  res.on("error", (err) => {
    responseFailed = true;
    decoder?.destroy(err);
  });

  let source: Readable = res;
  if (decoder) {
    res.pipe(decoder);
    source = decoder;
  }

  try {
    const result = await collect(source, maxBytes);
    if (result.truncated) res.destroy();
    return result;
  } catch (err) {
    if (decoder && !responseFailed) {
      throw new AppError(
        "UPSTREAM_ERROR",
        "Réponse compressée invalide ou corrompue.",
      );
    }
    throw err;
  }
}

/** Envoie une requête (sans suivre les redirections), connexion forcée sur l'adresse validée. */
export function sendOnce(opts: SendOptions): Promise<HopResult> {
  const { target } = opts;
  const isHttps = target.url.protocol === "https:";
  const request = (
    isHttps ? https.request : http.request
  ) as typeof http.request;
  const now = () => performance.now();

  let tSocket: number | undefined;
  let tLookup: number | undefined;
  let tConnect: number | undefined;
  let tSecure: number | undefined;
  let tSent: number | undefined;
  let tFirstByte = 0;
  let timedOut = false;

  const toAppError = (err: unknown): AppError =>
    timedOut
      ? new AppError(
          "TIMEOUT",
          `La requête a dépassé le délai de ${opts.timeoutMs} ms.`,
        )
      : mapNetworkError(err);

  return new Promise<HopResult>((resolve, reject) => {
    let req: http.ClientRequest;
    try {
      req = request({
        hostname: target.hostname,
        port: Number(target.url.port) || (isHttps ? 443 : 80),
        path: `${target.url.pathname}${target.url.search}`,
        method: opts.method,
        headers: opts.headers,
        agent: false, // une connexion neuve par requête : les temps de connexion sont réels
        lookup: createPinnedLookup(
          target.address,
          target.family,
          target.allowPrivateNetworks,
        ) as LookupFunction,
      });
    } catch (err) {
      reject(mapNetworkError(err));
      return;
    }

    const timer = setTimeout(
      () => {
        timedOut = true;
        req.destroy();
      },
      Math.max(1, opts.remainingMs),
    );
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };

    req.on("socket", (socket) => {
      tSocket = now();
      socket.once("lookup", () => {
        tLookup = now();
      });
      socket.once("connect", () => {
        tConnect = now();
      });
      socket.once("secureConnect", () => {
        tSecure = now();
      });
    });
    req.on("finish", () => {
      tSent = now();
    });
    req.on("error", (err) => settle(() => reject(toAppError(err))));

    req.on("response", (res) => {
      tFirstByte = now();
      readBody(res, opts.method, opts.maxResponseBytes).then(
        ({ body, truncated }) => {
          const tEnd = now();
          const sentAt = tSent ?? tSecure ?? tConnect ?? tSocket ?? tFirstByte;
          settle(() =>
            resolve({
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              headers: pairHeaders(res.rawHeaders),
              location:
                typeof res.headers.location === "string"
                  ? res.headers.location
                  : null,
              body,
              truncated,
              timings: {
                dnsMs: target.dnsMs,
                connectMs:
                  tConnect !== undefined
                    ? round(tConnect - (tLookup ?? tSocket ?? tConnect))
                    : null,
                tlsMs:
                  tSecure !== undefined && tConnect !== undefined
                    ? round(tSecure - tConnect)
                    : null,
                ttfbMs: round(Math.max(0, tFirstByte - sentAt)),
                transferMs: round(tEnd - tFirstByte),
              },
            }),
          );
        },
        (err) => settle(() => reject(toAppError(err))),
      );
    });

    req.end(opts.body ?? undefined);
  });
}
