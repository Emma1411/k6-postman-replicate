import { describe, expect, it } from "vitest";
import { importController } from "@/server/controllers/import.controller";
import { AppError } from "@/server/utils/errors";
import { ImportInputSchema } from "@/shared/schemas";
import { col, req } from "../../helpers/postman-fixtures";

const call = (input: unknown) => importController(ImportInputSchema.parse(input));

describe("importController", () => {
  const collection = col([req("Santé", { method: "GET", url: "{{base}}/health" })], { variable: [{ key: "base", value: "http://x" }] });

  it("importe une collection donnée en texte ou en objet", async () => {
    for (const content of [JSON.stringify(collection), collection]) {
      const body = await call({ source: "postman-collection", content }).json();
      expect(body.source).toBe("postman-collection");
      expect(body.collection.name).toBe("Test");
      expect(body.collection.items).toHaveLength(1);
      expect(body.stats).toEqual({ requests: 1, folders: 0, skipped: 0 });
      expect(body.warnings).toEqual([]);
    }
  });

  it("accepte un fichier avec BOM", async () => {
    const body = await call({ source: "postman-collection", content: `\uFEFF${JSON.stringify(collection)}` }).json();
    expect(body.collection.name).toBe("Test");
  });

  it("importe un environnement", async () => {
    const body = await call({
      source: "postman-environment",
      content: { name: "Dev", values: [{ key: "base", value: "http://x", enabled: true }] },
    }).json();
    expect(body.environment.name).toBe("Dev");
    expect(body.environment.variables).toHaveLength(1);
  });

  it("renvoie une erreur de validation claire pour un JSON invalide ou qui n'est pas une collection", () => {
    expect(() => call({ source: "postman-collection", content: "{pas du json" })).toThrow(AppError);
    try {
      call({ source: "postman-collection", content: { autre: true } });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe("VALIDATION_ERROR");
      expect((e as AppError).message).toContain("collection Postman");
    }
  });

  it("refuse une source inconnue", () => {
    expect(ImportInputSchema.safeParse({ source: "inconnue", content: "{}" }).success).toBe(false);
  });
});