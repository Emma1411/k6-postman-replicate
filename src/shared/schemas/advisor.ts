import { z } from "zod";

const percent = z.number().min(0).max(100);

/** Seuils de déclenchement, configurables par projet et par infrastructure. Valeurs par défaut : politique initiale du cahier des charges. */
export const PolicySchema = z
  .object({
    cpuWarnPercent: percent.default(75),
    cpuSaturationPercent: percent.default(90),
    ramWarnPercent: percent.default(80),
    dbPoolWarnPercent: percent.default(80),
    dbPoolSaturationPercent: percent.default(95),
    /** En dessous, le CPU est considéré comme « faible ». */
    lowCpuPercent: percent.default(40),
    /** Mémoire disponible considérée comme faible, en fraction de la RAM d'une instance. */
    lowAvailableMemoryFraction: z.number().min(0).max(1).default(0.1),
    rttWarnMs: z.number().positive().default(100),
    /** Durée pendant laquelle un seuil doit être dépassé en continu pour compter comme « durable ». */
    sustainSeconds: z.number().min(1).max(3600).default(30),
    /** La latence est « en hausse » si elle dépasse le niveau de base de ce facteur ET de latencyRiseMinMs. */
    latencyRiseFactor: z.number().min(1).max(100).default(1.5),
    latencyRiseMinMs: z.number().min(0).default(20),
    /** Écart maximal entre un point de charge et l'échantillon d'infrastructure associé. */
    maxAlignGapSeconds: z.number().min(1).max(600).default(15),
  })
  .refine((p) => p.cpuSaturationPercent >= p.cpuWarnPercent, {
    message: "Le seuil de saturation CPU doit être supérieur ou égal au seuil d'avertissement.",
    path: ["cpuSaturationPercent"],
  });
export type Policy = z.output<typeof PolicySchema>;

export const ObjectivesSchema = z.object({
  targetRps: z.number().positive().optional(),
  /** Utilisateurs simultanés visés ; converti en débit avec iterationSeconds et requestsPerIteration. */
  targetVus: z.number().int().positive().optional(),
  /** Durée d'une itération complète d'un utilisateur, pauses comprises. */
  iterationSeconds: z.number().positive().optional(),
  requestsPerIteration: z.number().positive().default(1),
  p95MaxMs: z.number().positive().optional(),
  /** Taux d'erreur acceptable, en fraction (0,01 = 1 %). */
  maxErrorRate: z.number().min(0).max(1).default(0.01),
  /** Marge de capacité à conserver au-dessus de l'objectif. */
  headroomPercent: z.number().min(0).max(300).default(30),
    /** Plafonds d'utilisation visés ; par défaut, les seuils d'avertissement de la politique. */
  cpuMaxPercent: percent.optional(),
  ramMaxPercent: percent.optional(),
});
export type Objectives = z.output<typeof ObjectivesSchema>;

export const InfraSpecSchema = z.object({
  instances: z.number().int().min(1).max(10_000),
  vcpuPerInstance: z.number().positive().max(1024),
  ramGbPerInstance: z.number().positive().max(65_536),
  poolSizePerInstance: z.number().int().positive().optional(),
  dbMaxConnections: z.number().int().positive().optional(),
});
export type InfraSpec = z.output<typeof InfraSpecSchema>;

export const InfraSampleSchema = z.object({
  /** Secondes depuis le début du test. */
  t: z.number().min(0),
  /** Moyenne sur les instances. */
  cpuPercent: percent.optional(),
  memoryPercent: percent.optional(),
  memoryAvailableMb: z.number().min(0).optional(),
  /** Connexions DB utilisées, somme sur toutes les instances. */
  dbConnectionsUsed: z.number().min(0).optional(),
  networkRttMs: z.number().min(0).optional(),
});
export type InfraSample = z.output<typeof InfraSampleSchema>;

export const InfraMetricsSchema = z.object({
  /** observed = collecté par une intégration ; user-provided = saisi ou importé par l'utilisateur. */
  provenance: z.enum(["observed", "user-provided"]),
  samples: z.array(InfraSampleSchema).min(1).max(20_000),
});
export type InfraMetrics = z.output<typeof InfraMetricsSchema>;

/** Un point de la série temporelle du moteur de charge (compatible avec WindowPoint). */
export const LoadPointSchema = z.object({
  t: z.number().min(0),
  vus: z.number().min(0),
  requests: z.number().min(0),
  rps: z.number().min(0),
  failed: z.number().min(0),
  duration: z
    .object({
      avg: z.number().optional(),
      med: z.number().optional(),
      p95: z.number(),
      p99: z.number().optional(),
    })
    .nullable(),
  dropped: z.number().min(0).default(0),
});
export type LoadPoint = z.output<typeof LoadPointSchema>;

export const MeasuredRunSchema = z.object({
  label: z.string().max(100).optional(),
  infra: InfraSpecSchema,
  points: z.array(LoadPointSchema).min(2).max(20_000),
  infraMetrics: InfraMetricsSchema.optional(),
  /** Le résultat du test indiquait un générateur saturé : les mesures sont peu fiables. */
  generatorSaturated: z.boolean().default(false),
});
export type MeasuredRun = z.output<typeof MeasuredRunSchema>;

export const AnalyzeInputSchema = z.object({
  run: MeasuredRunSchema,
  objectives: ObjectivesSchema.optional(),
  policy: PolicySchema.optional(),
  /** Autres tests du même service avec un nombre d'instances différent, pour évaluer la mise à l'échelle. */
  otherRuns: z.array(MeasuredRunSchema).max(5).optional(),
});
export type AnalyzeInput = z.output<typeof AnalyzeInputSchema>;

