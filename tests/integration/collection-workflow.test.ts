import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionToWorkflow } from "@/shared/collections/utils";
import { runWorkflow } from "@/server/engine/vu/run-workflow";
import { createHttpTransport } from "@/server/services/workflow/http-transport";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { COLLECTION_FORMAT, ENVIRONMENT_FORMAT, parseCollection, parseEnvironment } from "@/shared/schemas";
import { startTargetServer, type TargetServer } from "../target-server/server";

const transport = createHttpTransport({ limits: buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" })) });

let server: TargetServer;
beforeAll(async () => {
  server = await startTargetServer();
});
afterAll(async () => {
  await server.close();
});

const collection = () =>
  parseCollection({
    format: COLLECTION_FORMAT,
    version: 1,
    id: "boutique",
    name: "Boutique",
    variables: [{ key: "base", value: "http://invalide" }, { key: "token", value: "a-remplacer" }],
    // Authentification de la collection : héritée par la création d'utilisateur, une fois le jeton extrait.
    auth: { type: "bearer", token: "{{token}}" },
    items: [
      {
        type: "request",
        id: "login",
        name: "Connexion",
        authMode: "own",
        request: { method: "POST", url: "{{base}}/login", body: { type: "json", content: "{}" } },
        tests: [{ type: "status", expected: 200 }],
        extract: [{ variable: "token", from: "jsonPath", path: "$.token" }],
      },
      {
        type: "request",
        id: "create",
        name: "Création",
        authMode: "inherit",
        request: { method: "POST", url: "{{base}}/users", body: { type: "json", content: '{"name":"emma"}' } },
        tests: [{ type: "status", expected: 201 }, { type: "jsonPath", path: "$.name", operator: "equals", value: "emma" }],
      },
    ],
  });

describe("une collection s'exécute comme un workflow", () => {
  it("utilise l'environnement, hérite de l'authentification et enchaîne les variables extraites", async () => {
    const env = parseEnvironment({ format: ENVIRONMENT_FORMAT, version: 1, id: "dev", name: "Dev", variables: [{ key: "base", value: server.url }] });
    const { workflow } = collectionToWorkflow(collection(), { environment: env });

    const result = await runWorkflow(workflow, { transport });
    expect(result.steps.map((s) => `${s.stepId}:${s.status}`)).toEqual(["login:passed", "create:passed"]);
    expect(result.variables.token).toBe("tok-123"); // extrait de la connexion, utilisé par l'authentification héritée
    expect(result.status).toBe("passed");
  });

  it("échoue clairement quand l'authentification héritée n'est pas la bonne", async () => {
    // sans connexion préalable : le jeton de la collection est refusé (401)
    const env = parseEnvironment({ format: ENVIRONMENT_FORMAT, version: 1, id: "dev", name: "Dev", variables: [{ key: "base", value: server.url }] });
    const { workflow } = collectionToWorkflow(collection(), { environment: env, folderId: undefined });
    const onlyCreate = { ...workflow, steps: workflow.steps.filter((s) => s.id === "create") };

    const result = await runWorkflow(onlyCreate, { transport });
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].assertions[0].message).toContain("401");
  });
});