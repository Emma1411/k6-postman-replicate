import { describe, it, expect } from "vitest";
import {
  createPinnedLookup,
  isBlockedAddress,
  isBlockedHostname,
  validateTarget,
  type Resolver,
} from "@/server/middlewares/ssrf-guard";

const strict = { network: { allowPrivateNetworks: false } };
const permissive = { network: { allowPrivateNetworks: true } };

const resolverTo =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fe80::1%eth0",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
    "pas-une-ip",
  ])("bloque %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"])(
    "autorise %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("isBlockedHostname", () => {
  it.each(["localhost", "app.localhost", "metadata.google.internal", "db.internal", "printer.local"])(
    "bloque %s",
    (host) => {
      expect(isBlockedHostname(host)).toBe(true);
    },
  );

  it("autorise un domaine public", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
  });
});

describe("validateTarget", () => {
  it("accepte un domaine public et renvoie l'adresse à utiliser", async () => {
    const t = await validateTarget("https://example.com/path?x=1", strict, resolverTo("93.184.216.34"));
    expect(t.address).toBe("93.184.216.34");
    expect(t.family).toBe(4);
    expect(t.hostname).toBe("example.com");
  });

  it.each(["ftp://example.com", "file:///etc/passwd", "gopher://example.com"])(
    "refuse le protocole de %s",
    async (url) => {
      await expect(validateTarget(url, strict, resolverTo("93.184.216.34"))).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    },
  );

  it("refuse les identifiants dans l'URL", async () => {
    await expect(
      validateTarget("https://user:pass@example.com", strict, resolverTo("93.184.216.34")),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuse une URL invalide", async () => {
    await expect(validateTarget("pas une url", strict)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it.each([
    "http://127.0.0.1/",
    "http://2130706433/", // 127.0.0.1 en décimal
    "http://0x7f.1/", // 127.0.0.1 en hexadécimal
    "http://[::1]/",
    "http://localhost:3000/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
  ])("bloque %s", async (url) => {
    await expect(validateTarget(url, strict, resolverTo("93.184.216.34"))).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("bloque un domaine public qui résout vers une IP privée", async () => {
    await expect(validateTarget("https://evil.example", strict, resolverTo("10.0.0.5"))).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("bloque si une seule des adresses résolues est privée", async () => {
    await expect(
      validateTarget("https://evil.example", strict, resolverTo("8.8.8.8", "192.168.0.10")),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("signale un échec DNS", async () => {
    const failing: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(validateTarget("https://nope.example", strict, failing)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("autorise les réseaux privés quand la config le permet (dev)", async () => {
    const t = await validateTarget("http://localhost:4000/", permissive, resolverTo("127.0.0.1"));
    expect(t.address).toBe("127.0.0.1");
  });
});

describe("createPinnedLookup", () => {
  it("renvoie toujours l'adresse validée, avec ou sans option all", async () => {
    const lookup = createPinnedLookup("93.184.216.34", 4);

    const all = await new Promise((resolve) => lookup("x.test", { all: true }, (_e, a) => resolve(a)));
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);

    const single = await new Promise((resolve) => lookup("x.test", {}, (_e, a, f) => resolve([a, f])));
    expect(single).toEqual(["93.184.216.34", 4]);
  });
});