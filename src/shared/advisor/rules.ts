import type { MeasuredRun, Objectives, Policy } from "@/shared/schemas";
import type {
  CapacityEvidence,
  Confidence,
  DataSource,
  Evidence,
  Finding,
  FindingCode,
  RunSummary,
  Severity,
} from "@/shared/types/advisor-result";
import type { Shape } from "./capacity-evidence";
import { longestRun, type AlignedPoint } from "./series";
import { max, mean, median, pearson, round1, slope, sum } from "./stats";

export interface RuleContext {
  run: MeasuredRun;
  aligned: AlignedPoint[];
  policy: Policy;
  objectives: Objectives;
  summary: RunSummary;
  capacity: CapacityEvidence;
  shape: Shape;
  /** Pas médian entre deux points, en secondes. */
  step: number;
  baselineP95: number | null;
  provenance: "observed" | "user-provided" | null;
  others: Array<{ run: MeasuredRun; capacity: CapacityEvidence }>;
}

const nonNull = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;
const pct = (n: number) => `${round1(n)} %`;
const ms = (n: number) => `${round1(n)} ms`;
const secs = (n: number) => `${Math.round(n)} s`;

function finding(
  code: FindingCode,
  severity: Severity,
  confidence: Confidence,
  title: string,
  summary: string,
  indicators: string[],
  evidence: Evidence[],
  dataSource: DataSource,
): Finding {
  return { code, severity, confidence, title, summary, indicators, evidence, dataSource };
}

interface LatencyRise {
  baseline: number | null;
  loaded: number | null;
  ratio: number | null;
  rising: boolean;
}

/** Compare la latence sur une zone au niveau de base : hausse = facteur ET écart absolu minimum dépassés. */
function latencyRise(c: RuleContext, region: AlignedPoint[]): LatencyRise {
  const loaded = median(region.map((p) => p.p95).filter(nonNull));
  const baseline = c.baselineP95;
  if (loaded === null || baseline === null || baseline <= 0) return { baseline, loaded, ratio: null, rising: false };
  const ratio = loaded / baseline;
  const rising = ratio >= c.policy.latencyRiseFactor && loaded - baseline >= c.policy.latencyRiseMinMs;
  return { baseline, loaded, ratio, rising };
}

const latencyEvidence = (r: LatencyRise): Evidence[] =>
  r.loaded !== null && r.baseline !== null && r.ratio !== null
    ? [{ label: "Latence p95", value: `${ms(r.loaded)} contre ${ms(r.baseline)} à faible charge (×${round1(r.ratio)})` }]
    : [];

function regionErrorRate(region: AlignedPoint[]): number | null {
  const requests = sum(region.map((p) => p.requests));
  return requests > 0 ? sum(region.map((p) => p.failed)) / requests : null;
}

const regionSlice = (c: RuleContext, run: { start: number; end: number }) => c.aligned.slice(run.start, run.end + 1);

function sustained(c: RuleContext, predicate: (p: AlignedPoint) => boolean) {
  const run = longestRun(c.aligned, predicate, c.step);
  return run !== null && run.seconds >= c.policy.sustainSeconds ? run : null;
}

// --- CPU ------------------------------------------------------------------------------------------

