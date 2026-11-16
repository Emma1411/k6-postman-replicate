import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { apiFetch } from "@/client/api/client";
import { ApiError, describeError } from "@/client/api/errors";
import type { RootState } from "@/client/store";
import type { Assertion, Auth, HttpMethod, KeyValue } from "@/shared/schemas";
import type { SendRequestResult } from "@/shared/types/send-result";
import { draftToSendInput, emptyDraft, validateDraft, type BodyDraft, type RequestDraft } from "./model";
import { applyParams, mergeParamsFromUrl } from "./url-params";

export interface SendError {
  code: string;
  title: string;
  hint: string | null;
  detail: string;
}

export type SendState =
  | { status: "idle" }
  | { status: "sending"; startedAt: number }
  | { status: "done"; response: SendRequestResult; sentAt: number }
  | { status: "error"; error: SendError };

export interface EditorState {
  draft: RequestDraft;
  send: SendState;
}

const initialState: EditorState = { draft: emptyDraft(), send: { status: "idle" } };

export const sendRequest = createAsyncThunk<
  SendRequestResult,
  { variables: Record<string, string> },
  { state: RootState; rejectValue: SendError }
>("editor/send", async ({ variables }, { getState, signal, rejectWithValue }) => {
  const draft = getState().editor.draft;
  const problem = validateDraft(draft);
  if (problem) {
    return rejectWithValue({ code: "VALIDATION_ERROR", title: "Adresse manquante ou invalide", hint: null, detail: problem });
  }
  try {
    return await apiFetch<SendRequestResult>("/api/requests/execute", { body: draftToSendInput(draft, variables), signal });
  } catch (err) {
    return rejectWithValue({ code: err instanceof ApiError ? err.code : "UNKNOWN", ...describeError(err) });
  }
});

const editorSlice = createSlice({
  name: "editor",
  initialState,
  reducers: {
    /** Remplace le brouillon (rechargement du stockage, ouverture depuis l'historique). */
    loadDraft(state, action: PayloadAction<RequestDraft>) {
      state.draft = action.payload;
      state.send = { status: "idle" };
    },
    resetDraft(state) {
      state.draft = emptyDraft();
      state.send = { status: "idle" };
    },
    setName(state, action: PayloadAction<string>) {
      state.draft.name = action.payload;
    },
    setMethod(state, action: PayloadAction<HttpMethod>) {
      state.draft.method = action.payload;
    },
    setUrl(state, action: PayloadAction<string>) {
      state.draft.url = action.payload;
      state.draft.params = mergeParamsFromUrl(action.payload, state.draft.params);
    },
    setParams(state, action: PayloadAction<KeyValue[]>) {
      state.draft.params = action.payload;
      state.draft.url = applyParams(state.draft.url, action.payload);
    },
    setHeaders(state, action: PayloadAction<KeyValue[]>) {
      state.draft.headers = action.payload;
    },
    setBody(state, action: PayloadAction<BodyDraft>) {
      state.draft.body = action.payload;
    },
    setAuth(state, action: PayloadAction<Auth>) {
      state.draft.auth = action.payload;
    },
    setAssertions(state, action: PayloadAction<Assertion[]>) {
      state.draft.assertions = action.payload;
    },
    setSettings(state, action: PayloadAction<{ timeoutMs: number | null; followRedirects: boolean }>) {
      state.draft.timeoutMs = action.payload.timeoutMs;
      state.draft.followRedirects = action.payload.followRedirects;
    },
    clearResponse(state) {
      state.send = { status: "idle" };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(sendRequest.pending, (state) => {
        state.send = { status: "sending", startedAt: Date.now() };
      })
      .addCase(sendRequest.fulfilled, (state, action) => {
        state.send = { status: "done", response: action.payload, sentAt: Date.now() };
      })
      .addCase(sendRequest.rejected, (state, action) => {
        // Un envoi annulé par l'utilisateur ne doit pas s'afficher comme une erreur.
        if (action.meta.aborted) {
          state.send = { status: "idle" };
          return;
        }
        state.send = {
          status: "error",
          error: action.payload ?? {
            code: "UNKNOWN",
            title: "Une erreur est survenue",
            hint: null,
            detail: action.error.message ?? "Erreur inconnue.",
          },
        };
      });
  },
});

export const {
  loadDraft,
  resetDraft,
  setName,
  setMethod,
  setUrl,
  setParams,
  setHeaders,
  setBody,
  setAuth,
  setAssertions,
  setSettings,
  clearResponse,
} = editorSlice.actions;

export default editorSlice.reducer;