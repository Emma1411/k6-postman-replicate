import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logger, setLogSink } from "@/server/utils/logger";

describe("logger", () => {
  let lines: string[];
  beforeEach(() => {
    lines = [];
    setLogSink((l) => lines.push(l));
    delete process.env.LOG_LEVEL;
  });
  afterEach(() => {
    setLogSink(null);
    delete process.env.LOG_LEVEL;
  });

  it("écrit une ligne JSON avec severity compatible Cloud Logging", () => {
    logger.warn("attention", { runId: "abc" });
    const entry = JSON.parse(lines[0]);
    expect(entry.severity).toBe("WARNING");
    expect(entry.message).toBe("attention");
    expect(entry.runId).toBe("abc");
    expect(new Date(entry.time).getTime()).not.toBeNaN();
  });

  it("filtre selon LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    logger.info("ignoré");
    logger.error("gardé");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).severity).toBe("ERROR");
  });

  it("masque les secrets dans les messages et dans les erreurs", () => {
    logger.error("échec", { err: new Error("connexion refusée password=hunter2") });
    expect(lines[0]).not.toContain("hunter2");
    expect(JSON.parse(lines[0]).error.name).toBe("Error");
  });

  it("un champ ne peut pas écraser severity", () => {
    logger.info("x", { severity: "CRITICAL" });
    expect(JSON.parse(lines[0]).severity).toBe("INFO");
  });
});