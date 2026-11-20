import { formatInt } from "@/client/lib/format";
import { analyzeRun } from "@/shared/advisor/analyze";
import {
  ObjectivesSchema,
  normalizeAnalyzeInput,
  type MeasuredRun,
  type Threshold,
} from "@/shared/schemas";
import type {
  AnalyzeResult,
  CapacityEvidence,
  Confidence,
} from "@/shared/types/advisor-result";
import type { LoadRunResult, WindowPoint } from "@/shared/types/load-result";
import type { InfraMetrics, InfraSpec } from "@/shared/schemas";

/** Les objectifs que l'Advisor sait lire, déduits des seuils choisis dans l'assistant. */
export function objectivesFromThresholds(thresholds: Threshold[]): {
  p95MaxMs?: number;
  maxErrorRate?: number;
} {
  const out: { p95MaxMs?: number; maxErrorRate?: number } = {};
  for (const t of thresholds) {
    if (t.metric === "http_req_duration") {
      const m = /^p\(95\)\s*<=?\s*(\d+(?:\.\d+)?)$/.exec(t.expression);
      if (m) out.p95MaxMs = Number(m[1]);
    } else if (t.metric === "http_req_failed") {
      const m = /^rate\s*<=?\s*(\d+(?:\.\d+)?)$/.exec(t.expression);
      if (m) out.maxErrorRate = Number(m[1]);
    }
  }
  return out;
}

/**
 * Les mesures d'un test, au format de l'Advisor. L'infrastructure est un espace réservé : le verdict de capacité
 * n'en dépend pas (le dimensionnement la demandera à l'utilisateur à l'étape suivante).
 */
export function toMeasuredRun(
  points: WindowPoint[],
  generatorSaturated: boolean,
  label?: string,
  options: { infra?: InfraSpec; infraMetrics?: InfraMetrics } = {},
): MeasuredRun | null {
  if (points.length < 2) return null;
  return {
    label,
    infra: options.infra ?? {
      instances: 1,
      vcpuPerInstance: 1,
      ramGbPerInstance: 1,
    },
    points: points.map((p) => ({
      t: p.t,
      vus: p.vus,
      requests: p.requests,
      rps: p.rps,
      failed: p.failed,
      duration: p.duration
        ? {
            avg: p.duration.avg,
            med: p.duration.med,
            p95: p.duration.p95,
            p99: p.duration.p99,
          }
        : null,
      dropped: 0,
    })),
    ...(options.infraMetrics ? { infraMetrics: options.infraMetrics } : {}),
    generatorSaturated,
  };
}

/** Analyse du test. null si les mesures sont insuffisantes ou si l'analyse échoue. */
export function analyzeLoadRun(
  points: WindowPoint[],
  result: Pick<LoadRunResult, "generator" | "name">,
  thresholds: Threshold[],
): AnalyzeResult | null {
  const run = toMeasuredRun(
    points,
    result.generator.saturated,
    result.name.slice(0, 100),
  );
  if (!run) return null;
  try {
    const objectives = ObjectivesSchema.parse(
      objectivesFromThresholds(thresholds),
    );
    return analyzeRun(normalizeAnalyzeInput({ run, objectives }));
  } catch {
    return null;
  }
}

const rps = (n: number) => `${formatInt(Math.round(n))} requêtes/seconde`;
const ms = (n: number) => `${formatInt(Math.round(n))} ms`;

/** p95 le plus bas parmi les premières fenêtres : la latence quand la charge est encore minimale. */
export function baselineP95(points: WindowPoint[]): number | null {
  const early = points
    .slice(0, 5)
    .flatMap((p) => (p.duration !== null ? [p.duration.p95] : []));
  return early.length > 0 ? Math.min(...early) : null;
}

/** Le palier : les fenêtres où au moins 90 % du maximum d'utilisateurs est atteint. null s'il dure moins de 3 secondes. */
export function plateauRps(points: WindowPoint[]): { rps: number; vus: number; avgMs: number | null } | null {
  const maxVus = points.reduce((max, p) => Math.max(max, p.vus), 0);
  if (maxVus <= 0) return null;
  const plateau = points.filter((p) => p.vus >= maxVus * 0.9);
  if (plateau.length < 3) return null;

  const sorted = plateau.map((p) => p.rps).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const rps = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  // Temps de réponse moyen pondéré par le nombre de requêtes de chaque fenêtre.
  let weighted = 0;
  let count = 0;
  for (const p of plateau) {
    if (p.duration !== null && p.requests > 0) {
      weighted += p.duration.avg * p.requests;
      count += p.requests;
    }
  }
  return { rps, vus: maxVus, avgMs: count > 0 ? weighted / count : null };
}

/** Ce qui se passe après la limite, déduit des fenêtres où le débit l'a dépassée. */
function afterBreach(
  points: WindowPoint[],
  breachRps: number,
  p95MaxMs: number | undefined,
): string {
  const after = points.filter((p) => p.rps >= breachRps);
  const clauses: string[] = [];
  if (
    p95MaxMs !== undefined &&
    after.some((p) => p.duration !== null && p.duration.p95 > p95MaxMs)
  ) {
    clauses.push("le p95 dépasse ton objectif");
  }
  if (after.some((p) => p.failed > 0)) clauses.push("des erreurs apparaissent");
  return clauses.length > 0
    ? clauses.join(" et ")
    : "tes objectifs ne sont plus respectés";
}

