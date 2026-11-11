import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWorkflow } from "@/server/engine/vu/run-workflow";
import { createHttpTransport } from "@/server/services/workflow/http-transport";
import { buildLimits } from "@/server/config/limits";
import { parseEnv } from "@/server/config/env.schema";
import { WorkflowSchema } from "@/shared/schemas";
import { startTargetServer, type TargetServer } from "../target-server/server";

const limits = buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" }));
const transport = createHttpTransport({ limits });

let server: TargetServer;
beforeAll(async () => {
  server = await startTargetServer();
});
afterAll(async () => {
  await server.close();
});

const fullWorkflow = (overrides: { createStatus?: number } = {}) =>
  WorkflowSchema.parse({
    name: "Cycle de vie d'un utilisateur",
    variables: { name: "emma" },
    steps: [
      {
        id: "login",
        name: "Authentification",
        request: { method: "POST", url: "{{base}}/login", body: { type: "json", content: "{}" } },
        assertions: [
          { type: "status", expected: 200 },
          { type: "jsonPath", path: "$.token", operator: "exists" },
        ],
        extract: [{ variable: "token", from: "jsonPath", path: "$.token" }],
      },
      {
        id: "create",
        name: "Création",
        request: {
          method: "POST",
          url: "{{base}}/users",
          auth: { type: "bearer", token: "{{token}}" },
          body: { type: "json", content: '{"name":"{{name}}"}' },
        },
        assertions: [
          { type: "status", expected: overrides.createStatus ?? 201 },
          { type: "jsonPath", path: "$.id", operator: "type", value: "number" },
        ],
        extract: [{ variable: "userId", from: "jsonPath", path: "$.id" }],
      },
      {
        id: "get",
        name: "Lecture",
        request: { method: "GET", url: "{{base}}/users/{{userId}}", auth: { type: "bearer", token: "{{token}}" } },
        assertions: [
          { type: "status", expected: 200 },
          { type: "jsonPath", path: "$.name", operator: "equals", value: "{{name}}" },
          { type: "jsonPath", path: "$.tags[1]", operator: "equals", value: "b" },
          {
            type: "jsonSchema",
            schema: { type: "object", required: ["id", "name"], properties: { id: { type: "integer" } } },
          },
        ],
      },
      {
        id: "delete",
        name: "Suppression",
        request: { method: "DELETE", url: "{{base}}/users/{{userId}}", auth: { type: "bearer", token: "{{token}}" } },
        assertions: [{ type: "status", expected: 204 }],
      },
    ],
  });

describe("workflow complet contre un serveur réel", () => {
  it("enchaîne authentification, création, lecture et suppression", async () => {
    const result = await runWorkflow(fullWorkflow(), { transport, variables: { base: server.url } });

    expect(result.steps.map((s) => `${s.stepId}:${s.status}`)).toEqual([
      "login:passed",
      "create:passed",
      "get:passed",
      "delete:passed",
    ]);
    expect(result.status).toBe("passed");
    expect(result.variables.token).toBe("tok-123");
    expect(result.variables.userId).toBe("7");
    expect(result.summary.assertionsFailed).toBe(0);
    expect(result.summary.assertionsPassed).toBe(9);
  });

  it("s'arrête à la première assertion en échec", async () => {
    const result = await runWorkflow(fullWorkflow({ createStatus: 200 }), {
      transport,
      variables: { base: server.url },
    });
    expect(result.status).toBe("failed");
    expect(result.stoppedAtStepId).toBe("create");
    expect(result.steps.map((s) => s.status)).toEqual(["passed", "failed", "skipped", "skipped"]);
    expect(result.steps[1].assertions[0].message).toContain("Statut attendu 200");
  });

  it("renvoie une erreur si une variable de la requête n'est pas définie", async () => {
    const result = await runWorkflow(fullWorkflow(), { transport }); // base manquante
    expect(result.steps[0].status).toBe("error");
    expect(result.steps[0].error?.code).toBe("VALIDATION_ERROR");
    expect(result.steps[0].error?.message).toContain("base");
  });

  it("utilise les variables dynamiques dans les requêtes", async () => {
    const workflow = WorkflowSchema.parse({
      name: "dyn",
      steps: [
        {
          id: "echo",
          name: "echo",
          request: { method: "GET", url: "{{base}}/echo", headers: [{ key: "X-Id", value: "{{$uuid}}" }] },
          assertions: [{ type: "jsonPath", path: "$.headers.x-id", operator: "matches", value: "^[0-9a-f-]{36}$" }],
        },
      ],
    });
    const result = await runWorkflow(workflow, { transport, variables: { base: server.url } });
    expect(result.status).toBe("passed");
  });

  it("inclut un aperçu de la réponse", async () => {
    const result = await runWorkflow(fullWorkflow(), {
      transport,
      variables: { base: server.url },
      includePreview: true,
    });
    expect(result.steps[0].response?.preview).toContain("tok-123");
  });
});