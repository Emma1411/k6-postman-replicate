import { describe, it, expect } from "vitest";
import { sseResponse, type SseSource } from "@/server/engine/runs/sse";
import type { LoadEvent } from "@/shared/types/load-result";

const event = (fields: Record<string, unknown>) => fields as unknown as LoadEvent;
const init = (result: unknown = null) => event({ type: "init", result, points: [] });

function fakeSource(initial: LoadEvent) {
  let listener: ((e: LoadEvent) => void) | null = null;
  let unsubscribed = false;
  const source: SseSource = {
    initEvent: () => initial,
    subscribe: (l) => {
      listener = l;
      return () => {
        unsubscribed = true;
      };
    },
  };
  return { source, emit: (e: LoadEvent) => listener?.(e), wasUnsubscribed: () => unsubscribed };
}

async function readAll(res: Response): Promise<string> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe("sseResponse", () => {
  it("envoie init, puis les événements, et se ferme à la fin du test", async () => {
    const fake = fakeSource(init());
    const res = sseResponse(fake.source, new AbortController().signal);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    fake.emit(event({ type: "window", point: { t: 1 } }));
    fake.emit(event({ type: "finished", result: { status: "passed" } }));

    const text = await readAll(res);
    const order = ["event: init", "event: window", "event: finished"].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('data: {"type":"window","point":{"t":1}}');
    expect(fake.wasUnsubscribed()).toBe(true);
  });

  it("se ferme et se désabonne quand le client se déconnecte", async () => {
    const fake = fakeSource(init());
    const controller = new AbortController();
    const res = sseResponse(fake.source, controller.signal);

    controller.abort();
    await readAll(res);
    expect(fake.wasUnsubscribed()).toBe(true);
  });

  it("n'envoie que l'état complet pour un test déjà terminé", async () => {
    const fake = fakeSource(init({ status: "passed" }));
    const text = await readAll(sseResponse(fake.source, new AbortController().signal));
    expect(text).toContain("event: init");
    expect(text).not.toContain("event: window");
  });

  it("envoie des signaux de maintien de connexion", async () => {
    const fake = fakeSource(init());
    const controller = new AbortController();
    const res = sseResponse(fake.source, controller.signal, 20);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    let text = "";
    const deadline = Date.now() + 1000;
    while (!text.includes(": ping") && Date.now() < deadline) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    expect(text).toContain(": ping");
    controller.abort();
  });
});