export function buildHeadline(
  capacity: CapacityEvidence | null,
  points: WindowPoint[],
  p95MaxMs?: number,
): string {
  if (!capacity || capacity.kind === "unknown")
    return "Ce test ne permet pas de conclure sur la capacité de ton API.";
  const { sustainedRps, breachRps, loadRange } = capacity;
  switch (capacity.kind) {
    case "bracketed":
      if (sustainedRps === null || breachRps === null) break;
      return `Ton API tient ${rps(sustainedRps)} en respectant tes objectifs. Au-delà d'environ ${rps(breachRps)}, ${afterBreach(points, breachRps, p95MaxMs)}.`;
    case "lower-bound":
      return `Ton API tient au moins ${rps(sustainedRps ?? loadRange.maxRps)} en respectant tes objectifs : la limite n'a pas été atteinte pendant ce test.`;
    case "upper-bound": {
      const base = baselineP95(points);
      if (p95MaxMs !== undefined && base !== null && base > p95MaxMs) {
        return `Ton API ne respecte pas tes objectifs, même à charge minimale : le p95 est déjà de ${ms(base)} dès ${rps(loadRange.minRps)}, pour un objectif de ${ms(p95MaxMs)}. Le temps de réponse d'une seule requête est trop long : réduis-le avant de dimensionner l'infrastructure.`;
      }
      return `Ton API ne respecte déjà plus tes objectifs à ${rps(breachRps ?? loadRange.minRps)} : sa capacité est inférieure ou égale à ce niveau.`;
    }
    default:
      break;
  }
  return "Ce test ne permet pas de conclure sur la capacité de ton API.";
}

export function assessConfidence(
  capacity: CapacityEvidence | null,
  reliable: boolean,
  pointCount: number,
  baselineBreached = false,
): { level: Confidence; reason: string } {
  if (!reliable)
    return {
      level: "low",
      reason:
        "Le générateur de charge était saturé : les mesures sont peu fiables.",
    };
  if (!capacity || capacity.kind === "unknown") {
    return {
      level: "low",
      reason:
        "Le test ne contient pas assez de variation de charge pour situer la capacité.",
    };
  }
  if (pointCount < 30)
    return {
      level: "low",
      reason: "Le test est court : moins de 30 secondes de mesures.",
    };

  if (baselineBreached) {
    return {
      level: "medium",
      reason:
        "Le p95 dépasse l'objectif dès la charge minimale : le diagnostic est net, mais la capacité réelle ne pourra être située qu'une fois le temps de réponse d'une requête sous l'objectif.",
    };
  }
  if (capacity.kind === "bracketed") {
    return {
      level: "medium",
      reason:
        "Un seul test : relance-le pour confirmer, la confiance monte avec les répétitions.",
    };
  }
  return {
    level: "low",
    reason:
      "La limite n'est pas encadrée : une montée en charge plus progressive la situerait précisément.",
  };
}

export type Tone = "success" | "warning" | "danger" | "neutral";

export function statusLabel(result: LoadRunResult): {
  label: string;
  tone: Tone;
} {
  switch (result.status) {
    case "passed":
      return result.generator.saturated
        ? {
            label: "Réussi avec avertissement : générateur saturé",
            tone: "warning",
          }
        : { label: "Réussi", tone: "success" };
    case "failed":
      return { label: "Seuil non respecté", tone: "warning" };
    case "aborted":
      return { label: "Interrompu", tone: "neutral" };
    default:
      return { label: "Erreur", tone: "danger" };
  }
}

export interface Verdict {
  headline: string;
  capacity: CapacityEvidence | null;
  confidence: { level: Confidence; reason: string };
  status: { label: string; tone: Tone };
  analysis: AnalyzeResult | null;
}

export function buildVerdict(
  result: LoadRunResult,
  points: WindowPoint[],
  thresholds: Threshold[],
): Verdict {
  const analysis = analyzeLoadRun(points, result, thresholds);
  const capacity = analysis?.capacity ?? null;
  const { p95MaxMs } = objectivesFromThresholds(thresholds);

  const base = baselineP95(points);
  const baselineBreached =
    p95MaxMs !== undefined && base !== null && base > p95MaxMs;

  return {
    headline: buildHeadline(capacity, points, p95MaxMs),
    capacity,
    confidence: assessConfidence(
      capacity,
      analysis?.dataQuality.reliable ?? !result.generator.saturated,
      points.length,
      baselineBreached,
    ),
    status: statusLabel(result),
    analysis,
  };
}

export interface Kpis {
  sustainedRps: number | null;
  breachRps: number | null;
  p95Ms: number | null;
  errorRate: number | null;
  failed: number;
  total: number;
  peakRps: number;
  avgRps: number;
}

export function buildKpis(
  result: LoadRunResult,
  capacity: CapacityEvidence | null,
  points: WindowPoint[],
): Kpis {
  const { snapshot } = result;
  return {
    sustainedRps: capacity?.sustainedRps ?? null,
    breachRps: capacity?.breachRps ?? null,
    p95Ms: snapshot.http_req_duration?.p95 ?? null,
    errorRate: snapshot.http_req_failed.rate,
    failed: snapshot.http_req_failed.fails,
    total: snapshot.http_req_failed.total,
    // La dernière fenêtre est partielle (fin du test) : son débit est gonflé, on ne la compte pas.
    peakRps: (points.length > 5 ? points.slice(0, -1) : points).reduce(
      (max, p) => Math.max(max, p.rps),
      0,
    ),
    avgRps: snapshot.http_reqs.rate,
  };
}
