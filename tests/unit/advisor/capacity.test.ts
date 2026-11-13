import { describe, it, expect } from "vitest";
import { AdvisorInputError } from "@/shared/advisor/capacity/errors";
import { planCapacity } from "@/shared/advisor/capacity/plan";
import { buildVerificationScenario } from "@/shared/advisor/capacity/verification";
import {
  CapacityInputSchema,
  WorkflowSchema,
  normalizeCapacityInput,
  type CapacityInput,
} from "@/shared/schemas";
import { latencyKnee, makeRun, ramp } from "../../helpers/advisor-fixtures";

const plan = (input: unknown) =>
  planCapacity(
    normalizeCapacityInput(CapacityInputSchema.parse(input) as CapacityInput),
  );
const gb = (
  instances: number,
  vcpu: number,
  ram: number,
  name: string,
  extra: object = {},
) => ({
  name,
  instances,
  vcpuPerInstance: vcpu,
  ramGbPerInstance: ram,
  ...extra,
});

describe("mode prédictif : comparaison d'architectures", () => {
  // 10 ms de CPU par requête, p95 de base 80 ms, objectif 400 req/s avec 30 % de marge (520 req/s requis), p95 < 300 ms
  const base = {
    mode: "predictive",
    service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
    objectives: { targetRps: 400, p95MaxMs: 300, headroomPercent: 30 },
    configs: [gb(1, 2, 4, "A"), gb(2, 2, 4, "B"), gb(2, 4, 8, "C")],
  };

  it("estime la capacité avec la loi d'Amdahl et une fourchette", () => {
    const [a, b, c] = plan(base).scenarios;
    // A : 0,75 × 2 × 1000 / 10 = 150 req/s ; B : 150 × 2/1,05 ; C : 300 × 2/1,05
    expect(a.capacity.estimateRps).toBeCloseTo(150, 6);
    expect(b.capacity.estimateRps).toBeCloseTo(285.714, 2);
    expect(c.capacity.estimateRps).toBeCloseTo(571.429, 2);
    expect(c.capacity.lowRps).toBeCloseTo(419.6, 0); // coût CPU +30 %, fraction série doublée
    expect(c.capacity.highRps as number).toBeGreaterThan(
      c.capacity.estimateRps as number,
    );
    expect(c.capacity.limitedBy).toBe("cpu");
    expect(c.capacity.maxTargetRps).toBeCloseTo(571.4 / 1.3, 0);
    expect(c.confidence).toBe("low");
  });

  it("rend un verdict nuancé : insuffisant, insuffisant, marginal", () => {
    const [a, b, c] = plan(base).scenarios;
    expect(a.verdict).toBe("insufficient");
    expect(b.verdict).toBe("insufficient");
    expect(c.verdict).toBe("marginal"); // l'estimation centrale tient, pas le cas pessimiste
    expect(c.checks.capacity.status).toBe("marginal");
    expect(c.checks.capacity.detail).toContain("pessimiste");
  });

  it("estime le p95 par la file d'attente et détecte l'instabilité", () => {
    const [a, b, c] = plan(base).scenarios;
    // C : 200 req/s par instance sur 4 vCPU de 10 ms → ρ = 0,5, p95 ≈ 80 + 6,2 ms
    expect(c.atTarget.cpuUtilizationPercent).toBeCloseTo(50, 6);
    expect(c.atTarget.p95Ms as number).toBeGreaterThan(80);
    expect(c.atTarget.p95Ms as number).toBeLessThan(100);
    expect(c.atTarget.p95PessimisticMs as number).toBeGreaterThan(
      c.atTarget.p95Ms as number,
    );
    expect(c.checks.latency.status).toBe("ok");
    // A et B saturent à 400 req/s
    expect(a.checks.latency.status).toBe("fail");
    expect(a.atTarget.p95Ms).toBeNull();
    expect(b.checks.latency.detail).toContain("saturent");
  });

  it("choisit la plus petite configuration qui tient l'objectif", () => {
    const result = plan(base);
    expect(result.best?.index).toBe(2);
    expect(result.best?.reason).toContain("estimation centrale");
    expect(result.best?.reason).toContain("test de charge");
  });

  it("compare à une configuration actuelle (simulation)", () => {
    const result = plan({ ...base, baseline: gb(1, 2, 4, "Actuelle") });
    expect(result.baseline?.name).toBe("Actuelle");
    expect(result.scenarios[1].vsBaseline?.capacityChangePercent).toBeCloseTo(
      90.5,
      1,
    );
    expect(result.scenarios[2].vsBaseline?.capacityChangePercent).toBeCloseTo(
      280.9,
      0,
    );
  });

  it("liste les hypothèses avec leur origine", () => {
    const { assumptions } = plan({
      ...base,
      assumptions: { scaleOutSerialFraction: 0.1 },
    });
    const byKey = Object.fromEntries(assumptions.map((a) => [a.key, a]));
    expect(byKey.cpuMsPerRequest.source).toBe("user-provided");
    expect(byKey.scaleOutSerialFraction.source).toBe("user-provided");
    expect(byKey.serviceVariability.source).toBe("default");
    expect(byKey.dbConnectionHeadroom.source).toBe("default");
  });

  it("n'estime pas la mémoire sans modèle, et signale ce qui n'est pas vérifié", () => {
    const [, , c] = plan(base).scenarios;
    expect(c.checks.memory.status).toBe("unknown");
    expect(c.unchecked).toEqual(
      expect.arrayContaining(["mémoire", "connexions de la base"]),
    );
  });
});

