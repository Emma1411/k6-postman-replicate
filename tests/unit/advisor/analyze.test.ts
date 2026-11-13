
import { describe, it, expect } from "vitest";
import { analyzeRun } from "@/shared/advisor/analyze";
import type { AnalyzeResult, FindingCode } from "@/shared/types/advisor-result";
import { latencyKnee, makeRun, ramp } from "../../helpers/advisor-fixtures";
import {
  normalizeAnalyzeInput,
  PolicySchema,
  ObjectivesSchema,
  type AnalyzeInput,
} from "@/shared/schemas";

type Input = Omit<AnalyzeInput, "run"> & {
  run: AnalyzeInput["run"];
};

const analyze = (input: Input): AnalyzeResult =>
  analyzeRun(normalizeAnalyzeInput(input));

const codes = (r: AnalyzeResult): FindingCode[] =>
  r.findings.map((f) => f.code);

const get = (r: AnalyzeResult, code: FindingCode) =>
  r.findings.find((f) => f.code === code);

// Configuration par défaut avec une durée personnalisée
const policy = PolicySchema.parse({
  sustainSeconds: 20,
});

// Objectifs de performance
const objectives = ObjectivesSchema.parse({
  requestsPerIteration: 1,
  maxErrorRate: 0.01,
  p95MaxMs: 200,
  targetRps: 400,
  headroomPercent: 25,
});

describe("CPU saturé avec latence en hausse", () => {
  const run = makeRun({
    seconds: 120,
    rps: ramp,
    p95: latencyKnee(70),
    cpu: (t) => Math.min(100, ramp(t) / 4.5),
  });

  const result = analyze({ run, objectives, policy });

  it("diagnostique une limite CPU avec une confiance élevée", () => {
    const f = get(result, "cpu-limit");

    expect(f?.severity).toBe("critical");
    expect(f?.confidence).toBe("high");
    expect(f?.indicators).toEqual(
      expect.arrayContaining(["CPU", "latence p95"])
    );
    expect(f?.dataSource).toBe("observed");
    expect(f?.evidence.some((e) => e.label === "Latence p95")).toBe(true);
    expect(codes(result)).not.toContain("cpu-high-observation");
    expect(codes(result)).not.toContain("io-or-dependency-wait");
  });

  it("signale le dépassement de l'objectif de latence", () => {
    expect(get(result, "slo-p95-breach")?.severity).toBe("critical");
  });

  it("situe la capacité entre le dernier niveau tenu et le premier dépassement", () => {
    expect(result.capacity.kind).toBe("bracketed");
    expect(result.capacity.shape).toBe("variable");
    expect(result.capacity.sustainedRps).toBeGreaterThan(300);
    expect(result.capacity.sustainedRps).toBeLessThan(335);
    expect(result.capacity.breachRps).toBeGreaterThan(
      result.capacity.sustainedRps as number
    );
    expect(result.capacity.breachRps).toBeLessThan(345);
  });

  it("recommande Scale Out et Scale Up avec le facteur de capacité", () => {
    const kinds = result.recommendations.map((r) => r.kind);

    expect(kinds).toEqual(
      expect.arrayContaining(["scale-out", "scale-up", "verify"])
    );

    const out = result.recommendations.find((r) => r.kind === "scale-out");

    expect(out?.priority).toBe(1);
    expect(out?.detail).toContain("×");
    expect(result.recommendations[0].priority).toBe(1);
    expect(result.advisoryOnly).toBe(true);
  });

  it("résume le test", () => {
    expect(result.summary.peakRps).toBeGreaterThan(450);
    expect(result.summary.baselineP95Ms).toBe(40);
    expect(result.summary.peakP95Ms).toBeGreaterThan(900);
    expect(result.dataQuality.infraMetrics).toBe("observed");
    expect(result.dataQuality.reliable).toBe(true);
  });
});

