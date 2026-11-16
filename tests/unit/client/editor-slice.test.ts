import { afterEach, describe, expect, it } from "vitest";
import { setFetch } from "@/client/api/client";
import { sendRequest, setAssertions, setMethod, setParams, setUrl } from "@/client/features/requests/editor-slice";
import { makeStore } from "@/client/store";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const row = (key: string, value: string, enabled = true) => ({ key, value, enabled });

const okResponse = {
  status: 200,
  statusText: "OK",
  headers: [],
  body: { encoding: "utf8", content: "{}", truncated: false },
  sizeBytes: 2,
  timings: { dnsMs: 1, connectMs: 1, tlsMs: 1, ttfbMs: 5, transferMs: 1, totalMs: 9 },
  redirects: [],
  finalUrl: "https://api.exemple.com/v1/products?page=1",
  assertions: [{ label: "Statut 200", type: "status", passed: true, message: null }],
};

afterEach(() => setFetch(null));

describe("éditeur : URL et paramètres", () => {
  it("déduit les paramètres de l'URL et garde les lignes désactivées", () => {
    const store = makeStore();
    store.dispatch(setParams([row("debug", "1", false)]));
    store.dispatch(setUrl("https://x.test/a?page=2"));
    expect(store.getState().editor.draft.params).toEqual([row("page", "2"), row("debug", "1", false)]);
  });

  it("réécrit l'URL quand le tableau change", () => {
    const store = makeStore();
    store.dispatch(setUrl("https://x.test/a?page=1"));
    store.dispatch(setParams([row("page", "5"), row("debug", "1", false)]));
    expect(store.getState().editor.draft.url).toBe("https://x.test/a?page=5");
  });
});

describe("éditeur : envoi", () => {
  it("envoie la requête, les variables et les assertions, puis garde la réponse", async () => {
    const calls: Array<{ input: string; body: Record<string, unknown> }> = [];
    setFetch((async (input: string, init: RequestInit) => {
      calls.push({ input, body: JSON.parse(String(init.body)) });
      return json(okResponse);
    }) as unknown as typeof fetch);

    const store = makeStore();
    store.dispatch(setMethod("GET"));
    store.dispatch(setUrl("{{base}}/v1/products?page=1"));
    store.dispatch(setAssertions([{ type: "status", expected: 200 }]));
    await store.dispatch(sendRequest({ variables: { base: "https://api.exemple.com" } }));

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("/api/requests/execute");
    const body = calls[0].body as { request: { url: string; method: string }; variables: unknown; assertions: unknown };
    expect(body.request.url).toBe("{{base}}/v1/products?page=1");
    expect(body.request.method).toBe("GET");
    expect(body.variables).toEqual({ base: "https://api.exemple.com" });
    expect(body.assertions).toEqual([{ type: "status", expected: 200 }]);

    const send = store.getState().editor.send;
    expect(send.status).toBe("done");
    if (send.status === "done") expect(send.response.assertions[0].passed).toBe(true);
  });

  it("n'appelle pas le serveur quand l'adresse est vide", async () => {
    let called = false;
    setFetch((async () => {
      called = true;
      return json(okResponse);
    }) as unknown as typeof fetch);
    const store = makeStore();
    await store.dispatch(sendRequest({ variables: {} }));
    expect(called).toBe(false);
    const send = store.getState().editor.send;
    expect(send.status).toBe("error");
    if (send.status === "error") expect(send.error.code).toBe("VALIDATION_ERROR");
  });

  it("explique une erreur du serveur", async () => {
    setFetch((async () => json({ error: { code: "SSRF_BLOCKED", message: "Destination refusée." } }, 403)) as unknown as typeof fetch);
    const store = makeStore();
    store.dispatch(setUrl("http://localhost:3000"));
    await store.dispatch(sendRequest({ variables: {} }));
    const send = store.getState().editor.send;
    expect(send.status).toBe("error");
    if (send.status === "error") {
      expect(send.error.code).toBe("SSRF_BLOCKED");
      expect(send.error.title).toContain("pas accessible");
      expect(send.error.detail).toBe("Destination refusée.");
    }
  });

  it("revient à l'état initial quand l'utilisateur annule", async () => {
    setFetch(((_input: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch);
    const store = makeStore();
    store.dispatch(setUrl("https://x.test"));
    const request = store.dispatch(sendRequest({ variables: {} }));
    expect(store.getState().editor.send.status).toBe("sending");
    request.abort();
    await request;
    expect(store.getState().editor.send.status).toBe("idle");
  });
});