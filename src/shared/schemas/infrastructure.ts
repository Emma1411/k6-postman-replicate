import { z } from "zod";

const noLineBreak = (value: string) => !/[\r\n\0]/.test(value);

export const PrometheusAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("basic"),
    username: z
      .string()
      .min(1)
      .max(256)
      .refine((v) => noLineBreak(v) && !v.includes(":"), "Nom d'utilisateur invalide."),
    password: z.string().max(1024).refine(noLineBreak, "Mot de passe invalide."),
  }),
  z.object({
    type: z.literal("bearer"),
    token: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/, "Jeton invalide."),
  }),
]);
export type PrometheusAuth = z.output<typeof PrometheusAuthSchema>;

export const PROMETHEUS_METRIC_KEYS = [
  "cpuPercent",
  "memoryPercent",
  "memoryAvailableMb",
  "dbConnectionsUsed",
  "networkRttMs",
] as const;
export type PrometheusMetricKey = (typeof PROMETHEUS_METRIC_KEYS)[number];

const PromQuery = z.string().trim().min(1).max(2000);

/** Une requête PromQL par métrique : chacune doit renvoyer une seule série (agrégée par avg ou sum). */
export const PromQueriesSchema = z
  .object({
    cpuPercent: PromQuery.optional(),
    memoryPercent: PromQuery.optional(),
    memoryAvailableMb: PromQuery.optional(),
    dbConnectionsUsed: PromQuery.optional(),
    networkRttMs: PromQuery.optional(),
  })
  .refine((q) => Object.values(q).some((v) => v !== undefined), { message: "Fournis au moins une requête PromQL." });

export const PrometheusConnectionSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  auth: PrometheusAuthSchema.optional(),
});
export type PrometheusConnectionInput = z.output<typeof PrometheusConnectionSchema>;

export const PrometheusQueryInputSchema = PrometheusConnectionSchema.extend({
  /** Début du test de charge (LoadRunInfo.startedAt). Les t des points de charge sont mesurés depuis cet instant. */
  startedAtMs: z.number().int().positive(),
  durationSeconds: z.number().positive().max(86_400),
  /** Pas des échantillons ; vise au moins l'intervalle de collecte de Prometheus (souvent 15 s). */
  stepSeconds: z.number().min(1).max(300).default(5),
  /** Horloge de Prometheus moins horloge de ce serveur, en secondes. */
  clockOffsetSeconds: z.number().min(-3600).max(3600).default(0),
  queries: PromQueriesSchema,
});
export type PrometheusQueryInput = z.output<typeof PrometheusQueryInputSchema>;