describe("CPU faible mais latence élevée", () => {
  const run = makeRun({
    seconds: 120,
    rps: ramp,
    p95: latencyKnee(70),
    cpu: (t) => 20 + t * 0.1,
  });

  const result = analyze({ run, objectives, policy });

  it("conclut à une attente d'E/S ou de dépendance, pas à une limite CPU", () => {
    expect(get(result, "io-or-dependency-wait")?.confidence).toBe("medium");
    expect(codes(result)).not.toContain("cpu-limit");
    expect(codes(result)).not.toContain("cpu-high-observation");
  });

  it("déconseille d'ajouter des vCPU", () => {
    const rec = result.recommendations.find(
      (r) => r.kind === "investigate"
    );

    expect(rec?.detail).toContain("n'ajoute pas de vCPU");
    expect(result.recommendations.some((r) => r.kind === "scale-up")).toBe(false);
  });
});

describe("pool de connexions saturé", () => {
  const run = makeRun({
    seconds: 120,
    rps: ramp,
    p95: latencyKnee(70),
    cpu: () => 30,
    db: (t) => Math.min(50, ramp(t) / 4),
    pool: 50,
  });

  const result = analyze({ run, objectives, policy });

  it("diagnostique une limite de connexions avec une confiance élevée", () => {
    const f = get(result, "db-pool-limit");

    expect(f?.severity).toBe("critical");
    expect(f?.confidence).toBe("high");
    expect(f?.indicators).toEqual(
      expect.arrayContaining([
        "connexions DB",
        "latence p95",
        "CPU non saturé",
      ])
    );
  });

  it("n'attribue pas la latence à une attente d'E/S quand le pool explique déjà le problème", () => {
    expect(codes(result)).not.toContain("io-or-dependency-wait");
    expect(codes(result)).not.toContain("cpu-limit");

    expect(
      result.recommendations.some(
        (r) => r.kind === "tune" && r.title.includes("pools")
      )
    ).toBe(true);
  });

  it("calcule la capacité du pool d'après la taille par instance et le nombre d'instances", () => {
    const two = makeRun({
      seconds: 120,
      rps: ramp,
      p95: latencyKnee(70),
      cpu: () => 30,
      db: (t) => Math.min(50, ramp(t) / 4),
      pool: 50,
      instances: 2,
    });

    expect(
      codes(analyze({ run: two, objectives, policy }))
    ).not.toContain("db-pool-limit");
  });
});

describe("pression mémoire", () => {
  const mem = (t: number) => 50 + t * 0.4;

  const run = makeRun({
    seconds: 120,
    rps: () => 100,
    p95: () => 50,
    mem,
    memAvailMb: (t) => ((100 - mem(t)) / 100) * 2048,
    ramGb: 2,
  });

  const result = analyze({ run });

  it("exige un second indicateur et l'obtient ici (mémoire disponible faible)", () => {
    const f = get(result, "memory-pressure");

    expect(f?.severity).toBe("critical");
    expect(f?.indicators).toEqual(
      expect.arrayContaining([
        "mémoire utilisée",
        "mémoire disponible",
      ])
    );
    expect(f?.evidence.some((e) => e.label === "Tendance")).toBe(true);
  });

  it("ne conclut pas sur la seule utilisation mémoire", () => {
    const alone = makeRun({
      seconds: 120,
      rps: () => 100,
      p95: () => 50,
      mem: (t) => 50 + t * 0.4,
    });

    const r = analyze({ run: alone });

    expect(codes(r)).toContain("memory-high-observation");
    expect(codes(r)).not.toContain("memory-pressure");
  });
});

describe("un seul indicateur ne suffit pas", () => {
  it("CPU élevé et latence stable : observation, pas de diagnostic", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 200,
      p95: () => 50,
      cpu: () => 82,
    });

    const result = analyze({ run, policy });

    expect(codes(result)).toContain("cpu-high-observation");
    expect(codes(result)).not.toContain("cpu-limit");
    expect(get(result, "cpu-high-observation")?.severity).toBe("info");
    expect(get(result, "cpu-high-observation")?.indicators).toEqual(["CPU"]);
  });

  it("un CPU qui dépasse brièvement le seuil ne déclenche rien", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 200,
      p95: () => 50,
      cpu: (t) => (t > 20 && t < 30 ? 95 : 40),
    });

    const result = analyze({ run });

    expect(codes(result).filter((c) => c.startsWith("cpu"))).toEqual([]);
  });
});

