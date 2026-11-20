import { apiFetch, apiStream } from "@/client/api/client";
import { ApiError, describeError } from "@/client/api/errors";
import { readLoadEvents } from "@/client/api/sse";
import type { RunRecord } from "@/client/storage/db";
import { deleteRun, listRuns, pruneRuns, saveResult, saveRun } from "@/client/storage/repositories";
import type { AppDispatch, RootState } from "@/client/store";
import type { LoadScenario } from "@/shared/schemas";
import type { LoadRunInfo, LoadRunResult } from "@/shared/types/load-result";
import { connectionChanged, eventReceived, runFailed, runStarting } from "./load-slice";

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface ControllerDeps {
  dispatch: AppDispatch;
  getState: () => RootState;
  sleep?: Sleep;
  /** Délais entre deux tentatives de reconnexion. */
  retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000, 8000, 8000];
/** Le serveur oublie un test 15 minutes après sa fin : on garde une heure de marge pour nettoyer. */
const RUN_RECORD_MAX_AGE_MS = 60 * 60_000;

const defaultSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

let current: AbortController | null = null;

function begin(): AbortController {
  current?.abort();
  current = new AbortController();
  return current;
}

/**
 * Coupe le suivi dans ce navigateur (par exemple en quittant la page).
 * Le test, lui, continue côté serveur : il s'arrête de lui-même 30 secondes après le départ du dernier client.
 */
export function detachFromRun(): void {
  current?.abort();
  current = null;
}

async function recordRun(deps: ControllerDeps, info: LoadRunInfo): Promise<void> {
  try {
    await saveRun({
      runId: info.runId,
      startedAt: info.startedAt ?? Date.now(),
      scenarioName: info.name,
      status: "running",
      scenario: deps.getState().load.scenario ?? undefined,
    });
  } catch {
    /* stockage indisponible : le test reste suivi, mais pas récupérable après un rechargement */
  }
}

async function finalize(deps: ControllerDeps, result: LoadRunResult): Promise<void> {
  const { scenario, points } = deps.getState().load;
  try {
    await saveResult({
      id: result.runId,
      savedAt: Date.now(),
      startedAt: deps.getState().load.run?.startedAt ?? null,
      name: result.name,
      scenario,
      result,
      points,
    });
    await deleteRun(result.runId);
  } catch {
    /* le résultat reste affiché mais ne sera pas dans « Tests précédents » */
  }
}

async function forget(runId: string): Promise<void> {
  try {
    await deleteRun(runId);
  } catch {
    /* sans importance */
  }
}

/** Lit un flux jusqu'au bout. « finished » : le test est terminé ; « ended » : le flux s'est fermé trop tôt. */
async function consume(response: Response, deps: ControllerDeps): Promise<"finished" | "ended"> {
  let recorded = false;
  for await (const event of readLoadEvents(response)) {
    deps.dispatch(eventReceived(event));
    if (event.type === "init" && !recorded) {
      recorded = true;
      if (!event.result) await recordRun(deps, event.run);
    }
    if (event.type === "finished") {
      await finalize(deps, event.result);
      return "finished";
    }
    if (event.type === "init" && event.result) {
      await finalize(deps, event.result);
      return "finished";
    }
  }
  return "ended";
}

/** Se rattache à un test et réessaie en cas de coupure. */
async function follow(runId: string, deps: ControllerDeps, signal: AbortSignal): Promise<void> {
  const delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await apiStream(`/api/load-tests/${encodeURIComponent(runId)}/events`, { signal });
      deps.dispatch(connectionChanged("connected"));
      if ((await consume(response, deps)) === "finished") return;
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof ApiError && err.code === "NOT_FOUND") {
        await forget(runId);
        deps.dispatch(
          runFailed({
            code: "NOT_FOUND",
            title: "Test introuvable",
            hint: "Un test n'est conservé que 15 minutes après sa fin, et jusqu'au redémarrage du serveur.",
            detail: err.message,
          }),
        );
        return;
      }
    }
    if (signal.aborted || attempt === delays.length) break;
    deps.dispatch(connectionChanged("reconnecting"));
    await sleep(delays[attempt], signal);
    if (signal.aborted) return;
  }
  if (!signal.aborted) deps.dispatch(connectionChanged("lost"));
}

/** Lance un test et suit son flux. Le serveur peut refuser le départ : l'erreur est alors dans le store. */
export async function startRun(scenario: LoadScenario, deps: ControllerDeps): Promise<void> {
  const controller = begin();
  deps.dispatch(runStarting(scenario));

  let response: Response;
  try {
    response = await apiStream("/api/load-tests/run", { body: { scenario }, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) return;
    deps.dispatch(runFailed({ code: err instanceof ApiError ? err.code : "UNKNOWN", ...describeError(err) }));
    return;
  }

  try {
    if ((await consume(response, deps)) === "finished") return;
  } catch {
    /* coupure du flux : on tente de se rattacher */
  }
  if (controller.signal.aborted) return;

  const runId = deps.getState().load.run?.runId;
  if (!runId) {
    deps.dispatch(
      runFailed({
        code: "NETWORK_ERROR",
        title: "Connexion perdue avant le démarrage",
        hint: "Vérifie ta connexion, puis relance le test.",
        detail: "Aucun identifiant de test n'a été reçu.",
      }),
    );
    return;
  }
  await follow(runId, deps, controller.signal);
}

/** Reprend le suivi d'un test déjà lancé (après un rechargement de la page). */
export async function resumeRun(runId: string, deps: ControllerDeps): Promise<void> {
  const controller = begin();
  await follow(runId, deps, controller.signal);
}

/** Demande l'arrêt du test. Le flux livre ensuite « stopping » puis « finished ». */
export async function cancelRun(runId: string): Promise<void> {
  await apiFetch(`/api/load-tests/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

/** Le test lancé depuis ce navigateur et encore susceptible d'être suivi, s'il y en a un. */
export async function findResumableRun(now = Date.now()): Promise<RunRecord | null> {
  try {
    await pruneRuns(RUN_RECORD_MAX_AGE_MS, now);
    const running = (await listRuns()).filter((r) => r.status === "running");
    running.sort((a, b) => b.startedAt - a.startedAt);
    return running[0] ?? null;
  } catch {
    return null;
  }
}