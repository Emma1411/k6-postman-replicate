import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { LoadScenario } from "@/shared/schemas";
import type {
  GeneratorStatus,
  LoadEvent,
  LoadRunInfo,
  LoadRunResult,
  MetricsSnapshot,
  ThresholdResult,
  WindowPoint,
} from "@/shared/types/load-result";
import { describePhases, phaseAt } from "./phases";

export type LoadPhase = "prepare" | "starting" | "running" | "finished" | "error";
export type Connection = "connected" | "reconnecting" | "lost";

export interface LogEntry {
  /** Secondes écoulées depuis le début du test. */
  t: number;
  level: "info" | "warning" | "error";
  message: string;
}

export interface LoadError {
  code: string;
  title: string;
  hint: string | null;
  detail: string;
}

export interface LoadState {
  phase: LoadPhase;
  scenario: LoadScenario | null;
  run: LoadRunInfo | null;
  points: WindowPoint[];
  snapshot: MetricsSnapshot | null;
  thresholds: ThresholdResult[];
  generator: GeneratorStatus | null;
  result: LoadRunResult | null;
  log: LogEntry[];
  stopping: string | null;
  connection: Connection;
  error: LoadError | null;
}

const MAX_LOG = 200;

const initialState: LoadState = {
  phase: "prepare",
  scenario: null,
  run: null,
  points: [],
  snapshot: null,
  thresholds: [],
  generator: null,
  result: null,
  log: [],
  stopping: null,
  connection: "connected",
  error: null,
};

function push(state: LoadState, entry: LogEntry): void {
  state.log.push(entry);
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

const thresholdKey = (t: ThresholdResult) => `${t.metric}|${t.expression}`;

function logThresholds(state: LoadState, next: ThresholdResult[], t: number): void {
  const before = new Map(state.thresholds.map((x) => [thresholdKey(x), x]));
  for (const th of next) {
    const prev = before.get(thresholdKey(th));
    const label = `${th.metric} ${th.expression}`;
    if (!th.noData && !th.passed && (!prev || prev.passed || prev.noData)) {
      push(state, { t, level: "warning", message: `Seuil non respecté : ${label} (valeur ${th.value ?? "—"}).` });
    } else if (th.passed && prev && !prev.passed && !prev.noData) {
      push(state, { t, level: "info", message: `Seuil de nouveau respecté : ${label}.` });
    }
  }
}

function finishedMessage(result: LoadRunResult): LogEntry {
  const t = result.durationSeconds;
  switch (result.status) {
    case "passed":
      return { t, level: "info", message: "Test terminé : tous les seuils sont respectés." };
    case "failed":
      return { t, level: "warning", message: "Test terminé : au moins un seuil n'est pas respecté." };
    case "aborted":
      return { t, level: "warning", message: `Test interrompu${result.abortReason ? ` : ${result.abortReason}` : "."}` };
    default:
      return { t, level: "error", message: `Test en erreur : ${result.error ?? "erreur inconnue"}.` };
  }
}

const loadSlice = createSlice({
  name: "load",
  initialState,
  reducers: {
    resetLoad: () => initialState,
    runStarting(_state, action: PayloadAction<LoadScenario>): LoadState {
      return { ...initialState, phase: "starting", scenario: action.payload, log: [{ t: 0, level: "info", message: "Démarrage du test…" }] };
    },
    /** Après un rechargement : le serveur ne renvoie pas le scénario, on le relit depuis le stockage. */
    scenarioRestored(state, action: PayloadAction<LoadScenario | null>) {
      state.scenario = action.payload;
    },
    runFailed(state, action: PayloadAction<LoadError>) {
      state.phase = "error";
      state.error = action.payload;
    },
    connectionChanged(state, action: PayloadAction<Connection>) {
      state.connection = action.payload;
      if (action.payload === "reconnecting") push(state, { t: state.points.at(-1)?.t ?? 0, level: "warning", message: "Connexion interrompue, reconnexion…" });
      if (action.payload === "lost") push(state, { t: state.points.at(-1)?.t ?? 0, level: "error", message: "Connexion perdue : le suivi en direct s'est arrêté." });
    },
    eventReceived(state, action: PayloadAction<LoadEvent>) {
      const event = action.payload;
      switch (event.type) {
        case "init": {
          const resumed = event.points.length > 0;
          state.run = event.run;
          state.points = event.points;
          state.snapshot = event.snapshot;
          state.thresholds = event.thresholds;
          state.generator = event.generator;
          state.connection = "connected";
          if (event.result) {
            state.result = event.result;
            state.phase = "finished";
            push(state, finishedMessage(event.result));
          } else {
            state.phase = "running";
            push(state, {
              t: event.points.at(-1)?.t ?? 0,
              level: "info",
              message: resumed ? "Suivi repris." : `Le test démarre (${event.run.workers} worker${event.run.workers > 1 ? "s" : ""}).`,
            });
          }
          break;
        }
        case "started":
          state.run = event.run;
          state.phase = "running";
          break;
        case "window": {
          const { point } = event;
          const last = state.points.at(-1);
          if (last && point.t <= last.t) break; // fenêtre déjà reçue
          const spans = state.scenario ? describePhases(state.scenario.executor) : [];
          const before = last ? phaseAt(spans, last.t) : null;
          const now = phaseAt(spans, point.t);
          if (before && now && before.label !== now.label) push(state, { t: point.t, level: "info", message: `Phase : ${now.label}.` });
          logThresholds(state, event.thresholds, point.t);
          if (event.generator.saturated && !state.generator?.saturated) {
            push(state, { t: point.t, level: "warning", message: "Le générateur de charge est saturé : les mesures deviennent peu fiables." });
          }
          state.points.push(point);
          state.snapshot = event.snapshot;
          state.thresholds = event.thresholds;
          state.generator = event.generator;
          state.phase = "running";
          break;
        }
        case "stopping":
          state.stopping = event.reason;
          push(state, { t: state.points.at(-1)?.t ?? 0, level: "warning", message: `Arrêt en cours : ${event.reason}` });
          break;
        case "finished":
          state.result = event.result;
          state.snapshot = event.result.snapshot;
          state.thresholds = event.result.thresholds;
          state.phase = "finished";
          push(state, finishedMessage(event.result));
          break;
      }
    },
  },
});

export const { resetLoad, runStarting, scenarioRestored, runFailed, connectionChanged, eventReceived } = loadSlice.actions;
export default loadSlice.reducer;