function cpuRule(c: RuleContext): Finding[] {
  if (!c.aligned.some((p) => p.cpu !== null)) return [];
  const { policy } = c;
  const warn = sustained(c, (p) => p.cpu !== null && p.cpu > policy.cpuWarnPercent);
  if (!warn) return [];
  const saturation = sustained(c, (p) => p.cpu !== null && p.cpu > policy.cpuSaturationPercent);

  const region = regionSlice(c, warn);
  const cpuValues = region.map((p) => p.cpu).filter(nonNull);
  const rise = latencyRise(c, region);
  const pairs = c.aligned.filter((p) => p.cpu !== null && p.p95 !== null);
  const correlation = pearson(
    pairs.map((p) => p.cpu as number),
    pairs.map((p) => p.p95 as number),
  );

  const evidence: Evidence[] = [
    { label: "CPU", value: `au-dessus de ${pct(policy.cpuWarnPercent)} pendant ${secs(warn.seconds)} (moyenne ${pct(mean(cpuValues) ?? 0)}, max ${pct(max(cpuValues))})` },
    ...(saturation ? [{ label: "Saturation", value: `au-dessus de ${pct(policy.cpuSaturationPercent)} pendant ${secs(saturation.seconds)}` }] : []),
    ...latencyEvidence(rise),
    ...(correlation !== null ? [{ label: "Corrélation CPU / latence", value: `${round1(correlation * 100) / 100}` }] : []),
  ];

  if (rise.rising) {
    const confidence: Confidence = saturation && correlation !== null && correlation >= 0.5 ? "high" : "medium";
    return [
      finding(
        "cpu-limit",
        saturation ? "critical" : "warning",
        confidence,
        "Limite CPU probable",
        "Le CPU reste élevé pendant que la latence augmente : le processeur est vraisemblablement le facteur limitant.",
        ["CPU", "latence p95", ...(correlation !== null && correlation >= 0.5 ? ["corrélation CPU / latence"] : [])],
        evidence,
        c.provenance ?? "user-provided",
      ),
    ];
  }

  return [
    finding(
      "cpu-high-observation",
      saturation ? "warning" : "info",
      "medium",
      "CPU élevé, sans dégradation visible",
      "Le CPU dépasse le seuil d'avertissement mais la latence reste stable : aucune limite n'est démontrée, mais la marge restante est réduite. Ce constat repose sur un seul indicateur, ce n'est pas un diagnostic.",
      ["CPU"],
      evidence,
      c.provenance ?? "user-provided",
    ),
  ];
}

// --- Mémoire --------------------------------------------------------------------------------------

function memoryRule(c: RuleContext): Finding[] {
  if (!c.aligned.some((p) => p.mem !== null)) return [];
  const { policy } = c;
  const run = sustained(c, (p) => p.mem !== null && p.mem > policy.ramWarnPercent);
  if (!run) return [];

  const region = regionSlice(c, run);
  const memValues = region.map((p) => p.mem).filter(nonNull);
  const memMax = max(memValues);
  const totalMb = c.run.infra.ramGbPerInstance * 1024;
  const avail = region.map((p) => p.memAvailMb).filter(nonNull);
  const minAvail = avail.length > 0 ? Math.min(...avail) : null;
  const lowAvailable = minAvail !== null && minAvail < policy.lowAvailableMemoryFraction * totalMb;
  const rise = latencyRise(c, region);
  const errors = regionErrorRate(region);
  const errorsHigh = errors !== null && errors > c.objectives.maxErrorRate;

  const growth = slope(
    c.aligned.filter((p) => p.mem !== null).map((p) => p.t),
    c.aligned.filter((p) => p.mem !== null).map((p) => p.mem as number),
  );

  const evidence: Evidence[] = [
    { label: "Mémoire utilisée", value: `au-dessus de ${pct(policy.ramWarnPercent)} pendant ${secs(run.seconds)} (max ${pct(memMax)})` },
    ...(minAvail !== null ? [{ label: "Mémoire disponible minimale", value: `${Math.round(minAvail)} Mo sur ${Math.round(totalMb)} Mo` }] : []),
    ...(growth !== null && growth > 0.01 ? [{ label: "Tendance", value: `+${round1(growth * 60)} points de mémoire par minute` }] : []),
    ...latencyEvidence(rise),
    ...(errors !== null ? [{ label: "Taux d'erreur sur la période", value: pct(errors * 100) }] : []),
  ];

  const corroborated = lowAvailable || rise.rising || errorsHigh;
  if (!corroborated) {
    return [
      finding(
        "memory-high-observation",
        "info",
        "medium",
        "Mémoire élevée, sans effet visible",
        "L'utilisation mémoire dépasse le seuil mais rien d'autre n'indique de pression : à surveiller (une tendance à la hausse peut signaler une fuite).",
        ["mémoire utilisée"],
        evidence,
        c.provenance ?? "user-provided",
      ),
    ];
  }

  return [
    finding(
      "memory-pressure",
      memMax >= 95 || (lowAvailable && (rise.rising || errorsHigh)) ? "critical" : "warning",
      lowAvailable && (rise.rising || errorsHigh) ? "high" : "medium",
      "Pression mémoire",
      "La mémoire utilisée est élevée et au moins un second indicateur le confirme (mémoire disponible faible, latence en hausse ou erreurs).",
      ["mémoire utilisée", ...(lowAvailable ? ["mémoire disponible"] : []), ...(rise.rising ? ["latence p95"] : []), ...(errorsHigh ? ["taux d'erreur"] : [])],
      evidence,
      c.provenance ?? "user-provided",
    ),
  ];
}

