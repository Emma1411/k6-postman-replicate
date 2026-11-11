import "server-only";
import { isIP } from "node:net";

/**
 * Extrait l'IP du client depuis X-Forwarded-For.
 * `trustedProxyHops` = nombre de proxys de confiance devant l'app. On lit l'entrée
 * en partant de la droite, car les entrées de gauche peuvent être forgées par le client.
 */
export function getClientIp(headers: Headers, trustedProxyHops: number): string {
  if (trustedProxyHops <= 0) return "unknown";
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const parts = forwarded
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const candidate = parts[parts.length - trustedProxyHops];
  return candidate && isIP(candidate) !== 0 ? candidate : "unknown";
}