describe("mémoire et base de données", () => {
  const base = {
    mode: "predictive",
    service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
    objectives: { targetRps: 400, p95MaxMs: 300, headroomPercent: 30 },
  };

  it("estime la mémoire d'après la charge par instance (loi de Little)", () => {
    // 2 instances : 200 req/s chacune × 0,08 s = 16 requêtes en cours × 2 Mo + 300 Mo de base = 332 Mo sur 4096
    const assumptions = { memoryBaseMb: 300, memoryPerInflightMb: 2 };
    const [c] = plan({
      ...base,
      assumptions,
      configs: [gb(2, 4, 4, "C")],
    }).scenarios;
    expect(c.atTarget.memoryPercent).toBeCloseTo((332 / 4096) * 100, 1);
    expect(c.checks.memory.status).toBe("ok");

    const [heavy] = plan({
      ...base,
      assumptions: { memoryBaseMb: 300, memoryPerInflightMb: 200 },
      configs: [gb(2, 4, 4, "C")],
    }).scenarios;
    expect(heavy.checks.memory.status).toBe("fail");
    expect(heavy.verdict).toBe("insufficient");
  });

  it("vérifie les connexions de la base avec une arithmétique exacte", () => {
    const configs = [
      gb(4, 4, 8, "ok", { poolSizePerInstance: 20, dbMaxConnections: 100 }),
      gb(5, 4, 8, "trop", { poolSizePerInstance: 20, dbMaxConnections: 100 }),
    ];
    const [ok, trop] = plan({ ...base, configs }).scenarios;
    expect(ok.atTarget.databaseConnections).toBe(80);
    expect(ok.checks.database.status).toBe("ok"); // 80 ≤ 90 utilisables
    expect(trop.checks.database.status).toBe("fail"); // 100 > 90
    expect(trop.checks.database.detail).toContain("5 × 20 = 100");
    expect(trop.verdict).toBe("insufficient");
  });

  it("applique la marge de connexions configurée", () => {
    const configs = [
      gb(5, 4, 8, "x", { poolSizePerInstance: 20, dbMaxConnections: 100 }),
    ];
    const [r] = plan({
      ...base,
      configs,
      assumptions: { dbConnectionHeadroom: 0 },
    }).scenarios;
    expect(r.checks.database.status).toBe("ok");
  });
});

