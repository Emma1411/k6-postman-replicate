import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  params: URLSearchParams;
  headers: http.IncomingHttpHeaders;
}

export interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface FakePrometheus {
  url: string;
  host: string;
  port: number;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export async function startFakePrometheus(handler: (req: RecordedRequest) => FakeResponse): Promise<FakePrometheus> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const recorded: RecordedRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      params: url.searchParams,
      headers: req.headers,
    };
    requests.push(recorded);

    const out = handler(recorded);
    res.statusCode = out.status ?? 200;
    for (const [key, value] of Object.entries(out.headers ?? {})) res.setHeader(key, value);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out.body ?? {}));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    host: "127.0.0.1",
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const matrixOf = (result: unknown[]) => ({ status: "success", data: { resultType: "matrix", result } });

/** Une série Prometheus : valeurs aux horodatages start, start + step, … */
export function series(start: number, step: number, values: Array<number | string>, metric: Record<string, string> = {}) {
  return { metric, values: values.map((v, i) => [start + i * step, String(v)]) };
}

export const promError = (error: string) => ({ status: "error", errorType: "bad_data", error });