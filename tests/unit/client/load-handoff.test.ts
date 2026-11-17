import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDraft } from "@/client/features/requests/model";
import { saveLoadHandoff, takeLoadHandoff } from "@/client/features/requests/load-handoff";
import { clearAll, setSetting } from "@/client/storage/repositories";

beforeEach(async () => {
  await clearAll();
});

describe("passage de la requête au test de charge", () => {
  it("transmet la requête une seule fois", async () => {
    const draft = { ...emptyDraft(), url: "https://x.test" };
    await saveLoadHandoff({ draft, variables: { a: "1" }, createdAt: 1000 });
    const taken = await takeLoadHandoff(60_000, 2000);
    expect(taken?.draft.url).toBe("https://x.test");
    expect(taken?.variables).toEqual({ a: "1" });
    expect(await takeLoadHandoff(60_000, 2000)).toBeNull();
  });

  it("ignore une cible trop ancienne", async () => {
    await saveLoadHandoff({ draft: emptyDraft(), variables: {}, createdAt: 1000 });
    expect(await takeLoadHandoff(60_000, 1000 + 61_000)).toBeNull();
  });

  it("ignore des données invalides", async () => {
    await setSetting("pending-load-target", { draft: { method: "GET" }, variables: {}, createdAt: 1000 });
    expect(await takeLoadHandoff(60_000, 1500)).toBeNull();
  });

  it("renvoie null quand il n'y a rien", async () => {
    expect(await takeLoadHandoff()).toBeNull();
  });
});