describe("dimensionnement", () => {
  const base = {
    mode: "predictive",
    service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
    objectives: { targetRps: 400, p95MaxMs: 300, headroomPercent: 30 },
  };

  it("trouve le nombre minimal et le nombre recommandé d'instances", () => {
    const { sizing } = plan({ ...base, configs: [gb(1, 2, 4, "A")] });
    expect(sizing.minimumInstances).toBe(4); // estimation centrale : 521,7 req/s ≥ 520
    expect(sizing.recommendedInstances).toBe(8); // cas pessimiste : 543 req/s ≥ 520
    expect(sizing.recommended?.verdict).toBe("ok");
    expect(sizing.explanation).toContain("8 instances");
    expect(sizing.explanation).toContain("4 instances suffisent");
  });

  it("calcule le plafond de la mise à l'échelle horizontale", () => {
    // 150 req/s par instance / fraction série 0,05 = 3 000 req/s au maximum
    const { sizing } = plan({ ...base, configs: [gb(1, 2, 4, "A")] });
    expect(sizing.scaleOutLimitRps).toBeCloseTo(3000, 0);
  });

  it("explique qu'aucun nombre d'instances ne suffit quand le plafond est trop bas", () => {
    const { sizing } = plan({
      ...base,
      objectives: { targetRps: 5000, p95MaxMs: 300, headroomPercent: 30 },
      configs: [gb(1, 2, 4, "A")],
    });
    expect(sizing.minimumInstances).toBeNull();
    expect(sizing.recommendedInstances).toBeNull();
    expect(sizing.explanation).toContain("plafonne autour de 3000");
  });

  it("respecte la limite de connexions de la base", () => {
    const { sizing } = plan({
      ...base,
      configs: [
        gb(1, 2, 4, "A", { poolSizePerInstance: 20, dbMaxConnections: 100 }),
      ],
    });
    expect(sizing.databaseMaxInstances).toBe(4);
    expect(sizing.minimumInstances).toBe(4);
    expect(sizing.recommendedInstances).toBeNull();
    expect(sizing.explanation).toContain("plafonne à 4 instances");
  });

  it("utilise la taille d'instance demandée", () => {
    const { sizing } = plan({
      ...base,
      configs: [gb(1, 2, 4, "A")],
      sizingTemplate: { vcpuPerInstance: 4, ramGbPerInstance: 8 },
    });
    expect(sizing.template).toEqual({
      vcpuPerInstance: 4,
      ramGbPerInstance: 8,
    });
    expect(sizing.recommendedInstances as number).toBeLessThan(8);
  });

  it("répond à « combien d'instances pour 5 000 utilisateurs simultanés ? »", () => {
    // 5 000 utilisateurs, itération de 10 s, 2 requêtes par itération → 1 000 req/s
    const { target, sizing } = plan({
      mode: "predictive",
      service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
      objectives: {
        targetVus: 5000,
        iterationSeconds: 10,
        requestsPerIteration: 2,
        p95MaxMs: 300,
        headroomPercent: 30,
      },
      configs: [gb(1, 4, 8, "T")],
    });
    expect(target.targetRps).toBe(1000);
    expect(target.requiredRps).toBe(1300);
    expect(sizing.recommendedInstances).not.toBeNull();
  });
});

