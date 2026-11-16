import { afterEach, describe, expect, it } from "vitest";
import { setFetch } from "@/client/api/client";
import { makeStore } from "@/client/store";
import { loadConfig } from "@/client/store/config-slice";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { buildPublicConfig } from "@/server/config/public-config";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => setFetch(null));

describe("configuration de l'instance", () => {
  it("charge la configuration publique produite par le serveur", async () => {
    const env = parseEnv({});
    const config = buildPublicConfig(env, buildLimits(env), true);
    setFetch((async () => json(config)) as unknown as typeof fetch);

    const store = makeStore();
    expect(store.getState().config.status).toBe("idle");
    await store.dispatch(loadConfig());
    expect(store.getState().config).toEqual({ status: "ready", value: config });
  });

  it("garde le message d'erreur du serveur", async () => {
    setFetch((async () => json({ error: { code: "INTERNAL_ERROR", message: "Boum" } }, 500)) as unknown as typeof fetch);
    const store = makeStore();
    await store.dispatch(loadConfig());
    expect(store.getState().config).toEqual({ status: "error", message: "Boum" });
  });
});