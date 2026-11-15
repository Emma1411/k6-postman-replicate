import "server-only";
import { redactText } from "@/shared/reports/redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

type Sink = (line: string) => void;
const stdoutSink: Sink = (line) => {
  process.stdout.write(`${line}\n`);
};
let sink: Sink = stdoutSink;

/** Pour les tests. `null` rétablit la sortie standard. */
export function setLogSink(next: Sink | null): void {
  sink = next ?? stdoutSink;
}

function threshold(): number {
  const raw = process.env.LOG_LEVEL as LogLevel | undefined;
  return (raw && ORDER[raw]) || ORDER.info;
}

function describeError(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactText(err.message),
      stack: err.stack ? redactText(err.stack) : undefined,
    };
  }
  return { message: redactText(String(err)) };
}

function serializeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "err" || key === "error") out.error = describeError(value);
    else out[key] = typeof value === "string" ? redactText(value) : value;
  }
  return out;
}

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold()) return;
  const entry = {
    ...serializeFields(fields),
    // Placés après le spread : un champ ne peut pas écraser ces clés.
    severity: SEVERITY[level],
    message: redactText(message),
    time: new Date().toISOString(),
  };
  sink(JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => log("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => log("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => log("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => log("error", message, fields),
};