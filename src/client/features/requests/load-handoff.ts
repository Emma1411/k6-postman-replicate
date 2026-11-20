import { getSetting, setSetting } from "@/client/storage/repositories";
import { isRequestDraft, type RequestDraft } from "./model";
import { LoadScenarioSchema, type LoadScenario } from "@/shared/schemas";


const KEY = "pending-load-target";
const SCENARIO_KEY = "pending-load-scenario";


export interface LoadHandoff {
  draft: RequestDraft;
  variables: Record<string, string>;
  createdAt: number;
}

export interface ScenarioHandoff {
  scenario: LoadScenario;
  /** Pourquoi ce scénario est proposé, affiché sur la page Test de charge. */
  label: string;
  createdAt: number;
}

export async function saveScenarioHandoff(handoff: ScenarioHandoff): Promise<void> {
  await setSetting(SCENARIO_KEY, handoff);
}

export async function saveLoadHandoff(handoff: LoadHandoff): Promise<void> {
  await setSetting(KEY, handoff);
}

/** Lit puis supprime la cible transmise. Elle expire après 10 minutes (étape 9.3 : assistant de charge). */
export async function takeLoadHandoff(maxAgeMs = 10 * 60_000, now = Date.now()): Promise<LoadHandoff | null> {
  const value = await getSetting<unknown>(KEY, null);
  if (value === null) return null;
  await setSetting(KEY, null);
  if (typeof value !== "object") return null;
  const h = value as Record<string, unknown>;
  const fresh = typeof h.createdAt === "number" && now - h.createdAt <= maxAgeMs;
  const variablesOk = typeof h.variables === "object" && h.variables !== null;
  return fresh && variablesOk && isRequestDraft(h.draft) ? (value as LoadHandoff) : null;
}

/** Lit puis supprime le scénario transmis. Il expire après 10 minutes ; un scénario invalide est ignoré. */
export async function takeScenarioHandoff(maxAgeMs = 10 * 60_000, now = Date.now()): Promise<ScenarioHandoff | null> {
  const value = await getSetting<unknown>(SCENARIO_KEY, null);
  if (value === null) return null;
  await setSetting(SCENARIO_KEY, null);
  if (typeof value !== "object") return null;
  const h = value as Record<string, unknown>;
  const fresh = typeof h.createdAt === "number" && now - h.createdAt <= maxAgeMs;
  const scenario = LoadScenarioSchema.safeParse(h.scenario);
  if (!fresh || typeof h.label !== "string" || !scenario.success) return null;
  return { scenario: scenario.data, label: h.label, createdAt: h.createdAt as number };
}