// --- Base de données ------------------------------------------------------------------------------

function poolCapacity(c: RuleContext): number | null {
  const { infra } = c.run;
  if (infra.poolSizePerInstance !== undefined) return infra.poolSizePerInstance * infra.instances;
  return infra.dbMaxConnections ?? null;
}

function dbUsage(p: AlignedPoint, capacity: number): number | null {
  return p.dbUsed === null ? null : (p.dbUsed / capacity) * 100;
}

function dbRule(c: RuleContext): Finding[] {
  const capacity = poolCapacity(c);
  if (capacity === null || !c.aligned.some((p) => p.dbUsed !== null)) return [];
  const { policy } = c;

  const saturated = sustained(c, (p) => (dbUsage(p, capacity) ?? 0) > policy.dbPoolSaturationPercent);
  if (saturated) {
    const region = regionSlice(c, saturated);
    const rise = latencyRise(c, region);
    const errors = regionErrorRate(region);
    const errorsHigh = errors !== null && errors > c.objectives.maxErrorRate;
    const cpuValues = region.map((p) => p.cpu).filter(nonNull);
    const cpuMedian = median(cpuValues);
    const cpuNotSaturated = cpuMedian !== null && cpuMedian < policy.cpuWarnPercent;

    const evidence: Evidence[] = [
      { label: "Connexions DB", value: `au-dessus de ${pct(policy.dbPoolSaturationPercent)} de ${capacity} connexions pendant ${secs(saturated.seconds)}` },
      ...(cpuMedian !== null ? [{ label: "CPU médian sur la période", value: pct(cpuMedian) }] : []),
      ...latencyEvidence(rise),
      ...(errors !== null ? [{ label: "Taux d'erreur sur la période", value: pct(errors * 100) }] : []),
    ];

    if (rise.rising || errorsHigh) {
      return [
        finding(
          "db-pool-limit",
          "critical",
          cpuNotSaturated ? "high" : "medium",
          "Limite de connexions (pool ou base de données)",
          "Le pool de connexions est saturé et la latence ou les erreurs augmentent en même temps : les requêtes attendent vraisemblablement une connexion disponible.",
          ["connexions DB", ...(rise.rising ? ["latence p95"] : []), ...(errorsHigh ? ["taux d'erreur"] : []), ...(cpuNotSaturated ? ["CPU non saturé"] : [])],
          evidence,
          c.provenance ?? "user-provided",
        ),
      ];
    }
    return [
      finding(
        "db-pool-limit",
        "warning",
        "low",
        "Pool de connexions saturé, sans effet visible",
        "Le pool atteint sa limite mais ni la latence ni les erreurs ne se dégradent : surveille-le, il deviendra un goulot si la charge augmente.",
        ["connexions DB"],
        evidence,
        c.provenance ?? "user-provided",
      ),
    ];
  }

  const high = sustained(c, (p) => (dbUsage(p, capacity) ?? 0) > policy.dbPoolWarnPercent);
  if (high) {
    return [
      finding(
        "db-pool-high-observation",
        "info",
        "low",
        "Pool de connexions bien rempli",
        `Le pool dépasse ${pct(policy.dbPoolWarnPercent)} d'utilisation pendant ${secs(high.seconds)} sans atteindre la saturation.`,
        ["connexions DB"],
        [{ label: "Connexions DB", value: `capacité ${capacity} connexions` }],
        c.provenance ?? "user-provided",
      ),
    ];
  }
  return [];
}

// --- Réseau ---------------------------------------------------------------------------------------

