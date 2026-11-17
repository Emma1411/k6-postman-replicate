import type { WindowPoint } from "@/shared/types/load-result";

export interface ChartPoint {
  t: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  rps: number;
  vus: number;
  errors: number;
}

export function toChartData(points: WindowPoint[]): ChartPoint[] {
  return points.map((p) => ({
    t: p.t,
    p50: p.duration?.med ?? null,
    p95: p.duration?.p95 ?? null,
    p99: p.duration?.p99 ?? null,
    rps: p.rps,
    vus: p.vus,
    errors: p.failed,
  }));
}

function peak(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/** Réduit une longue série en gardant les pointes de latence et le total des erreurs de chaque paquet. */
export function downsample(data: ChartPoint[], maxPoints = 600): ChartPoint[] {
  if (data.length <= maxPoints) return data;
  const size = Math.ceil(data.length / maxPoints);
  const out: ChartPoint[] = [];
  for (let i = 0; i < data.length; i += size) {
    const bucket = data.slice(i, i + size);
    out.push({
      t: bucket[bucket.length - 1].t,
      p50: peak(bucket.map((p) => p.p50)),
      p95: peak(bucket.map((p) => p.p95)),
      p99: peak(bucket.map((p) => p.p99)),
      rps: bucket.reduce((s, p) => s + p.rps, 0) / bucket.length,
      vus: bucket[bucket.length - 1].vus,
      errors: bucket.reduce((s, p) => s + p.errors, 0),
    });
  }
  return out;
}

/** Début de la zone de saturation : la première fenêtre au-delà de la limite de débit, sinon du p95 visé. */
export function saturationStart(
  points: WindowPoint[],
  options: { breachRps: number | null; p95MaxMs?: number },
): number | null {
  if (options.breachRps !== null) {
    const hit = points.find((p) => p.rps >= (options.breachRps as number));
    if (hit) return hit.t;
  }
  if (options.p95MaxMs !== undefined) {
    const hit = points.find((p) => p.duration !== null && p.duration.p95 > (options.p95MaxMs as number));
    if (hit) return hit.t;
  }
  return null;
}

export interface StatusRow {
  code: string;
  label: string;
  count: number;
  share: number;
  tone: "success" | "info" | "warning" | "danger";
}

const STATUS_NAMES: Record<string, string> = {
  "200": "OK",
  "201": "Created",
  "204": "No Content",
  "301": "Moved Permanently",
  "302": "Found",
  "304": "Not Modified",
  "400": "Bad Request",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "Not Found",
  "408": "Request Timeout",
  "409": "Conflict",
  "422": "Unprocessable Entity",
  "429": "Too Many Requests",
  "500": "Internal Server Error",
  "502": "Bad Gateway",
  "503": "Service Unavailable",
  "504": "Gateway Timeout",
};

function toneOf(code: string): StatusRow["tone"] {
  if (code === "error") return "danger";
  const first = code[0];
  return first === "2" ? "success" : first === "3" ? "info" : first === "4" ? "warning" : "danger";
}

/** La répartition des statuts : les codes dans l'ordre, puis « aucune réponse » (réseau, délai). */
export function statusRows(distribution: Record<string, number>): StatusRow[] {
  const entries = Object.entries(distribution).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return entries
    .sort(([a], [b]) => (a === "error" ? 1 : b === "error" ? -1 : Number(a) - Number(b)))
    .map(([code, count]) => ({
      code,
      label: code === "error" ? "Aucune réponse (réseau ou délai)" : STATUS_NAMES[code] ? `${code} ${STATUS_NAMES[code]}` : code,
      count,
      share: total === 0 ? 0 : count / total,
      tone: toneOf(code),
    }));
}