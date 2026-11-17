import { toHttpRequest, type RequestDraft } from "@/client/features/requests/model";
import type { ExecutorConfig, LoadScenario, Threshold, WorkflowStep } from "@/shared/schemas";

export type ProfileKind = "ramp" | "constant" | "spike" | "arrival-rate";

export interface ProfileDraft {
  kind: ProfileKind;
  /** Utilisateurs virtuels visés (maximum alloué pour une cadence fixe). */
  vus: number;
  rampUpSeconds: number;
  plateauSeconds: number;
  rampDownSeconds: number;
  /** Requêtes par seconde visées (cadence fixe). */
  rate: number;
  thinkTimeMs: number;
}

export const DEFAULT_PROFILE: ProfileDraft = {
  kind: "ramp",
  vus: 50,
  rampUpSeconds: 30,
  plateauSeconds: 20,
  rampDownSeconds: 10,
  rate: 100,
  thinkTimeMs: 250,
};

export interface CriteriaDraft {
  p95: { enabled: boolean; maxMs: number };
  errors: { enabled: boolean; maxPercent: number };
  checks: { enabled: boolean; minPercent: number };
  failFast: boolean;
  failFastDelaySeconds: number;
}

export const DEFAULT_CRITERIA: CriteriaDraft = {
  p95: { enabled: true, maxMs: 300 },
  errors: { enabled: true, maxPercent: 1 },
  checks: { enabled: true, minPercent: 99 },
  failFast: false,
  failFastDelaySeconds: 10,
};

/** Durée de la montée et de la descente d'un pic brutal. */
const SPIKE_SECONDS = 2;
/** Durée de la charge de fond avant et après un pic. */
const SPIKE_BASE_SECONDS = 10;

const int = (n: number, min: number) => Math.max(min, Math.round(Number.isFinite(n) ? n : min));

export function sanitizeProfile(p: ProfileDraft): ProfileDraft {
  return {
    kind: p.kind,
    vus: int(p.vus, 1),
    rampUpSeconds: int(p.rampUpSeconds, 0),
    plateauSeconds: int(p.plateauSeconds, 1),
    rampDownSeconds: int(p.rampDownSeconds, 0),
    rate: int(p.rate, 1),
    thinkTimeMs: int(p.thinkTimeMs, 0),
  };
}

const spikeBase = (vus: number) => Math.max(1, Math.round(vus * 0.1));

export interface Stage {
  durationSeconds: number;
  target: number;
}

/** Les phases du profil, dans l'ordre. Une phase de durée nulle est omise. */
export function profileStages(input: ProfileDraft): Stage[] {
  const p = sanitizeProfile(input);
  let stages: Stage[];
  switch (p.kind) {
    case "constant":
      stages = [{ durationSeconds: p.plateauSeconds, target: p.vus }];
      break;
    case "arrival-rate":
      stages = [{ durationSeconds: p.plateauSeconds, target: p.rate }];
      break;
    case "spike": {
      const base = spikeBase(p.vus);
      stages = [
        { durationSeconds: SPIKE_BASE_SECONDS, target: base },
        { durationSeconds: SPIKE_SECONDS, target: p.vus },
        { durationSeconds: p.plateauSeconds, target: p.vus },
        { durationSeconds: SPIKE_SECONDS, target: base },
        { durationSeconds: SPIKE_BASE_SECONDS, target: base },
      ];
      break;
    }
    default:
      stages = [
        { durationSeconds: p.rampUpSeconds, target: p.vus },
        { durationSeconds: p.plateauSeconds, target: p.vus },
        { durationSeconds: p.rampDownSeconds, target: 0 },
      ];
  }
  return stages.filter((s) => s.durationSeconds >= 1);
}

export const totalDurationSeconds = (p: ProfileDraft): number =>
  profileStages(p).reduce((total, s) => total + s.durationSeconds, 0);

/** `vuCap` : le maximum d'utilisateurs virtuels de l'instance (borne la cadence fixe). */
export function buildExecutor(input: ProfileDraft, vuCap: number): ExecutorConfig {
  const p = sanitizeProfile(input);
  switch (p.kind) {
    case "constant":
      return { type: "constant-vus", vus: p.vus, durationSeconds: p.plateauSeconds };
    case "arrival-rate": {
      const maxVus = Math.max(1, Math.min(vuCap, p.vus));
      const preAllocatedVus = Math.max(1, Math.min(maxVus, Math.ceil(p.rate * 0.2)));
      return {
        type: "constant-arrival-rate",
        rate: p.rate,
        timeUnitSeconds: 1,
        durationSeconds: p.plateauSeconds,
        preAllocatedVus,
        maxVus,
      };
    }
    default:
      return {
        type: "ramping-vus",
        startVus: p.kind === "spike" ? spikeBase(p.vus) : 0,
        stages: profileStages(p),
      };
  }
}

const num = (n: number) => String(Number(n.toFixed(6)));

/**
 * Le critère sur les vérifications n'a de sens que si la requête a des assertions :
 * sans elles, la métrique n'a aucune donnée et le seuil échouerait.
 */
export function buildThresholds(c: CriteriaDraft, hasAssertions: boolean): Threshold[] {
  const abort = { abortOnFail: c.failFast, delayAbortEvalSeconds: c.failFast ? int(c.failFastDelaySeconds, 0) : 0 };
  const out: Threshold[] = [];
  if (c.p95.enabled) out.push({ metric: "http_req_duration", expression: `p(95)<${num(c.p95.maxMs)}`, ...abort });
  if (c.errors.enabled) out.push({ metric: "http_req_failed", expression: `rate<${num(c.errors.maxPercent / 100)}`, ...abort });
  if (c.checks.enabled && hasAssertions) {
    out.push({ metric: "checks", expression: `rate>${num(c.checks.minPercent / 100)}`, ...abort });
  }
  return out;
}

export function scenarioName(draft: RequestDraft): string {
  const named = draft.name.trim();
  if (named) return named.slice(0, 200);
  let target = draft.url.trim();
  try {
    const url = new URL(target);
    target = `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    /* URL avec variables : on garde le texte saisi */
  }
  return `${draft.method} ${target}`.slice(0, 200);
}

export function buildScenario(input: {
  draft: RequestDraft;
  variables: Record<string, string>;
  profile: ProfileDraft;
  criteria: CriteriaDraft;
  vuCap: number;
}): LoadScenario {
  const { draft, variables, profile, criteria, vuCap } = input;
  const name = scenarioName(draft);
  const step: WorkflowStep = {
    id: "step-1",
    name: draft.name.trim() || "Requête",
    request: toHttpRequest(draft),
    extract: [],
    assertions: draft.assertions,
    onError: "stop",
    thinkTimeMs: sanitizeProfile(profile).thinkTimeMs,
  };
  return {
    name,
    workflow: { name, variables, steps: [step] },
    executor: buildExecutor(profile, vuCap),
    thresholds: buildThresholds(criteria, draft.assertions.length > 0),
  };
}

/** Loi de Little : débit ≈ utilisateurs ÷ (temps de réponse + délai de réflexion). */
export function estimateRps(vus: number, responseMs: number, thinkTimeMs: number): number {
  const cycleSeconds = (Math.max(0, responseMs) + Math.max(0, thinkTimeMs)) / 1000;
  return cycleSeconds > 0 ? vus / cycleSeconds : 0;
}