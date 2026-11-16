import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeVariables,
  chooseEnvironment,
  loadEnvironments,
  newEnvironment,
  removeEnvironment,
  selectActiveVariables,
  upsertEnvironment,
} from "@/client/features/requests/environments-slice";
import { makeStore } from "@/client/store";
import { clearAll } from "@/client/storage/repositories";

beforeEach(async () => {
  await clearAll();
});

describe("environnements", () => {
  it("crée, choisit, recharge puis supprime", async () => {
    const store = makeStore();
    const env = newEnvironment("Production");
    env.variables.push({
      key: "base_url",
      value: "https://api.exemple.com",
      enabled: true,
      secret: false,
    });

    await store.dispatch(upsertEnvironment(env));
    await store.dispatch(chooseEnvironment(env.id));
    expect(selectActiveVariables(store.getState())).toEqual({
      base_url: "https://api.exemple.com",
    });

    const fresh = makeStore();
    await fresh.dispatch(loadEnvironments());
    expect(fresh.getState().environments.items).toHaveLength(1);
    expect(fresh.getState().environments.selectedId).toBe(env.id);

    await store.dispatch(removeEnvironment(env.id));
    expect(store.getState().environments.items).toEqual([]);
    expect(store.getState().environments.selectedId).toBeNull();

    const afterDelete = makeStore();
    await afterDelete.dispatch(loadEnvironments());
    expect(afterDelete.getState().environments.selectedId).toBeNull();
  });

  it("ignore une sélection qui n'existe plus", async () => {
    const store = makeStore();
    await store.dispatch(chooseEnvironment("fantome"));
    const fresh = makeStore();
    await fresh.dispatch(loadEnvironments());
    expect(fresh.getState().environments.selectedId).toBeNull();
  });
});

describe("activeVariables", () => {
  it("ne garde que les noms de variables valides", () => {
    const env = newEnvironment("Test");
    env.variables.push(
      { key: "ok_1", value: "a", enabled: true, secret: false },
      { key: "mauvais nom", value: "b", enabled: true, secret: false },
      { key: "1invalide", value: "c", enabled: true, secret: false },
    );
    expect(activeVariables(env)).toEqual({ ok_1: "a" });
    expect(activeVariables(undefined)).toEqual({});
  });
});
