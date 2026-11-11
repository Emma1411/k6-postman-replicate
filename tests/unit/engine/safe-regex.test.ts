import { describe, it, expect } from "vitest";
import { safeRegexExec } from "@/server/engine/vu/safe-regex";

describe("safeRegexExec", () => {
  it("renvoie les groupes", () => {
    const r = safeRegexExec("id=(\\d+)", "x id=42 y");
    expect(r).toEqual({ ok: true, match: ["id=42", "42"] });
  });

  it("renvoie null sans correspondance", () => {
    expect(safeRegexExec("zzz", "abc")).toEqual({ ok: true, match: null });
  });

  it("renvoie null pour un groupe non participant", () => {
    const r = safeRegexExec("(a)|(b)", "b");
    expect(r).toEqual({ ok: true, match: ["b", null, "b"] });
  });

  it("signale un motif invalide", () => {
    const r = safeRegexExec("(", "abc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalide/);
  });

  it("interrompt un motif à retour arrière catastrophique", () => {
    const started = Date.now();
    const r = safeRegexExec("^(a+)+$", `${"a".repeat(26)}!`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/trop lente/);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});