describe("réseau", () => {
  it("signale un RTT élevé et sa part dans la latence", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 100,
      p95: () => 300,
      rtt: () => 160,
    });

    const f = get(analyze({ run }), "network-latency");

    expect(f?.severity).toBe("warning");
    expect(f?.confidence).toBe("medium"); // 160 / 300 ≥ 50 %
  });

  it("n'agit pas sous le seuil", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 100,
      p95: () => 300,
      rtt: () => 40,
    });

    expect(codes(analyze({ run }))).not.toContain("network-latency");
  });
});

describe("erreurs et cadence", () => {
  it("signale un taux d'erreur au-dessus de l'objectif avec le contexte du premier dépassement", () => {
    const run = makeRun({
      seconds: 120,
      rps: () => 200,
      p95: () => 50,
      errorRate: (t) => (t > 60 ? 0.05 : 0),
      cpu: (t) => (t > 60 ? 88 : 50),
    });

    const f = get(analyze({ run }), "error-rate-anomaly");

    expect(f?.severity).toBe("warning");
    expect(
      f?.evidence.find(
        (e) => e.label === "Première période en dépassement"
      )?.value
    ).toContain("61 s");

    expect(
      f?.evidence.find((e) => e.label === "Au même moment")?.value
    ).toContain("CPU 88");
  });

  it("passe en critique au-delà de 5 fois l'objectif", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 200,
      p95: () => 50,
      errorRate: () => 0.3,
    });

    expect(
      get(analyze({ run }), "error-rate-anomaly")?.severity
    ).toBe("critical");
  });

  it("signale les itérations abandonnées", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 200,
      p95: () => 50,
      dropped: () => 5,
    });

    const f = get(analyze({ run }), "dropped-iterations");

    expect(f?.evidence[0].value).toBe("300");
  });
});

describe("qualité des données", () => {
  it("signale l'absence de métriques d'infrastructure et la forme constante du test", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 100,
      p95: () => 50,
    });

    const result = analyze({
      run,
      objectives: ObjectivesSchema.parse({ p95MaxMs: 200 }),
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "no-infra-metrics",
        "insufficient-load-range",
      ])
    );

    expect(get(result, "no-infra-metrics")?.dataSource).toBe("none");
    expect(result.capacity.kind).toBe("lower-bound");
    expect(result.capacity.shape).toBe("constant");
    expect(result.dataQuality.infraMetrics).toBe("none");

    expect(result.dataQuality.missingMetrics).toEqual(
      expect.arrayContaining(["CPU", "mémoire"])
    );

    expect(
      result.recommendations.some((r) => r.title.includes("Collecter"))
    ).toBe(true);
  });

  it("avertit quand aucun objectif de p95 n'est défini", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 100,
      p95: () => 50,
    });

    expect(
      analyze({ run }).dataQuality.warnings.join(" ")
    ).toContain("Aucun objectif de p95");
  });

  it("avertit que les moyennes peuvent masquer une instance saturée", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 100,
      p95: () => 50,
      cpu: () => 40,
      instances: 3,
    });

    expect(
      analyze({ run }).dataQuality.warnings.join(" ")
    ).toContain("moyennes sur les instances");
  });

  it("une charge constante qui dépasse l'objectif donne une borne haute", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 300,
      p95: () => 800,
    });

    const result = analyze({
      run,
      objectives: ObjectivesSchema.parse({ p95MaxMs: 200 }),
    });

    expect(result.capacity.kind).toBe("upper-bound");
    expect(result.capacity.sustainedRps).toBeNull();
    expect(result.capacity.breachRps).toBe(300);
  });

  it("un dépassement dès le début d'une rampe donne aussi une borne haute", () => {
    const run = makeRun({
      seconds: 60,
      rps: (t) => 50 + 5 * t,
      p95: () => 900,
    });

    expect(
      analyze({
        run,
        objectives: ObjectivesSchema.parse({ p95MaxMs: 200 }),
      }).capacity.kind
    ).toBe("upper-bound");
  });
});