function networkRule(c: RuleContext): Finding[] {
  const rtts = c.aligned.map((p) => p.rtt).filter(nonNull);
  if (rtts.length === 0) return [];
  const rttMedian = median(rtts) as number;
  if (rttMedian <= c.policy.rttWarnMs) return [];

  const p95Median = median(c.aligned.map((p) => p.p95).filter(nonNull));
  const share = p95Median !== null && p95Median > 0 ? rttMedian / p95Median : null;

  return [
    finding(
      "network-latency",
      "warning",
      share !== null && share >= 0.5 ? "medium" : "low",
      "Latence réseau élevée",
      "Le temps d'aller-retour réseau est élevé. Il est mesuré depuis le point où tourne le générateur ou la sonde : il peut refléter la distance jusqu'au service plutôt qu'un problème du service.",
      ["latence réseau (RTT)", ...(share !== null ? ["part du RTT dans le p95"] : [])],
      [
        { label: "RTT médian", value: ms(rttMedian) },
        ...(share !== null ? [{ label: "Part du RTT dans le p95", value: pct(share * 100) }] : []),
      ],
      c.provenance ?? "user-provided",
    ),
  ];
}

// --- CPU faible mais latence élevée ---------------------------------------------------------------

function ioWaitRule(c: RuleContext): Finding[] {
  if (!c.aligned.some((p) => p.cpu !== null)) return [];
  const { policy, objectives } = c;
  const slo = objectives.p95MaxMs;

  const isHigh = (p: AlignedPoint): boolean => {
    if (p.p95 === null) return false;
    if (slo !== undefined) return p.p95 > slo;
    return c.baselineP95 !== null && p.p95 >= c.baselineP95 * policy.latencyRiseFactor && p.p95 - c.baselineP95 >= policy.latencyRiseMinMs;
  };

  const run = sustained(c, isHigh);
  if (!run) return [];
  const region = regionSlice(c, run);
  const cpuMedian = median(region.map((p) => p.cpu).filter(nonNull));
  if (cpuMedian === null || cpuMedian >= policy.lowCpuPercent) return [];

  // Si le pool de connexions est plein, c'est la règle de la base de données qui explique la latence.
  const capacity = poolCapacity(c);
  const usages = capacity === null ? [] : region.map((p) => dbUsage(p, capacity)).filter(nonNull);
  const dbMedian = median(usages);
  if (dbMedian !== null && dbMedian >= policy.dbPoolWarnPercent) return [];

  const rise = latencyRise(c, region);
  return [
    finding(
      "io-or-dependency-wait",
      "warning",
      "medium",
      "Attente d'entrées/sorties ou d'une dépendance probable",
      "La latence est élevée alors que le CPU est faible : le service attend vraisemblablement une base de données, un appel externe, un verrou ou le disque. Ajouter des vCPU n'améliorera probablement rien.",
      ["latence p95 élevée", "CPU faible", ...(dbMedian !== null ? ["pool DB non saturé"] : [])],
      [
        { label: "CPU médian pendant la latence élevée", value: `${pct(cpuMedian)} (seuil « faible » : ${pct(policy.lowCpuPercent)})` },
        { label: "Durée de la latence élevée", value: secs(run.seconds) },
        ...latencyEvidence(rise),
        ...(dbMedian !== null ? [{ label: "Utilisation du pool DB", value: pct(dbMedian) }] : []),
      ],
      c.provenance ?? "user-provided",
    ),
  ];
}

// --- Objectifs ------------------------------------------------------------------------------------

function sloRule(c: RuleContext): Finding[] {
  const slo = c.objectives.p95MaxMs;
  if (slo === undefined) return [];
  const over = c.aligned.filter((p) => p.p95 !== null && p.p95 > slo);
  if (over.length === 0) return [];

  const run = longestRun(c.aligned, (p) => p.p95 !== null && p.p95 > slo, c.step);
  const isSustained = run !== null && run.seconds >= c.policy.sustainSeconds;
  const first = over[0];

  return [
    finding(
      "slo-p95-breach",
      isSustained ? "critical" : "warning",
      "high",
      "Objectif de latence p95 non respecté",
      `Le p95 dépasse ${ms(slo)} ${isSustained ? "de façon durable" : "ponctuellement"}.`,
      ["latence p95"],
      [
        { label: "Premier dépassement", value: `à ${secs(first.t)}, ${round1(first.rps)} req/s, ${Math.round(first.vus)} VUs` },
        { label: "Temps passé au-dessus de l'objectif", value: `${Math.round((over.length / c.aligned.length) * 100)} % du test` },
        ...(c.summary.peakP95Ms !== null ? [{ label: "p95 maximal lissé", value: ms(c.summary.peakP95Ms) }] : []),
      ],
      "load-results",
    ),
  ];
}

