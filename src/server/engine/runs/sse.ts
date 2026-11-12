import "server-only";
import type { LoadEvent } from "@/shared/types/load-result";

export interface SseSource {
  initEvent(): LoadEvent;
  subscribe(listener: (event: LoadEvent) => void): () => void;
}

const encoder = new TextEncoder();
const format = (event: LoadEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/**
 * Réponse SSE : un événement `init` (état complet), puis les événements en direct.
 * Le flux se ferme à la fin du test ou quand le client se déconnecte.
 */
export function sseResponse(source: SseSource, signal: AbortSignal, pingMs = 15_000): Response {
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, pingMs);

      function close(): void {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        signal.removeEventListener("abort", close);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* flux déjà fermé */
        }
      }

      const send = (event: LoadEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(format(event)));
        } catch {
          close();
          return;
        }
        if (event.type === "finished") close();
      };

      cleanup = close;
      signal.addEventListener("abort", close, { once: true });

      const init = source.initEvent();
      send(init);
      if (init.type === "init" && init.result) {
        close(); // test déjà terminé : l'état complet suffit
        return;
      }
      unsubscribe = source.subscribe(send);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}