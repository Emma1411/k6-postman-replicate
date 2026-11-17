import type { LoadEvent } from "@/shared/types/load-result";
import { ApiError } from "./errors";

export interface SseMessage {
  event: string;
  data: string;
}

function toMessage(block: string): SseMessage | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // commentaire (« : ping »)
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}

/** Lit un flux Server-Sent Events. Si le lecteur s'arrête, la connexion est fermée. */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const message = toMessage(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (message) yield message;
      }
    }
    buffer += decoder.decode();
    const last = toMessage(buffer.replace(/\r\n/g, "\n"));
    if (last) yield last;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const EVENT_TYPES = new Set(["init", "started", "window", "stopping", "finished"]);

function isLoadEvent(value: unknown): value is LoadEvent {
  return typeof value === "object" && value !== null && EVENT_TYPES.has((value as { type?: string }).type ?? "");
}

/** Les événements d'un test de charge. Les messages mal formés sont ignorés. */
export async function* readLoadEvents(response: Response): AsyncGenerator<LoadEvent> {
  if (!response.body) throw new ApiError("NETWORK_ERROR", "Le serveur n'a pas renvoyé de flux.");
  for await (const message of parseSse(response.body)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      continue;
    }
    if (isLoadEvent(parsed)) yield parsed;
  }
}