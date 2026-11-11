import { describe, it, expect } from "vitest";
import { runWorkflow } from "@/server/engine/vu/run-workflow";
import type { StepResponse, StepTransport } from "@/server/engine/types";
import { AppError } from "@/server/utils/errors";
import { WorkflowSchema, type HttpRequest, type Variables } from "@/shared/schemas";

const ok = (body: unknown, status = 200): StepResponse => ({
  status,
  headers: [],
  bodyText: JSON.stringify(body),
  bodyBytes: 1,
  durationMs: 5,
  finalUrl: null,
  truncated: false,
});

interface Call {
  url: string;
  vars: Variables;
  timeoutMs: number | null;
}

function fakeTransport(handler: (req: HttpRequest, vars: Variables) => StepResponse) {
  const calls: Call[] = [];
  const transport: StepTransport = async (req, vars, ctx) => {
    calls.push({ url: req.url, vars: { ...vars }, timeoutMs: ctx.timeoutMs });
    return handler(req, vars);
  };
  return { transport, calls };
}

const step = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  request: { method: "GET", url: `http://x.test/${id}` },
  ...extra,
});
const wf = (steps: unknown[], variables: Record<string, string> = {}) =>
  WorkflowSchema.parse({ name: "w", variables, steps });

describe("runWorkflow", () => {
  it("transmet les variables extraites aux étapes suivantes", async () => {
    const { transport, calls } = fakeTransport(() => ok({ token: "t1" }));
    const result = await runWorkflow(
      wf([
        step("login", { extract: [{ variable: "token", from: "jsonPath", path: "$.token" }] }),
        step("next"),
      ]),
      { transport },
    );
    expect(result.status).toBe("passed");
    expect(calls[1].vars.token).toBe("t1");
    expect(result.variables.token).toBe("t1");
    expect(result.steps[0].extracted).toEqual({ token: "t1" });
  });

  it("fait passer les variables d'entrée avant celles du workflow", async () => {
    const { transport, calls } = fakeTransport(() => ok({}));
    await runWorkflow(wf([step("a")], { env: "workflow", keep: "1" }), { transport, variables: { env: "prod" } });
    expect(calls[0].vars.env).toBe("prod");
    expect(calls[0].vars.keep).toBe("1");
  });

  it("fournit les variables dynamiques", async () => {
    const { transport, calls } = fakeTransport(() => ok({}));
    await runWorkflow(wf([step("a")]), { transport, vu: 4, iteration: 3 });
    const vars = calls[0].vars;
    expect(vars.$vu).toBe("4");
    expect(vars.$iteration).toBe("3");
    expect(vars.$uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(vars.$timestamp)).toBeGreaterThan(0);
    expect(Number(vars.$randomInt)).toBeLessThan(1000);
  });

  it("n'expose pas les variables dynamiques dans l'état final", async () => {
    const { transport } = fakeTransport(() => ok({}));
    const result = await runWorkflow(wf([step("a")]), { transport });
    expect(Object.keys(result.variables).some((k) => k.startsWith("$"))).toBe(false);
  });

  it("s'arrête après un échec et saute les étapes suivantes (onError = stop)", async () => {
    const { transport, calls } = fakeTransport(() => ok({}, 500));
    const result = await runWorkflow(
      wf([step("a", { assertions: [{ type: "status", expected: 200 }] }), step("b")]),
      { transport },
    );
    expect(result.status).toBe("failed");
    expect(result.stoppedAtStepId).toBe("a");
    expect(result.steps.map((s) => s.status)).toEqual(["failed", "skipped"]);
    expect(result.steps[1].skippedReason).toContain("Arrêté");
    expect(calls).toHaveLength(1);
  });

  it("continue après un échec avec onError = continue", async () => {
    const { transport, calls } = fakeTransport(() => ok({}, 500));
    const result = await runWorkflow(
      wf([
        step("a", { onError: "continue", assertions: [{ type: "status", expected: 200 }] }),
        step("b"),
      ]),
      { transport },
    );
    expect(calls).toHaveLength(2);
    expect(result.stoppedAtStepId).toBeNull();
    expect(result.status).toBe("failed");
    expect(result.steps.map((s) => s.status)).toEqual(["failed", "passed"]);
  });

  it("classe une erreur de transport en error", async () => {
    const transport: StepTransport = async () => {
      throw new AppError("TIMEOUT", "trop long");
    };
    const result = await runWorkflow(wf([step("a"), step("b")]), { transport });
    expect(result.steps[0].status).toBe("error");
    expect(result.steps[0].error).toEqual({ code: "TIMEOUT", message: "trop long" });
    expect(result.steps[1].status).toBe("skipped");
    expect(result.summary.errors).toBe(1);
  });

  it("saute une étape dont la condition n'est pas remplie", async () => {
    const { transport, calls } = fakeTransport(() => ok({}));
    const result = await runWorkflow(
      wf([step("a", { runIf: { left: "{{flag}}", operator: "equals", right: "on" } }), step("b")], { flag: "off" }),
      { transport },
    );
    expect(result.steps.map((s) => s.status)).toEqual(["skipped", "passed"]);
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("passed");
  });

  it("marque l'étape en échec si une extraction échoue", async () => {
    const { transport } = fakeTransport(() => ok({}));
    const result = await runWorkflow(
      wf([step("a", { extract: [{ variable: "x", from: "jsonPath", path: "$.nope" }] })]),
      { transport },
    );
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].extractionErrors).toHaveLength(1);
  });

  it("calcule le résumé des assertions", async () => {
    const { transport } = fakeTransport(() => ok({ id: 1 }));
    const result = await runWorkflow(
      wf([
        step("a", {
          onError: "continue",
          assertions: [
            { type: "status", expected: 200 },
            { type: "jsonPath", path: "$.id", operator: "equals", value: 2 },
          ],
        }),
      ]),
      { transport },
    );
    expect(result.summary.assertionsPassed).toBe(1);
    expect(result.summary.assertionsFailed).toBe(1);
  });

  it("respecte l'échéance globale", async () => {
    const { transport, calls } = fakeTransport(() => ok({}));
    const result = await runWorkflow(wf([step("a"), step("b")]), { transport, deadlineAt: Date.now() - 1 });
    expect(result.aborted).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.steps.every((s) => s.status === "skipped")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("respecte l'annulation", async () => {
    const { transport, calls } = fakeTransport(() => ok({}));
    const controller = new AbortController();
    controller.abort();
    const result = await runWorkflow(wf([step("a")]), { transport, signal: controller.signal });
    expect(result.aborted).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("transmet le temps restant au transport", async () => {
    const { transport, calls } = fakeTransport(() => ok({}));
    await runWorkflow(wf([step("a")]), { transport, deadlineAt: Date.now() + 10_000 });
    expect(calls[0].timeoutMs).toBeGreaterThan(0);
    expect(calls[0].timeoutMs).toBeLessThanOrEqual(10_000);

    const none = fakeTransport(() => ok({}));
    await runWorkflow(wf([step("a")]), { transport: none.transport });
    expect(none.calls[0].timeoutMs).toBeNull();
  });

  it("applique le temps de pause entre les étapes", async () => {
    const { transport } = fakeTransport(() => ok({}));
    const sleeps: number[] = [];
    await runWorkflow(wf([step("a", { thinkTimeMs: 250 }), step("b")]), {
      transport,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([250]);
  });

  it("n'inclut l'aperçu du body que sur demande", async () => {
    const { transport } = fakeTransport(() => ok({ a: 1 }));
    const without = await runWorkflow(wf([step("a")]), { transport });
    expect(without.steps[0].response?.preview).toBeNull();
    const withPreview = await runWorkflow(wf([step("a")]), { transport, includePreview: true });
    expect(withPreview.steps[0].response?.preview).toBe('{"a":1}');
  });
});