describe("générateur saturé", () => {
  const run = makeRun({
    seconds: 120,
    rps: ramp,
    p95: latencyKnee(70),
    cpu: (t) => Math.min(100, ramp(t) / 4.5),
    generatorSaturated: true,
  });

  const result = analyze({ run, objectives, policy });

  it("ajoute un constat critique et rend les mesures non fiables", () => {
    expect(get(result, "generator-saturated")?.severity).toBe("critical");
    expect(result.dataQuality.reliable).toBe(false);

    expect(
      result.recommendations.some(
        (r) => r.kind === "verify" && r.priority === 1
      )
    ).toBe(true);
  });

  it("baisse d'un niveau la confiance des autres constats", () => {
    expect(get(result, "cpu-limit")?.confidence).toBe("medium");
    expect(get(result, "generator-saturated")?.confidence).toBe("high");
  });
});

describe("mise à l'échelle", () => {
  const oneInstance = makeRun({
    seconds: 120,
    rps: ramp,
    p95: latencyKnee(70),
    instances: 1,
  });

  it("signale une mise à l'échelle sous-linéaire quand 2 instances apportent peu", () => {
    const two = makeRun({
      seconds: 120,
      rps: ramp,
      p95: latencyKnee(75),
      instances: 2,
    });

    const result = analyze({
      run: two,
      objectives,
      policy,
      otherRuns: [oneInstance],
    });

    const f = get(result, "shared-dependency-scaling");

    expect(f?.severity).toBe("warning");
    expect(f?.title).toContain("sous-linéaire");
    expect(f?.evidence.some((e) => e.value.includes("efficacité"))).toBe(true);

    expect(
      result.recommendations.some(
        (r) => r.title.includes("dépendances partagées")
      )
    ).toBe(true);
  });

  it("signale une dégradation quand la capacité baisse avec plus d'instances", () => {
    const worse = makeRun({
      seconds: 120,
      rps: ramp,
      p95: latencyKnee(55),
      instances: 2,
    });

    const f = get(
      analyze({
        run: worse,
        objectives,
        policy,
        otherRuns: [oneInstance],
      }),
      "shared-dependency-scaling"
    );

    expect(f?.severity).toBe("critical");
    expect(f?.title).toContain("Dégradation");
  });

  it("ne dit rien quand la mise à l'échelle est correcte", () => {
    // 2 instances : la latence ne s'envole qu'au double du débit, hors de la rampe
    const good = makeRun({
      seconds: 120,
      rps: (t) => 10 + 8 * t,
      p95: latencyKnee(80),
      instances: 2,
    });

    const result = analyze({
      run: good,
      objectives,
      policy,
      otherRuns: [oneInstance],
    });

    expect(codes(result)).not.toContain("shared-dependency-scaling");
  });

  it("reste prudente quand l'un des tests n'a pas atteint sa limite", () => {
    const noLimit = makeRun({
      seconds: 120,
      rps: ramp,
      p95: () => 40,
      instances: 2,
    });

    const result = analyze({
      run: noLimit,
      objectives,
      policy,
      otherRuns: [oneInstance],
    });

    expect(codes(result)).toContain("scaling-comparison-inconclusive");
    expect(codes(result)).not.toContain("shared-dependency-scaling");
  });

  it("ignore les tests dont la taille d'instance diffère", () => {
    const other = makeRun({
      seconds: 120,
      rps: ramp,
      p95: latencyKnee(70),
      instances: 1,
      vcpu: 8,
    });

    const two = makeRun({
      seconds: 120,
      rps: ramp,
      p95: latencyKnee(75),
      instances: 2,
    });

    const result = analyze({
      run: two,
      objectives,
      policy,
      otherRuns: [other],
    });

    expect(codes(result)).not.toContain("shared-dependency-scaling");
    expect(codes(result)).not.toContain("scaling-comparison-inconclusive");
  });
});

describe("politique configurable", () => {
  it("applique les seuils fournis", () => {
    const run = makeRun({
      seconds: 60,
      rps: () => 200,
      p95: () => 50,
      cpu: () => 62,
    });

    expect(codes(analyze({ run }))).not.toContain("cpu-high-observation");

    const strict = analyze({
      run,
      policy: {
        ...policy,
        cpuWarnPercent: 60,
        cpuSaturationPercent: 80,
      },
    });

    expect(codes(strict)).toContain("cpu-high-observation");
  });

  it("refuse une saturation inférieure à l'avertissement", () => {
    expect(
      PolicySchema.safeParse({
        cpuWarnPercent: 90,
        cpuSaturationPercent: 70,
      }).success
    ).toBe(false);
  });
});