function errorRule(c: RuleContext): Finding[] {
  const rate = c.summary.errorRate;
  const limit = c.objectives.maxErrorRate;
  if (rate === null || rate <= limit) return [];

  const first = c.aligned.find((p) => p.errorRate !== null && p.errorRate > limit);
  const context: string[] = [];
  if (first) {
    if (first.cpu !== null) context.push(`CPU ${pct(first.cpu)}`);
    if (first.mem !== null) context.push(`mémoire ${pct(first.mem)}`);
    const capacity = poolCapacity(c);
    if (capacity !== null && first.dbUsed !== null) context.push(`pool DB ${pct((first.dbUsed / capacity) * 100)}`);
  }

  return [
    finding(
      "error-rate-anomaly",
      rate > limit * 5 ? "critical" : "warning",
      "high",
      "Taux d'erreur au-dessus de l'objectif",
      `Le taux d'erreur global (${pct(rate * 100)}) dépasse l'objectif (${pct(limit * 100)}).`,
      ["taux d'erreur"],
      [
        { label: "Taux d'erreur global", value: `${pct(rate * 100)} (${c.summary.totalFailed} sur ${c.summary.totalRequests} requêtes)` },
        ...(first ? [{ label: "Première période en dépassement", value: `à ${secs(first.t)}, ${round1(first.rps)} req/s` }] : []),
        ...(context.length > 0 ? [{ label: "Au même moment", value: context.join(", ") }] : []),
      ],
      "load-results",
    ),
  ];
}

// --- Qualité du test ------------------------------------------------------------------------------

function generatorRule(c: RuleContext): Finding[] {
  if (!c.run.generatorSaturated) return [];
  return [
    finding(
      "generator-saturated",
      "critical",
      "high",
      "Générateur de charge saturé : mesures peu fiables",
      "Le générateur a manqué de ressources pendant le test : les latences mesurées incluent son propre retard. Les constats ci-dessous sont à prendre avec prudence ; relance le test avec plus de workers ou depuis une machine séparée.",
      ["saturation du générateur"],
      [],
      "load-results",
    ),
  ];
}

function droppedRule(c: RuleContext): Finding[] {
  if (c.summary.droppedIterations <= 0) return [];
  return [
    finding(
      "dropped-iterations",
      "warning",
      "medium",
      "Cadence demandée non tenue",
      c.run.generatorSaturated
        ? "Des itérations ont été abandonnées, probablement à cause de la saturation du générateur."
        : "Des itérations ont été abandonnées : soit le service est trop lent pour la cadence demandée (tous les VUs étaient occupés), soit le nombre maximal de VUs est trop bas.",
      ["itérations abandonnées"],
      [{ label: "Itérations abandonnées", value: String(c.summary.droppedIterations) }],
      "load-results",
    ),
  ];
}

function noInfraRule(c: RuleContext): Finding[] {
  const hasAnything = c.aligned.some((p) => p.cpu !== null || p.mem !== null || p.dbUsed !== null || p.rtt !== null);
  if (hasAnything) return [];
  return [
    finding(
      "no-infra-metrics",
      "info",
      "high",
      "Aucune métrique d'infrastructure",
      "Sans CPU, mémoire ou connexions DB, l'analyse se limite à la latence et aux erreurs : elle peut dire que l'objectif n'est pas tenu, mais pas pourquoi. Les recommandations de dimensionnement reposeront sur des hypothèses.",
      [],
      [],
      "none",
    ),
  ];
}

function rangeRule(c: RuleContext): Finding[] {
  if (c.shape !== "constant" || c.capacity.kind !== "lower-bound") return [];
  return [
    finding(
      "insufficient-load-range",
      "info",
      "high",
      "Test à charge constante : limite non atteinte",
      "Le test n'a pas fait varier la charge et les objectifs ont été tenus : on sait que la capacité est au moins égale au niveau testé, pas où elle s'arrête. Lance un test en rampe pour la trouver.",
      ["forme de la charge"],
      [{ label: "Niveau testé", value: `${c.capacity.loadRange.maxRps} req/s` }],
      "load-results",
    ),
  ];
}

