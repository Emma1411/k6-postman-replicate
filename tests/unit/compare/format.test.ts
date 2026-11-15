import { describe, expect, it } from "vitest";
import { formatNumber, formatSigned } from "@/shared/format";

describe("formatNumber", () => {
  it("utilise la virgule, l'espace insécable et supprime les zéros inutiles", () => {
    expect(formatNumber(1234567.891, 1)).toBe("1\u00A0234\u00A0567,9");
    expect(formatNumber(12.5, 2)).toBe("12,5");
    expect(formatNumber(200, 2)).toBe("200");
    expect(formatNumber(-1234.5, 1)).toBe("-1\u00A0234,5");
  });

  it("ne produit jamais « -0 » et gère les valeurs non finies", () => {
    expect(formatNumber(-0.004, 2)).toBe("0");
    expect(formatNumber(0, 1)).toBe("0");
    expect(formatNumber(NaN)).toBe("—");
    expect(formatNumber(Infinity)).toBe("—");
  });

  it("ajoute le signe « + » aux valeurs positives", () => {
    expect(formatSigned(30, 1)).toBe("+30");
    expect(formatSigned(-4.25, 2)).toBe("-4,25");
    expect(formatSigned(0, 1)).toBe("0");
  });
});