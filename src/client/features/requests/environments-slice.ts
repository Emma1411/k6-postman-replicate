import { createAsyncThunk, createSelector, createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/client/store";
import {
  deleteEnvironment,
  getSetting,
  listEnvironments,
  saveEnvironment,
  setSetting,
} from "@/client/storage/repositories";
import { ENVIRONMENT_FORMAT, VariableNameSchema, parseEnvironment, type Environment } from "@/shared/schemas";

const SELECTED_KEY = "selected-environment";

export function newEnvironment(name: string): Environment {
  return { format: ENVIRONMENT_FORMAT, version: 1, id: crypto.randomUUID(), name, variables: [] };
}

/** Les variables utilisables par une requête : celles dont le nom est valide. */
export function activeVariables(environment: Environment | undefined): Record<string, string> {
  if (!environment) return {};
  const out: Record<string, string> = {};
  for (const variable of environment.variables) {
    if (VariableNameSchema.safeParse(variable.key).success) out[variable.key] = variable.value;
  }
  return out;
}

export interface EnvironmentsState {
  status: "idle" | "loading" | "ready" | "error";
  items: Environment[];
  selectedId: string | null;
  error: string | null;
}

const initialState: EnvironmentsState = { status: "idle", items: [], selectedId: null, error: null };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Le stockage du navigateur a échoué.");

export const loadEnvironments = createAsyncThunk("environments/load", async () => {
  const [items, selected] = await Promise.all([listEnvironments(), getSetting<string | null>(SELECTED_KEY, null)]);
  return { items, selectedId: items.some((e) => e.id === selected) ? selected : null };
});

export const upsertEnvironment = createAsyncThunk("environments/upsert", async (environment: Environment) => {
  const valid = parseEnvironment(environment);
  await saveEnvironment(valid);
  return valid;
});

export const removeEnvironment = createAsyncThunk("environments/remove", async (id: string) => {
  await deleteEnvironment(id);
  if ((await getSetting<string | null>(SELECTED_KEY, null)) === id) await setSetting(SELECTED_KEY, null);
  return id;
});

export const chooseEnvironment = createAsyncThunk("environments/choose", async (id: string | null) => {
  await setSetting(SELECTED_KEY, id);
  return id;
});

const slice = createSlice({
  name: "environments",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadEnvironments.pending, (state) => {
        state.status = "loading";
      })
      .addCase(loadEnvironments.fulfilled, (state, action) => {
        state.status = "ready";
        state.items = action.payload.items;
        state.selectedId = action.payload.selectedId;
        state.error = null;
      })
      .addCase(loadEnvironments.rejected, (state, action) => {
        state.status = "error";
        state.error = action.error.message ?? "Impossible de lire les environnements.";
      })
      .addCase(upsertEnvironment.fulfilled, (state, action) => {
        const index = state.items.findIndex((e) => e.id === action.payload.id);
        if (index === -1) state.items.push(action.payload);
        else state.items[index] = action.payload;
        state.error = null;
      })
      .addCase(upsertEnvironment.rejected, (state, action) => {
        state.error = messageOf(action.error);
      })
      .addCase(removeEnvironment.fulfilled, (state, action) => {
        state.items = state.items.filter((e) => e.id !== action.payload);
        if (state.selectedId === action.payload) state.selectedId = null;
      })
      .addCase(chooseEnvironment.fulfilled, (state, action) => {
        state.selectedId = action.payload;
      });
  },
});

export default slice.reducer;

export const selectActiveVariables = createSelector(
  [(s: RootState) => s.environments.items, (s: RootState) => s.environments.selectedId],
  (items, selectedId) => activeVariables(items.find((e) => e.id === selectedId)),
);