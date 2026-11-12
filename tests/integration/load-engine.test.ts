import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExecutor } from "@/server/engine/executors/run-executor";
import { MetricsRecorder } from "@/server/engine/metrics/recorder";
import { createIterationRunner } from "@/server/engine/runner/iteration-runner";
import { createLoadDispatcher, createLoadTransport } from "@/server/engine/transport/load-transport";
import { buildLimits } from "@/server/config/limits";
import { parseEnv } from "@/server/config/env.schema";
import { ExecutorSchema, WorkflowSchema, type HttpRequest } from "@/shared/schemas";
import { startTargetServer, type TargetServer } from "../target-server/server";

const limits = buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" }));
const dispatcher = createLoadDispatcher(limits);

let server: TargetServer;
beforeAll(async () => {
  server = await startTargetServer();
});
afterAll(async () => {
  await dispatcher.close();
  await server.close();
});

function workflow(path = "/echo", assertions: unknown[] = [{ type: "status", expected: 200 }]) {
  return WorkflowSchema.parse({
    name: "charge",
    variables: { base: server.url },
    steps: [{ id: "s1", name: "requête", request: { method: "GET", url: `{{base}}${path}` }, assertions }],
  });
}

function setup(wf = workflow()) {
  const recorder = new MetricsRecorder();
  const controller = new AbortController();
  const transport = createLoadTransport({ limits, dispatcher, recorder, signal: controller.signal });
  const runIteration = createIterationRunner({ workflow: wf, transport, recorder, signal: controller.signal });
  const vusSeen: number[] = [];
  const executorRecorder = {
    setVus: (n: number) => {
      vusSeen.push(n);
      recorder.setVus(n);
    },
    recordDropped: (n: number) => recorder.recordDropped(n),
  };
  const run = (executor: unknown, startDelayMs = 50) =>
    runExecutor({
      executor: ExecutorSchema.parse(executor),
      startAtMs: Date.now() + startDelayMs,
      shareIndex: 0,
      shareCount: 1,
      runIteration,
      recorder: executorRecorder,
      controller,
    });
  return { recorder, controller, transport, run, vusSeen };
}

const step = (url: string, extra: Partial<HttpRequest> = {}) =>
  ({ method: "GET", url, params: [], headers: [], body: { type: "none" }, auth: { type: "none" }, followRedirects: true, ...extra }) as HttpRequest;

describe("moteur de charge de bout en bout", () => {
  it("constant-vus : des VUs enchaînent les requêtes pendant la durée demandée", async () => {
    const { recorder, run, vusSeen } = setup();
    await run({ type: "constant-vus", vus: 5, durationSeconds: 2 });
    const d = recorder.flush();

    expect(d.requests).toBeGreaterThan(50);
    expect(d.failed).toBe(0);
    expect(d.status).toEqual({ "200": d.requests });
    expect(d.iterations).toBe(d.requests);
    expect(d.checksPassed).toBe(d.requests);
    expect(d.checksFailed).toBe(0);
    expect(d.duration.count).toBe(d.requests);
    expect(Math.max(...vusSeen)).toBe(5);
    expect(d.vus).toBe(0);
    expect(d.dataReceived).toBeGreaterThan(0);
  });

  it("constant-arrival-rate : tient la cadence demandée", async () => {
    const { recorder, run } = setup();
    await run({ type: "constant-arrival-rate", rate: 50, durationSeconds: 2, preAllocatedVus: 5, maxVus: 20 });
    const d = recorder.flush();
    expect(d.iterations).toBeGreaterThanOrEqual(98);
    expect(d.iterations).toBeLessThanOrEqual(100);
    expect(d.dropped).toBe(0);
    expect(d.failed).toBe(0);
  });

  it("constant-arrival-rate : compte les itérations abandonnées quand la cible est trop lente", async () => {
    const { recorder, run } = setup(workflow("/delay/300"));
    await run({ type: "constant-arrival-rate", rate: 20, durationSeconds: 2, preAllocatedVus: 1, maxVus: 2 });
    const d = recorder.flush();
    expect(d.dropped).toBeGreaterThan(10);
    expect(d.iterations + d.dropped).toBe(40);
  });

  it("per-vu-iterations et shared-iterations", async () => {
    const a = setup();
    await a.run({ type: "per-vu-iterations", vus: 3, iterations: 5, maxDurationSeconds: 30 });
    expect(a.recorder.flush().iterations).toBe(15);

    const b = setup();
    await b.run({ type: "shared-iterations", vus: 4, iterations: 20, maxDurationSeconds: 30 });
    expect(b.recorder.flush().iterations).toBe(20);
  });

  it("annulation : s'arrête vite et ne compte pas les requêtes interrompues comme des échecs", async () => {
    const { recorder, controller, run } = setup(workflow("/delay/5000"));
    const started = Date.now();
    const done = run({ type: "constant-vus", vus: 3, durationSeconds: 30 });
    setTimeout(() => controller.abort(), 400);
    await done;

    expect(Date.now() - started).toBeLessThan(3000);
    const d = recorder.flush();
    expect(d.failed).toBe(0);
    expect(d.iterations).toBe(0);
  });

  it("alimente les assertions sur le body, y compris compressé", async () => {
    const wf = workflow("/gzip", [{ type: "jsonPath", path: "$.hello", operator: "equals", value: "gzip" }]);
    const { recorder, run } = setup(wf);
    await run({ type: "shared-iterations", vus: 1, iterations: 5, maxDurationSeconds: 30 });
    const d = recorder.flush();
    expect(d.checksPassed).toBe(5);
    expect(d.checksFailed).toBe(0);
  });
});

