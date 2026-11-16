import {  beforeAll, afterAll, describe, expect, it } from "vitest";
import { shutdown } from "@/server/engine/runs/shutdown";
// Reprends la fabrique de registre (workers en processus) et le helper de scénario
// déjà utilisés dans tests/integration/load-run.test.ts :
import { makeRegistry, makeScenario, startTarget, type Target } from "../helpers/load-fixtures";

describe("arrêt propre", () => {
  let target: Target;
  beforeAll(async () => { target = await startTarget(); });
  afterAll(async () => { await target.close(); });

  it("annule les tests en cours et envoie l'événement finished", async () => {
    const registry = makeRegistry();
    const run = registry.create(makeScenario(target.url, { type: "constant-vus", vus: 2, durationSeconds: 30 }));
    const events: string[] = [];
    run.subscribe((e) => events.push(e.type));
    await new Promise((r) => setTimeout(r, 800));

    await shutdown(registry, 5000);

    const result = await run.finished;
    expect(result.status).toBe("aborted");
    expect(result.abortReason).toContain("Arrêt du serveur");
    expect(events.at(-1)).toBe("finished");
  });

  it("waitForIdle rend false au délai si un test tourne encore", async () => {
    const registry = makeRegistry();
    const run = registry.create(makeScenario(target.url, { type: "constant-vus", vus: 1, durationSeconds: 30 }));
    expect(await registry.waitForIdle(100)).toBe(false);
    registry.cancelAll("fin du test");
    await run.finished;
    expect(await registry.waitForIdle(100)).toBe(true);
  });

  it("ne fait rien sans registre", async () => {
    await expect(shutdown(undefined)).resolves.toBeUndefined();
  });
});