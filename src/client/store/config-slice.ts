import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { getConfig } from "@/client/api/endpoints";
import { ApiError } from "@/client/api/errors";
import type { PublicConfig } from "@/shared/types/public-config";

export type ConfigState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; value: PublicConfig }
  | { status: "error"; message: string };

export const loadConfig = createAsyncThunk<PublicConfig, void, { rejectValue: string }>(
  "config/load",
  async (_arg, { signal, rejectWithValue }) => {
    try {
      return await getConfig(signal);
    } catch (err) {
      return rejectWithValue(err instanceof ApiError ? err.message : "Configuration indisponible.");
    }
  },
);

const initialState = { status: "idle" } as ConfigState;

const configSlice = createSlice({
  name: "config",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadConfig.pending, (): ConfigState => ({ status: "loading" }))
      .addCase(loadConfig.fulfilled, (_state, action): ConfigState => ({ status: "ready", value: action.payload }))
      .addCase(loadConfig.rejected, (state, action): ConfigState =>
        // Un chargement annulé (démontage du composant) ne doit pas afficher d'erreur.
        action.meta.aborted ? state : { status: "error", message: action.payload ?? "Configuration indisponible." },
      );
  },
});

export default configSlice.reducer;