describe("mode mesuré", () => {
  // 20 ms de CPU par requête sur 2 vCPU : le CPU est le goulot
  const cpuBound = makeRun({
    seconds: 80,
    rps: (t) => 5 + t,
    p95: (t) => (t < 55 ? 40 : 40 + (t - 55) * 20),
    cpu: (t) => 5 + (5 + t),
    instances: 1,
    vcpu: 2,
    ramGb: 4,
  });
  const objectives = { targetRps: 60, p95MaxMs: 200, headroomPercent: 30 };
  const measured = (extra: object) =>
    plan({ mode: "measured", objectives, ...extra });

  it("calibre le coût CPU et conclut que le CPU est le goulot", () => {
    const result = measured({
      runs: [cpuBound],
      configs: [gb(2, 2, 4, "2 × 2 vCPU")],
    });
    const cpu = result.assumptions.find((a) => a.key === "cpuMsPerRequest");
    expect(cpu?.source).toBe("calibrated");
    expect(cpu?.value).toBe("20 ms");
    expect(result.modelSummary.join(" ")).toContain(
      "le CPU est le facteur limitant",
    );
    expect(
      result.assumptions.find((a) => a.key === "baselineP95Ms")?.value,
    ).toBe("40 ms");

    const [s] = result.scenarios;
    expect(s.capacity.limitedBy).toBe("cpu");
    expect(s.capacity.estimateRps as number).toBeGreaterThan(115);
    expect(s.capacity.estimateRps as number).toBeLessThan(140);
    expect(s.confidence).toBe("medium");
  });

  it("évalue la configuration de référence d'après la mesure, pas le modèle", () => {
    const result = measured({
      runs: [cpuBound],
      configs: [gb(1, 2, 4, "même infra")],
    });
    const [s] = result.scenarios;
    expect(s.isReference).toBe(true);
    expect(s.capacity.limitedBy).toBe("observed");
    expect(s.capacity.lowRps).toBeGreaterThan(60);
    expect(s.capacity.lowRps).toBeLessThan(75);
    expect(s.confidence).toBe("high");
    expect(s.verdict).toBe("insufficient"); // 78 req/s requis > capacité observée
    expect(result.baseline?.name).toBe("Test de référence (mesuré)");
  });

  it("conclut à un goulot hors CPU et n'attend aucun gain des vCPU", () => {
    // le CPU reste très bas alors que la latence s'envole : limite à ~68 req/s, bien sous ce que permet le CPU (375 req/s)
    const lowCpu = makeRun({
      seconds: 80,
      rps: (t) => 5 + t,
      p95: (t) => (t < 55 ? 40 : 40 + (t - 55) * 20),
      cpu: (t) => 0.2 * (5 + t),
      instances: 1,
      vcpu: 2,
      ramGb: 4,
    });
    const result = measured({
      runs: [lowCpu],
      configs: [gb(1, 2, 4, "ref"), gb(1, 8, 16, "8 vCPU")],
    });
    expect(result.modelSummary.join(" ")).toContain(
      "n'est probablement pas le CPU",
    );

    const small = result.scenarios[1];
    expect(small.capacity.limitedBy).toBe("observed-bottleneck");
    expect(small.notes.join(" ")).toContain(
      "Le goulot observé n'est pas le CPU",
    );
    const refCapacity = result.scenarios[0].capacity.estimateRps as number;
    expect(small.capacity.estimateRps as number).toBeCloseTo(refCapacity, 0); // 4 fois plus de vCPU, aucun gain
  });

  it("s'appuie sur la limite observée quand aucune métrique CPU n'est disponible", () => {
    const noInfra = makeRun({
      seconds: 80,
      rps: (t) => 5 + t,
      p95: (t) => (t < 55 ? 40 : 40 + (t - 55) * 20),
      instances: 1,
      vcpu: 2,
    });
    const result = measured({
      runs: [noInfra],
      configs: [gb(2, 2, 4, "2 instances"), gb(1, 8, 4, "8 vCPU")],
    });
    expect(result.modelSummary.join(" ")).toContain("n'a pas pu être calibré");
    expect(
      result.assumptions.find((a) => a.key === "verticalExponent")?.source,
    ).toBe("default");

    const [twoInstances, bigger] = result.scenarios;
    expect(twoInstances.capacity.limitedBy).toBe("observed-bottleneck");
    expect(twoInstances.capacity.estimateRps as number).toBeCloseTo(
      68.5 * (2 / 1.05),
      0,
    );
    expect(bigger.capacity.estimateRps as number).toBeCloseTo(
      68.5 * Math.sqrt(4),
      0,
    ); // exposant par défaut 0,5
    expect(twoInstances.checks.latency.status).toBe("unknown");
    expect(twoInstances.confidence).toBe("low");
  });

  it("calibre la fraction série avec un second test à plus d'instances", () => {
    const oneInstance = makeRun({
      seconds: 120,
      rps: ramp,
      p95: latencyKnee(70),
      instances: 1,
    });
    const twoInstances = makeRun({
      seconds: 120,
      rps: ramp,
      p95: latencyKnee(75),
      instances: 2,
    });
    const result = plan({
      mode: "measured",
      objectives: { targetRps: 300, p95MaxMs: 200 },
      runs: [oneInstance, twoInstances],
      configs: [gb(4, 2, 2, "4 instances")],
    });
    const sf = result.assumptions.find(
      (a) => a.key === "scaleOutSerialFraction",
    );
    expect(sf?.source).toBe("calibrated");
    expect(sf?.note).toContain("1 → 2 instances");
    const value = parseFloat(sf?.value ?? "0");
    expect(value).toBeGreaterThan(80); // 2 instances apportent à peine plus qu'une
    expect(value).toBeLessThanOrEqual(100);
  });

  it("abaisse la confiance quand le générateur était saturé", () => {
  const saturated = makeRun({
    seconds: 80,
    rps: (t: number) => 5 + t,
    p95: (t: number) => (t < 55 ? 40 : 40 + (t - 55) * 20),
    cpu: (t: number) => 5 + (5 + t),
    generatorSaturated: true,
    ramGb: 4,
  });

  const result = measured({
    runs: [saturated],
    configs: [gb(2, 2, 4, "x")],
  });

  expect(result.warnings.join(" ")).toContain("saturé");
  expect(result.scenarios[0].confidence).toBe("low");
});

  it("signale quand le test de référence n'a pas atteint sa limite", () => {
    const easy = makeRun({
      seconds: 80,
      rps: (t) => 5 + t,
      p95: () => 40,
      cpu: (t) => 5 + (5 + t),
      vcpu: 2,
    });
    const result = measured({ runs: [easy], configs: [gb(2, 2, 4, "x")] });
    // le modèle CPU reste utilisable, mais il n'est pas confronté à une limite mesurée
    expect(result.modelSummary.join(" ")).toContain(
      "n'a pas fourni de limite exacte",
    );
    expect(result.scenarios[0].capacity.limitedBy).toBe("cpu");
  });
});

