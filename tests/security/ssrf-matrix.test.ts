import { describe, expect, it } from "vitest";
import { validateTarget } from "@/server/middlewares/ssrf-guard";

const strict = { network: { allowPrivateNetworks: false } } as never;
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 as const }];
const resolveTo = (address: string, family: 4 | 6 = 4) => async () => [{ address, family }];

const BLOCKED_LITERALS = [
  "http://127.0.0.1/", "http://127.1/", "http://0177.0.0.1/", "http://0x7f.0.0.1/",
  "http://0x7f000001/", "http://2130706433/", "http://017700000001/",
  "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/",
  "http://[0:0:0:0:0:ffff:7f00:1]/", "http://0.0.0.0/",
  "http://10.0.0.1/", "http://172.16.0.1/", "http://192.168.0.1/",
  "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/",
  "http://[fe80::1]/", "http://[fd00::1]/", "http://[64:ff9b::7f00:1]/",
];

const BLOCKED_NAMES = [
  "http://localhost/", "http://LOCALHOST:3000/", "http://localhost./",
  "http://sub.localhost/", "http://metadata.google.internal/",
  "http://db.internal/", "http://printer.local/",
];

describe("SSRF : adresses littérales", () => {
  it.each(BLOCKED_LITERALS)("bloque %s", async (url) => {
    await expect(validateTarget(url, strict, publicResolver)).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
});

describe("SSRF : noms d'hôtes", () => {
  it.each(BLOCKED_NAMES)("bloque %s", async (url) => {
    await expect(validateTarget(url, strict, publicResolver)).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
});

describe("SSRF : DNS qui pointe vers le privé (rebinding)", () => {
  it.each([
    ["127.0.0.1", 4], ["10.1.2.3", 4], ["169.254.169.254", 4], ["::1", 6], ["fe80::1", 6], ["::ffff:10.0.0.1", 6],
  ] as const)("bloque un nom public résolu en %s", async (addr, family) => {
    await expect(validateTarget("https://exemple-public.test/", strict, resolveTo(addr, family)))
      .rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("bloque si UNE seule des adresses résolues est privée", async () => {
    const mixed = async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "10.0.0.5", family: 4 as const },
    ];
    await expect(validateTarget("https://mixte.test/", strict, mixed)).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
});

describe("SSRF : schémas et identifiants", () => {
  it.each([
    "file:///etc/passwd", "ftp://exemple.test/", "gopher://exemple.test/",
    "javascript:alert(1)", "data:text/html,<script>1</script>",
    "http://exemple.test@127.0.0.1/", "http://127.0.0.1:80@exemple.test/",
  ])("refuse %s", async (url) => {
    await expect(validateTarget(url, strict, publicResolver)).rejects.toBeDefined();
  });
});

describe("SSRF : cibles légitimes", () => {
  it.each(["http://93.184.216.34/", "https://exemple.test/", "http://[2606:4700:4700::1111]/"])(
    "accepte %s", async (url) => {
      await expect(validateTarget(url, strict, publicResolver)).resolves.toBeDefined();
    },
  );
});