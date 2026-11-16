import { describe, expect, it } from "vitest";
import { GLOSSARY } from "@/client/content/glossary";
import { formatBytes, formatDuration } from "@/client/lib/format";

describe("glossaire", () => {
  it("chaque terme a un libellé et une définition utile", () => {
    for (const [term, entry] of Object.entries(GLOSSARY)) {
      expect(entry.label.length, term).toBeGreaterThan(1);
      expect(entry.definition.length, term).toBeGreaterThan(30);
      if ("example" in entry) expect(entry.example.length, term).toBeGreaterThan(5);
    }
  });
});

describe("formats", () => {
  it("formate les tailles", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1536)).toBe("1,5 Kio");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 Mio");
  });

  it("formate les durées", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(135)).toBe("2 min 15 s");
  });
});