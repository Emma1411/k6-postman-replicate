import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowSchema } from "@/shared/schemas/workflow";
import { HttpRequestSchema } from "@/shared/schemas/http";
import { ReportExportInputSchema } from "@/shared/schemas/reports";
import { parseCollection } from "@/shared/schemas/collection";
import { queryJsonPath } from "@/shared/jsonpath";
import { toErrorResponse } from "@/server/middlewares/error-handler";
import { setLogSink } from "@/server/utils/logger";
import nextConfig from "../../next.config";

describe("pollution de prototype", () => {
  it("des payloads hostiles ne modifient pas Object.prototype", () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":"oui"},"constructor":{"prototype":{"polluted":"oui"}},' +
        '"variables":{"__proto__":"x","constructor":"y"},"steps":[]}',
    );

    WorkflowSchema.safeParse(hostile);
    ReportExportInputSchema.safeParse(hostile);
    HttpRequestSchema.safeParse(hostile);

    const hostileCollection = {
      format: "api-engineering-platform/collection",
      version: 1,
      id: "test",
      name: "Collection hostile",
      variables: [],
      items: [
        {
          ...hostile,
          type: "request",
          id: "request-1",
          name: "Requête hostile",
          request: {
            method: "GET",
            url: "https://example.com",
          },
        },
      ],
    };

    parseCollection(hostileCollection);

    queryJsonPath({ a: 1 }, "$.__proto__.polluted");
    queryJsonPath(hostile, "$.constructor.prototype.polluted");

    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("fuite d'informations", () => {
  it("une erreur inattendue ne renvoie ni message interne ni secret, et le log est masqué", async () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    try {
      const res = toErrorResponse(new Error("échec base password=hunter2 sur /srv/app/db.ts"));
      const body = JSON.stringify(await res.json());
      expect(res.status).toBe(500);
      expect(body).not.toContain("hunter2");
      expect(body).not.toContain("/srv/app");
      expect(lines.join("\n")).not.toContain("hunter2");
    } finally {
      setLogSink(null);
    }
  });
});

describe("garde-fou statique sur src/", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.resolve(__dirname, "../../src"));

  it("aucun eval, new Function ni processus enfant", () => {
    const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /child_process/, /\bexecSync\s*\(/, /\bspawnSync\s*\(/];
    const hits = files.flatMap((f) => {
      const text = fs.readFileSync(f, "utf8");
      return forbidden.filter((re) => re.test(text)).map((re) => `${path.relative(process.cwd(), f)} : ${re}`);
    });
    expect(hits).toEqual([]);
  });

  it("node:vm n'est importé que par safe-regex", () => {
    const users = files
      .filter((f) => /from\s+["'](node:)?vm["']/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.basename(f));
    expect(users).toEqual(["safe-regex.ts"]);
  });
});

describe("en-têtes de sécurité", () => {
  it("next.config applique nosniff, anti-frame et no-store sur l'API", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!.headers.map((h) => h.key);
    expect(all).toEqual(expect.arrayContaining(["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]));
    const api = rules.find((r) => r.source === "/api/:path*")!.headers;
    expect(api).toContainEqual({ key: "Cache-Control", value: "no-store" });
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});