export interface NormalizedAnalyzeInput {
  run: MeasuredRun;
  objectives: Objectives;
  policy: Policy;
  otherRuns: MeasuredRun[];
}

/** Applique les valeurs par défaut des objectifs et de la politique. */
export function normalizeAnalyzeInput(input: AnalyzeInput): NormalizedAnalyzeInput {
  return {
    run: input.run,
    objectives: ObjectivesSchema.parse(input.objectives ?? {}),
    policy: PolicySchema.parse(input.policy ?? {}),
    otherRuns: input.otherRuns ?? [],
  };
}

// --- Capacity planning ---------------------------------------------------------------------------

export const ArchitectureConfigSchema = z.object({
  name: z.string().min(1).max(100),
  instances: z.number().int().min(1).max(10_000),
  vcpuPerInstance: z.number().positive().max(1024),
  ramGbPerInstance: z.number().positive().max(65_536),
  poolSizePerInstance: z.number().int().positive().optional(),
  dbMaxConnections: z.number().int().positive().optional(),
});
export type ArchitectureConfig = z.output<typeof ArchitectureConfigSchema>;

/** Hypothèses de calcul, toutes modifiables. Ce qui n'est pas fourni prend une valeur par défaut, affichée comme telle. */
export const AssumptionsInputSchema = z.object({
  /** Part du travail qui passe par une ressource partagée (0 = mise à l'échelle parfaite). */
  scaleOutSerialFraction: z.number().min(0).max(1).optional(),
  /** Carré du coefficient de variation du temps de service (1 = exponentiel, 0 = constant). */
  serviceVariability: z.number().min(0).max(25).optional(),
  /** Part des connexions de la base laissée libre (administration, migrations). */
  dbConnectionHeadroom: z.number().min(0).max(0.9).optional(),
  /** Gain d'une augmentation de vCPU quand le goulot n'est pas connu (0 = aucun, 1 = proportionnel). */
  verticalExponent: z.number().min(0).max(1).optional(),
  memoryBaseMb: z.number().min(0).optional(),
  memoryPerInflightMb: z.number().min(0).optional(),
  /** Temps de réponse moyen, pour estimer les requêtes en cours (par défaut : le p95 de base). */
  avgResponseMs: z.number().positive().optional(),
});
export type AssumptionsInput = z.output<typeof AssumptionsInputSchema>;

const SizingTemplateSchema = z.object({
  vcpuPerInstance: z.number().positive().max(1024),
  ramGbPerInstance: z.number().positive().max(65_536),
  poolSizePerInstance: z.number().int().positive().optional(),
  dbMaxConnections: z.number().int().positive().optional(),
});
export type SizingTemplate = z.output<typeof SizingTemplateSchema>;

const capacityCommon = {
  objectives: ObjectivesSchema.optional(),
  policy: PolicySchema.optional(),
  assumptions: AssumptionsInputSchema.optional(),
  configs: z.array(ArchitectureConfigSchema).min(1).max(10),
  /** Configuration actuelle, pour afficher l'écart de chaque scénario (simulation). */
  baseline: ArchitectureConfigSchema.optional(),
  /** Taille d'instance utilisée pour chercher le nombre d'instances nécessaire (par défaut : la première configuration). */
  sizingTemplate: SizingTemplateSchema.optional(),
};

export const PredictiveCapacityInputSchema = z.object({
  mode: z.literal("predictive"),
  /** Coût CPU d'une requête et latence p95 à faible charge : à mesurer, par exemple avec l'API Client et un profilage. */
  service: z.object({ cpuMsPerRequest: z.number().positive(), baselineP95Ms: z.number().positive() }),
  ...capacityCommon,
});

export const MeasuredCapacityInputSchema = z.object({
  mode: z.literal("measured"),
  runs: z.array(MeasuredRunSchema).min(1).max(6),
  referenceIndex: z.number().int().min(0).default(0),
  overrides: z
    .object({ cpuMsPerRequest: z.number().positive().optional(), baselineP95Ms: z.number().positive().optional() })
    .optional(),
  ...capacityCommon,
});

export const CapacityInputSchema = z.discriminatedUnion("mode", [PredictiveCapacityInputSchema, MeasuredCapacityInputSchema]);
export type CapacityInput = z.output<typeof CapacityInputSchema>;

interface NormalizedCommon {
  objectives: Objectives;
  policy: Policy;
  assumptions: AssumptionsInput;
  configs: ArchitectureConfig[];
  baseline: ArchitectureConfig | undefined;
  sizingTemplate: SizingTemplate | undefined;
}

export type NormalizedCapacityInput =
  | (NormalizedCommon & { mode: "predictive"; service: { cpuMsPerRequest: number; baselineP95Ms: number } })
  | (NormalizedCommon & {
      mode: "measured";
      runs: MeasuredRun[];
      referenceIndex: number;
      overrides: { cpuMsPerRequest?: number; baselineP95Ms?: number };
    });

/** Applique les valeurs par défaut des objectifs, de la politique et des hypothèses. */
export function normalizeCapacityInput(input: CapacityInput): NormalizedCapacityInput {
  const common: NormalizedCommon = {
    objectives: ObjectivesSchema.parse(input.objectives ?? {}),
    policy: PolicySchema.parse(input.policy ?? {}),
    assumptions: AssumptionsInputSchema.parse(input.assumptions ?? {}),
    configs: input.configs,
    baseline: input.baseline,
    sizingTemplate: input.sizingTemplate,
  };
  if (input.mode === "predictive") return { ...common, mode: "predictive", service: input.service };
  return {
    ...common,
    mode: "measured",
    runs: input.runs,
    referenceIndex: input.referenceIndex,
    overrides: input.overrides ?? {},
  };
}