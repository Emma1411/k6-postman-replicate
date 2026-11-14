import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importOpenApi } from "@/shared/collections/openapi-import";
import { collectionToWorkflow } from "@/shared/collections/utils";
import { runWorkflow } from "@/server/engine/vu/run-workflow";
import { createHttpTransport } from "@/server/services/workflow/http-transport";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { startTargetServer, type TargetServer } from "../target-server/server";

const transport = createHttpTransport({ limits: buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" })) });

let server: TargetServer;
beforeAll(async () => {
  server = await startTargetServer();
});
afterAll(async () => {
  await server.close();
});

const spec = () => ({
  openapi: "3.0.3",
  info: { title: "Cible", version: "1" },
  servers: [{ url: server.url }],
  paths: {
    "/echo": {
      get: {
        summary: "Echo conforme",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["method", "path", "headers", "body"],
                  properties: {
                    method: { type: "string", enum: ["GET"] },
                    path: { type: "string" },
                    headers: { type: "object" },
                    body: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/status/404": {
      get: { summary: "Déclaré 200, renvoie 404", responses: { "200": { description: "ok" } } },
    },
    "/gzip": {
      get: {
        summary: "Schéma erroné",
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { type: "object", required: ["hello"], properties: { hello: { type: "integer" } } } } },
          },
        },
      },
    },
  },
});

describe("tests de contrat générés depuis OpenAPI", () => {
  it("passent quand l'API respecte sa spécification et échouent clairement sinon", async () => {
    const { value } = importOpenApi(spec());
    const { workflow } = collectionToWorkflow(value);
    expect(workflow.variables.baseUrl).toBe(server.url);

    const result = await runWorkflow(workflow, { transport });
    const byName = Object.fromEntries(result.steps.map((s) => [s.name, s]));

    expect(byName["Echo conforme"].status).toBe("passed");
    expect(byName["Echo conforme"].assertions.map((a) => a.passed)).toEqual([true, true]);

    // l'API renvoie 404 alors que la spécification déclare 200
    expect(byName["Déclaré 200, renvoie 404"].status).toBe("failed");
    expect(byName["Déclaré 200, renvoie 404"].assertions[0].message).toContain("Statut attendu 200, reçu 404");

    // l'API renvoie hello: "gzip" (texte) alors que la spécification déclare un entier
    expect(byName["Schéma erroné"].status).toBe("failed");
    expect(byName["Schéma erroné"].assertions[1].message).toContain("$.hello");

    expect(result.status).toBe("failed");
    expect(result.summary).toMatchObject({ passed: 1, failed: 2 });
  });
});