describe("entrées invalides", () => {
  it("exige un débit cible", () => {
    expect(() =>
      plan({
        mode: "predictive",
        service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
        configs: [gb(1, 2, 4, "A")],
      }),
    ).toThrow(AdvisorInputError);
    expect(() =>
      plan({
        mode: "predictive",
        service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
        objectives: { targetVus: 100 }, // sans durée d'itération
        configs: [gb(1, 2, 4, "A")],
      }),
    ).toThrow(/durée d'une itération/);
  });

  it("refuse un test de référence inexistant", () => {
    const run = makeRun({ seconds: 20, rps: () => 10, p95: () => 40 });
    expect(() =>
      plan({
        mode: "measured",
        objectives: { targetRps: 10 },
        runs: [run],
        referenceIndex: 3,
        configs: [gb(1, 2, 4, "A")],
      }),
    ).toThrow(/n°3/);
  });

  it("valide la forme de l'entrée", () => {
    expect(CapacityInputSchema.safeParse({ mode: "inconnu" }).success).toBe(
      false,
    );
    expect(
      CapacityInputSchema.safeParse({
        mode: "predictive",
        configs: [gb(1, 2, 4, "A")],
      }).success,
    ).toBe(false); // service manquant
    expect(
      CapacityInputSchema.safeParse({
        mode: "predictive",
        service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
        configs: [],
      }).success,
    ).toBe(false);
  });
});

describe("plan de vérification", () => {
  const base = {
    mode: "predictive",
    service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
    objectives: { targetRps: 400, p95MaxMs: 300, headroomPercent: 30 },
    configs: [gb(2, 4, 8, "C")],
  };

  it("monte jusqu'au débit cible puis au débit requis", () => {
    const { verification } = plan(base);
    const e = verification.executor;
    expect(e.type).toBe("ramping-arrival-rate");
    if (e.type !== "ramping-arrival-rate") return;
    expect(e.timeUnitSeconds).toBe(1);
    expect(e.startRate).toBe(100); // 25 % de l'objectif
    expect(e.stages.map((s) => s.target)).toEqual([400, 520, 520]);
    expect(e.stages.reduce((sum, s) => sum + s.durationSeconds, 0)).toBe(120);
    expect(e.maxVus).toBeGreaterThanOrEqual(e.preAllocatedVus);
    expect(verification.expectedPeakRps).toBe(520);
  });

  it("reprend les objectifs sous forme de thresholds valides pour le moteur de charge", async () => {
    const { verification } = plan(base);
    expect(
      verification.thresholds.map((t) => `${t.metric} ${t.expression}`),
    ).toEqual([
      "http_req_duration p(95)<300",
      "http_req_failed rate<0.01",
      "dropped_iterations count==0",
    ]);
    const { parseThresholds } =
      await import("@/server/engine/thresholds/thresholds");
    expect(() => parseThresholds(verification.thresholds)).not.toThrow();
  });

  it("convertit les requêtes en itérations et passe à la minute pour les faibles débits", () => {
    const { verification } = plan({
      ...base,
      objectives: { targetRps: 3, requestsPerIteration: 3, p95MaxMs: 300 },
    });
    const e = verification.executor;
    if (e.type !== "ramping-arrival-rate")
      throw new Error("executor inattendu");
    // 3 req/s = 1 itération/s = 60 par minute ; requis 3,9 req/s → 78 par minute
    expect(e.timeUnitSeconds).toBe(60);
    expect(e.stages[0].target).toBe(60);
    expect(e.stages[1].target).toBe(78);
  });

  it("s'assemble avec un workflow en scénario de charge valide", () => {
    const { verification } = plan(base);
    const workflow = WorkflowSchema.parse({
      name: "parcours",
      steps: [
        {
          id: "s1",
          name: "accueil",
          request: { method: "GET", url: "https://exemple.test/" },
        },
      ],
    });
    const scenario = buildVerificationScenario(
      verification,
      workflow,
      "Vérification C",
    );
    expect(scenario.name).toBe("Vérification C");
    expect(scenario.executor.type).toBe("ramping-arrival-rate");
    expect(scenario.thresholds).toHaveLength(3);
  });

  it("ne définit pas de threshold de latence sans objectif de p95", () => {
    const { verification } = plan({ ...base, objectives: { targetRps: 400 } });
    expect(verification.thresholds.map((t) => t.metric)).toEqual([
      "http_req_failed",
      "dropped_iterations",
    ]);
  });
});