describe("transport de charge", () => {
  const ctx = (needsBody: boolean, timeoutMs: number | null = null) => ({ timeoutMs, needsBody });

  it("enregistre une connexion refusée comme un échec sans durée", async () => {
    const closed = await startTargetServer();
    const url = closed.url;
    await closed.close();

    const { recorder, transport } = setup();
    await expect(transport(step(`${url}/echo`), {}, ctx(false))).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    const d = recorder.flush();
    expect(d.requests).toBe(1);
    expect(d.failed).toBe(1);
    expect(d.status).toEqual({ error: 1 });
    expect(d.duration.count).toBe(0);
  });

  it("enregistre un délai dépassé avec sa durée", async () => {
    const { recorder, transport } = setup();
    await expect(
      transport(step(`${server.url}/delay/1000`, { timeoutMs: 150 }), {}, ctx(false)),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    const d = recorder.flush();
    expect(d.failed).toBe(1);
    expect(d.duration.count).toBe(1);
    expect(d.status).toEqual({ error: 1 });
  });

  it("enregistre une variable non définie comme un échec", async () => {
    const { recorder, transport } = setup();
    await expect(transport(step("{{base}}/echo"), {}, ctx(false))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const d = recorder.flush();
    expect(d.requests).toBe(1);
    expect(d.failed).toBe(1);
  });

  it("compte les statuts 4xx et 5xx comme des échecs, pas les 3xx", async () => {
    const { recorder, transport } = setup();
    await transport(step(`${server.url}/status/404`), {}, ctx(false));
    await transport(step(`${server.url}/status/500`), {}, ctx(false));
    await transport(step(`${server.url}/redirect/1`), {}, ctx(false));
    const d = recorder.flush();
    expect(d.requests).toBe(3);
    expect(d.failed).toBe(2);
    expect(d.status).toEqual({ "404": 1, "500": 1, "302": 1 });
  });

  it("vide le body sans le lire quand il n'est pas nécessaire", async () => {
    const { recorder, transport } = setup();
    const res = await transport(step(`${server.url}/large?bytes=500000`), {}, ctx(false));
    expect(res.bodyText).toBeNull();
    expect(res.bodyBytes).toBe(500_000);
    expect(recorder.flush().dataReceived).toBeGreaterThanOrEqual(500_000);
  });

  it("lit et décode le body quand il est nécessaire", async () => {
    const { transport } = setup();
    const res = await transport(step(`${server.url}/echo`), {}, ctx(true));
    expect(JSON.parse(res.bodyText as string).method).toBe("GET");
  });

  it("bloque les destinations privées quand la garde est active", async () => {
    const strict = buildLimits(parseEnv({}));
    const recorder = new MetricsRecorder();
    const controller = new AbortController();
    const strictDispatcher = createLoadDispatcher(strict);
    const transport = createLoadTransport({ limits: strict, dispatcher: strictDispatcher, recorder, signal: controller.signal });

    await expect(transport(step(`${server.url}/echo`), {}, ctx(false))).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
    expect(recorder.flush().failed).toBe(1);
    await strictDispatcher.close();
  });
});