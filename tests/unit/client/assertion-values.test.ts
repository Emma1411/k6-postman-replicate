import { describe, expect, it } from "vitest";
import { formatPrimitive, formatStatus, parsePrimitive, parseStatusList } from "@/client/features/requests/assertion-values";

describe("parsePrimitive", () => {
  it("lit les nombres, booléens et null comme tels", () => {
    expect(parsePrimitive("482")).toBe(482);
    expect(parsePrimitive("-1.5")).toBe(-1.5);
    expect(parsePrimitive("true")).toBe(true);
    expect(parsePrimitive("null")).toBeNull();
  });

  it("garde le reste comme du texte", () => {
    expect(parsePrimitive("abc")).toBe("abc");
    expect(parsePrimitive("")).toBe("");
    expect(parsePrimitive("{")).toBe("{");
    expect(parsePrimitive("[1]")).toBe("[1]");
  });

  it("permet de forcer une chaîne avec des guillemets", () => {
    expect(parsePrimitive('"482"')).toBe("482");
  });
});

describe("formatPrimitive", () => {
  it("affiche les valeurs pour qu'un aller-retour ne change rien", () => {
    for (const value of [482, true, false, null, "abc", "482", "true", "null", "", "a b"]) {
      expect(parsePrimitive(formatPrimitive(value))).toBe(value);
    }
    expect(formatPrimitive(undefined)).toBe("");
    expect(formatPrimitive("482")).toBe('"482"');
    expect(formatPrimitive("abc")).toBe("abc");
  });
});

describe("codes de statut", () => {
  it("lit un code ou une liste", () => {
    expect(parseStatusList("200")).toBe(200);
    expect(parseStatusList("200, 201 ,204")).toEqual([200, 201, 204]);
    expect(parseStatusList("200,200")).toBe(200);
  });

  it("refuse les valeurs invalides", () => {
    for (const bad of ["", "99", "600", "abc", "200;201", "20"]) expect(parseStatusList(bad)).toBeNull();
  });

  it("affiche un code ou une liste", () => {
    expect(formatStatus(200)).toBe("200");
    expect(formatStatus([200, 201])).toBe("200, 201");
  });
});