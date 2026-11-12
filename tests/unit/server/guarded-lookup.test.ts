import { describe, it, expect } from "vitest";
import type { LookupAddress } from "node:dns";
import { assertUrlAllowed, createGuardedLookup } from "@/server/middlewares/ssrf-guard";

const strict = { network: { allowPrivateNetworks: false } };
const permissive = { network: { allowPrivateNetworks: true } };

function lookup(limits: typeof strict, hostname: string) {
  return new Promise<{ err: NodeJS.ErrnoException | null; addresses: LookupAddress[] | string }>((resolve) => {
    createGuardedLookup(limits)(hostname, { all: true }, (err, addresses) => resolve({ err, addresses }));
  });
}

describe("createGuardedLookup", () => {
  it("refuse un nom qui résout vers une adresse privée", async () => {
    const { err } = await lookup(strict, "localhost");
    expect(err?.code).toBe("ESSRFBLOCKED");
  });

  it("laisse passer quand les réseaux privés sont autorisés", async () => {
    const { err, addresses } = await lookup(permissive, "localhost");
    expect(err).toBeNull();
    expect((addresses as LookupAddress[]).length).toBeGreaterThan(0);
  });

  it("renvoie l'erreur DNS d'un nom introuvable", async () => {
    const { err } = await lookup(strict, "introuvable.invalid");
    expect(err).not.toBeNull();
    expect(err?.code).not.toBe("ESSRFBLOCKED");
  });
});

describe("assertUrlAllowed", () => {
  it("accepte une URL publique sans résoudre le DNS", () => {
    expect(assertUrlAllowed("https://example.com/a?b=1", strict).hostname).toBe("example.com");
  });

  it.each(["http://127.0.0.1/", "http://2130706433/", "http://[::1]/", "http://localhost/", "http://169.254.169.254/"])(
    "bloque %s",
    (url) => {
      expect(() => assertUrlAllowed(url, strict)).toThrow(/non autorisée/);
    },
  );

  it("refuse les protocoles et identifiants interdits", () => {
    expect(() => assertUrlAllowed("ftp://example.com", strict)).toThrow(/protocoles/);
    expect(() => assertUrlAllowed("https://u:p@example.com", strict)).toThrow(/identifiants/);
    expect(() => assertUrlAllowed("pas une url", strict)).toThrow(/invalide/);
  });

  it("autorise le réseau privé en développement", () => {
    expect(assertUrlAllowed("http://127.0.0.1:3000/", permissive).port).toBe("3000");
  });
});