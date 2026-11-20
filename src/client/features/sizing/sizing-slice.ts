import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { ApiError, describeError } from "@/client/api/errors";
import { toMeasuredRun } from "@/client/features/load/verdict";
import type { StoredLoadResult } from "@/client/storage/db";
import type { RootState } from "@/client/store";
import type { InfraMetrics } from "@/shared/schemas";
import type { PrometheusMetricStatus } from "@/shared/types/infrastructure-result";
import { buildCapacityInput, DEFAULT_CAPACITY, validateCapacity, type CapacityDraft } from "./capacity-input";
import { requestCapacity, type CapacityResult } from "./capacity-api";
import { DEFAULT_INFRA, toInfraSpec, type InfraDraft } from "./infra";

export interface ActionError {
  code: string;
  title: string;
  hint: string | null;
  detail: string;
}

export interface MetricsState {
  source: "prometheus" | "csv";
  /** Le test auquel ces mesures se rapportent. */
  forRunId: string;
  infraMetrics: InfraMetrics;
  statuses: PrometheusMetricStatus[];
  warnings: string[];
}

export type CapacityState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; forRunId: string | null; result: CapacityResult }
  | { status: "error"; error: ActionError };

export interface SizingState {
  selectedId: string | null;
  infra: InfraDraft;
  capacity: CapacityDraft;
  metrics: MetricsState | null;
  capacityState: CapacityState;
}

const initialState: SizingState = {
  selectedId: null,
  infra: DEFAULT_INFRA,
  capacity: DEFAULT_CAPACITY,
  metrics: null,
  capacityState: { status: "idle" },
};

export const computeCapacity = createAsyncThunk<
  CapacityResult,
  { stored: StoredLoadResult | null },
  { state: RootState; rejectValue: ActionError }
>("sizing/capacity", async ({ stored }, { getState, signal, rejectWithValue }) => {
  const { infra, capacity, metrics } = getState().sizing;
  const problems = validateCapacity(capacity, infra, { hasRun: stored !== null });
  if (problems.length > 0) {
    return rejectWithValue({ code: "VALIDATION_ERROR", title: "Le formulaire est incomplet", hint: null, detail: problems[0] });
  }

  let run = null;
  if (capacity.mode === "measured" && stored) {
    run = toMeasuredRun(stored.points, stored.result.generator.saturated, stored.result.name.slice(0, 100), {
      infra: toInfraSpec(infra),
      infraMetrics: metrics && metrics.forRunId === stored.id ? metrics.infraMetrics : undefined,
    });
    if (!run) {
      return rejectWithValue({
        code: "VALIDATION_ERROR",
        title: "Test trop court",
        hint: "Relance un test d'au moins quelques secondes, ou passe en mode « à partir d'hypothèses ».",
        detail: "Ce test contient moins de deux secondes de mesures.",
      });
    }
  }

  try {
    return await requestCapacity(buildCapacityInput({ draft: capacity, infra, run }), signal);
  } catch (err) {
    return rejectWithValue({ code: err instanceof ApiError ? err.code : "UNKNOWN", ...describeError(err) });
  }
});

const sizingSlice = createSlice({
  name: "sizing",
  initialState,
  reducers: {
    /** Choisir un autre test efface les mesures et le calcul qui se rapportaient au précédent. */
    selectRun(state, action: PayloadAction<string | null>) {
      if (state.selectedId === action.payload) return;
      state.selectedId = action.payload;
      state.metrics = null;
      state.capacityState = { status: "idle" };
    },
    setInfra(state, action: PayloadAction<InfraDraft>) {
      state.infra = action.payload;
    },
    setCapacityDraft(state, action: PayloadAction<CapacityDraft>) {
      state.capacity = action.payload;
    },
    /** Après un rechargement : les réglages enregistrés dans le navigateur. */
    hydrateSizing(state, action: PayloadAction<{ infra?: InfraDraft; capacity?: CapacityDraft }>) {
      if (action.payload.infra) state.infra = action.payload.infra;
      if (action.payload.capacity) state.capacity = action.payload.capacity;
    },
    setMetrics(state, action: PayloadAction<MetricsState>) {
      state.metrics = action.payload;
    },
    clearMetrics(state) {
      state.metrics = null;
    },
    clearCapacity(state) {
      state.capacityState = { status: "idle" };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(computeCapacity.pending, (state) => {
        state.capacityState = { status: "loading" };
      })
      .addCase(computeCapacity.fulfilled, (state, action) => {
        state.capacityState = { status: "done", forRunId: action.meta.arg.stored?.id ?? null, result: action.payload };
      })
      .addCase(computeCapacity.rejected, (state, action) => {
        state.capacityState = action.meta.aborted
          ? { status: "idle" }
          : {
              status: "error",
              error: action.payload ?? { code: "UNKNOWN", title: "Une erreur est survenue", hint: null, detail: action.error.message ?? "Erreur inconnue." },
            };
      });
  },
});

export const { selectRun, setInfra, setCapacityDraft, hydrateSizing, setMetrics, clearMetrics, clearCapacity } = sizingSlice.actions;
export default sizingSlice.reducer;