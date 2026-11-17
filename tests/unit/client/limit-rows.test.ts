import { describe, expect, it } from "vitest";
import { buildLimitRows } from "@/client/content/limit-rows";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { buildPublicConfig } from "@/server/config/public-config";

const env = parseEnv({});
const rows = buildLimitRows(buildPublicConfig(env, buildLimits(env), true));
const value = (start: string) => rows.find((r) => r.label.startsWith(start))?.value;

describe("buildLimitRows", () => {
  it("affiche les plafonds par défaut de l'instance", () => {
    expect(value("Utilisateurs")).toBe("100");
    expect(value("Durée")).toBe("2 min");
    expect(value("Débit")).toBe("500 req/s");
    expect(value("Taille")).toBe("5 Mio");
    expect(value("Délai")).toBe("30 s");
    expect(value("Appels")).toBe("120 par 1 min");
    expect(value("Étapes")).toBe("50");
  });

  it("explique chaque limite", () => {
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(row.why.length).toBeGreaterThan(15);
  });
});