// --- Mise à l'échelle -----------------------------------------------------------------------------

function scalingRule(c: RuleContext): Finding[] {
  const { infra } = c.run;
  const comparable = c.others.filter(
    (o) =>
      o.run.infra.instances !== infra.instances &&
      o.run.infra.vcpuPerInstance === infra.vcpuPerInstance &&
      o.run.infra.ramGbPerInstance === infra.ramGbPerInstance,
  );
  if (comparable.length === 0) return [];

  // On compare avec le test dont le nombre d'instances est le plus éloigné.
  const other = [...comparable].sort(
    (a, b) => Math.abs(b.run.infra.instances - infra.instances) - Math.abs(a.run.infra.instances - infra.instances),
  )[0];
  const small = infra.instances < other.run.infra.instances ? { instances: infra.instances, capacity: c.capacity } : { instances: other.run.infra.instances, capacity: other.capacity };
  const large = infra.instances < other.run.infra.instances ? { instances: other.run.infra.instances, capacity: other.capacity } : { instances: infra.instances, capacity: c.capacity };

  if (small.capacity.kind !== "bracketed" || large.capacity.kind !== "bracketed") {
    return [
      finding(
        "scaling-comparison-inconclusive",
        "info",
        "high",
        "Comparaison de mise à l'échelle non concluante",
        "Pour juger la mise à l'échelle, la limite doit avoir été atteinte dans les deux tests. Ici, au moins un des deux n'a pas atteint sa limite (ou l'a dépassée dès le début) : relance-les avec une rampe qui monte assez haut.",
        ["capacité observée de chaque test"],
        [
          { label: `${small.instances} instance(s)`, value: small.capacity.basis },
          { label: `${large.instances} instance(s)`, value: large.capacity.basis },
        ],
        "load-results",
      ),
    ];
  }

  const rSmall = small.capacity.sustainedRps as number;
  const rLarge = large.capacity.sustainedRps as number;
  const speedup = rLarge / rSmall;
  const linear = large.instances / small.instances;
  const efficiency = speedup / linear;
  const evidence: Evidence[] = [
    { label: `${small.instances} instance(s)`, value: `${rSmall} req/s` },
    { label: `${large.instances} instance(s)`, value: `${rLarge} req/s` },
    { label: "Gain obtenu / gain linéaire attendu", value: `×${round1(speedup * 100) / 100} / ×${round1(linear * 100) / 100} (efficacité ${pct(efficiency * 100)})` },
  ];

  if (rLarge < rSmall * 0.95) {
    return [
      finding(
        "shared-dependency-scaling",
        "critical",
        "medium",
        "Dégradation en ajoutant des instances",
        "La capacité observée est plus faible avec plus d'instances : un service partagé (base de données, cache, file, limite d'un tiers) est probablement saturé avant l'application elle-même.",
        ["capacité avec N instances", "capacité avec M instances"],
        evidence,
        "load-results",
      ),
    ];
  }
  if (efficiency < 0.6) {
    return [
      finding(
        "shared-dependency-scaling",
        "warning",
        "medium",
        "Mise à l'échelle sous-linéaire",
        "Ajouter des instances apporte beaucoup moins que proportionnellement : examine les dépendances partagées avant d'en ajouter d'autres.",
        ["capacité avec N instances", "capacité avec M instances"],
        evidence,
        "load-results",
      ),
    ];
  }
  return [];
}

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export function runRules(c: RuleContext): Finding[] {
  const findings = [
    ...generatorRule(c),
    ...sloRule(c),
    ...errorRule(c),
    ...droppedRule(c),
    ...cpuRule(c),
    ...memoryRule(c),
    ...dbRule(c),
    ...ioWaitRule(c),
    ...networkRule(c),
    ...scalingRule(c),
    ...noInfraRule(c),
    ...rangeRule(c),
  ];
  return findings.sort(
    (a, b) =>
      SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] ||
      CONFIDENCE_WEIGHT[b.confidence] - CONFIDENCE_WEIGHT[a.confidence],
  );
}