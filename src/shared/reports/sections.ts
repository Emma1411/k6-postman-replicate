import type { AnalyzeResult, CapacityEvidence, Confidence, RecommendationKind, Severity } from "@/shared/types/advisor-result";
import type { CapacityResult, CheckStatus, ScenarioResult, Verdict } from "@/shared/types/capacity-result";
import type { ChangeVerdict, MetricComparison, RunComparison, ThresholdChange, WorkflowComparison } from "@/shared/types/comparison-result";
import { formatNumber, formatSigned } from "../format";
import { cell, kv, type Cell, type Section, type Tone } from "./model";

const num = (v: number | null, digits = 1): string => (v === null ? "—" : formatNumber(v, digits));

const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critique", warning: "Avertissement", info: "Info" };
const SEVERITY_TONE: Record<Severity, Tone> = { critical: "danger", warning: "warning", info: "muted" };
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "Élevée", medium: "Moyenne", low: "Faible" };
const RECOMMENDATION_LABEL: Record<RecommendationKind, string> = {
  "scale-up": "Scale up",
  "scale-out": "Scale out",
  tune: "Réglage",
  investigate: "Investigation",
  verify: "Vérification",
};
const CAPACITY_KIND_LABEL: Record<CapacityEvidence["kind"], string> = {
  bracketed: "Limite atteinte (intervalle)",
  "lower-bound": "Limite non atteinte (borne basse)",
  "upper-bound": "Déjà dépassée au niveau testé (borne haute)",
  unknown: "Inconnue",
};
const INFRA_LABEL = { none: "Aucune", observed: "Observées", "user-provided": "Saisies par l'utilisateur" } as const;

export const ADVISORY_DISCLAIMER =
  "Ces résultats sont consultatifs : rien n'est modifié automatiquement. Les capacités et latences estimées sont des estimations fondées sur des hypothèses visibles, pas des garanties. Valide toute décision par un test de charge.";

// --- Advisor --------------------------------------------------------------------------------------------------------

export function advisorSections(a: AnalyzeResult): Section[] {
  const s = a.summary;
  const e = a.capacity;

  return [
    {
      title: "Résumé du test analysé",
      blocks: [
        {
          type: "keyvalues",
          rows: [
            kv("Durée", `${formatNumber(s.durationSeconds, 0)} s`),
            kv("Requêtes", formatNumber(s.totalRequests, 0)),
            kv("Débit moyen / pic", `${num(s.avgRps)} / ${num(s.peakRps)} req/s`),
            kv("VUs maximum", formatNumber(s.maxVus, 0)),
            kv("Taux d'erreur", s.errorRate === null ? "—" : `${formatNumber(s.errorRate * 100, 2)} %`),
            kv("p95 à faible charge / au pic", `${num(s.baselineP95Ms)} / ${num(s.peakP95Ms)} ms`),
            kv("Itérations abandonnées", formatNumber(s.droppedIterations, 0), s.droppedIterations > 0 ? "warning" : undefined),
          ],
        },
      ],
    },
    {
      title: "Capacité observée",
      blocks: [
        { type: "text", text: e.basis },
        {
          type: "keyvalues",
          rows: [
            kv("Nature de la mesure", CAPACITY_KIND_LABEL[e.kind]),
            kv("Capacité tenue", e.sustainedRps === null ? "—" : `${num(e.sustainedRps)} req/s`),
            kv("Premier dépassement", e.breachRps === null ? "—" : `${num(e.breachRps)} req/s`),
            kv("Plage de charge testée", `${num(e.loadRange.minRps)} à ${num(e.loadRange.maxRps)} req/s`),
            kv("Forme de la charge", e.shape === "variable" ? "Variable (rampe ou paliers)" : "Constante"),
          ],
        },
      ],
    },
    {
      title: "Constats",
      blocks:
        a.findings.length === 0
          ? [{ type: "text", text: "Aucun constat : les objectifs sont tenus et aucun indicateur ne s'écarte des seuils.", tone: "success" }]
          : [
              {
                type: "table",
                columns: ["Gravité", "Constat", "Confiance", "Indicateurs combinés"],
                rows: a.findings.map((f) => [
                  cell(SEVERITY_LABEL[f.severity], SEVERITY_TONE[f.severity]),
                  cell(f.title),
                  cell(CONFIDENCE_LABEL[f.confidence]),
                  cell(f.indicators.length > 0 ? f.indicators.join(", ") : "—"),
                ]),
              },
              {
                type: "list",
                items: a.findings.map(
                  (f) => `${f.title} : ${f.summary}${f.evidence.length > 0 ? ` [${f.evidence.map((x) => `${x.label} : ${x.value}`).join(" ; ")}]` : ""}`,
                ),
              },
            ],
    },
    {
      title: "Recommandations",
      blocks: [
        {
          type: "table",
          columns: ["Priorité", "Type", "Recommandation", "Actions"],
          rows: a.recommendations.map((r) => [
            cell(String(r.priority), r.priority === 1 ? "danger" : undefined),
            cell(RECOMMENDATION_LABEL[r.kind]),
            cell(`${r.title} — ${r.detail}`),
            cell(r.actions.join(" ; ")),
          ]),
        },
        { type: "text", text: ADVISORY_DISCLAIMER, tone: "muted" },
      ],
    },
    {
      title: "Qualité des données",
      blocks: [
        {
          type: "keyvalues",
          rows: [
            kv("Métriques d'infrastructure", INFRA_LABEL[a.dataQuality.infraMetrics]),
            kv("Métriques absentes", a.dataQuality.missingMetrics.length > 0 ? a.dataQuality.missingMetrics.join(", ") : "Aucune"),
            kv("Mesures fiables", a.dataQuality.reliable ? "Oui" : "Non (générateur saturé)", a.dataQuality.reliable ? "success" : "danger"),
          ],
        },
        ...(a.dataQuality.warnings.length > 0 ? [{ type: "list" as const, items: a.dataQuality.warnings }] : []),
      ],
    },
  ];
}

// --- Capacity planning ----------------------------------------------------------------------------------------------

const VERDICT_LABEL: Record<Verdict, string> = { ok: "Passe", marginal: "Marginal", insufficient: "Insuffisante", undetermined: "Indéterminée" };
const VERDICT_TONE: Record<Verdict, Tone> = { ok: "success", marginal: "warning", insufficient: "danger", undetermined: "muted" };
const CHECK_LABEL: Record<CheckStatus, string> = { ok: "OK", marginal: "Marginal", fail: "Échec", unknown: "Non vérifié" };
const CHECK_TONE: Record<CheckStatus, Tone> = { ok: "success", marginal: "warning", fail: "danger", unknown: "muted" };
const SOURCE_LABEL = { default: "Par défaut", "user-provided": "Saisie", calibrated: "Calibrée" } as const;

function capacityRange(c: ScenarioResult["capacity"]): string {
  if (c.estimateRps !== null) return `${num(c.estimateRps, 0)} (${num(c.lowRps, 0)}–${num(c.highRps, 0)})`;
  if (c.lowRps !== null) return `≥ ${num(c.lowRps, 0)}`;
  if (c.highRps !== null) return `≤ ${num(c.highRps, 0)}`;
  return "—";
}

export function capacitySections(c: CapacityResult): Section[] {
  const t = c.target;
  const sections: Section[] = [
    {
      title: "Objectif",
      blocks: [
        {
          type: "keyvalues",
          rows: [
            kv("Mode", c.mode === "predictive" ? "Prédictif (hypothèses saisies)" : "Mesuré (calibré sur un test)"),
            kv("Débit cible", `${num(t.targetRps)} req/s`),
            kv("Débit requis (avec marge)", `${num(t.requiredRps)} req/s`),
            kv("Marge de capacité", `${formatNumber(t.headroomPercent, 0)} %`),
            kv("p95 maximal", t.p95MaxMs === null ? "—" : `${num(t.p95MaxMs, 0)} ms`),
          ],
        },
      ],
    },
    {
      title: "Modèle et hypothèses",
      blocks: [
        ...(c.modelSummary.length > 0 ? [{ type: "list" as const, items: c.modelSummary }] : []),
        {
          type: "table",
          columns: ["Hypothèse", "Valeur", "Origine", "Précision"],
          rows: c.assumptions.map((a) => [cell(a.label), cell(a.value), cell(SOURCE_LABEL[a.source]), cell(a.note)]),
        },
      ],
    },
    {
      title: "Scénarios",
      blocks: [
        {
          type: "table",
          columns: ["Configuration", "Ressources totales", "Capacité estimée (req/s)", "p95 estimé (ms)", "Verdict", "Confiance"],
          rows: c.scenarios.map((s) => [
            cell(s.name),
            cell(`${formatNumber(s.totals.vcpu, 1)} vCPU, ${formatNumber(s.totals.ramGb, 1)} Go`),
            cell(capacityRange(s.capacity)),
            cell(
              s.atTarget.p95Ms === null
                ? "—"
                : `${num(s.atTarget.p95Ms)}${s.atTarget.p95PessimisticMs !== null ? ` (${num(s.atTarget.p95PessimisticMs)} pessimiste)` : ""}`,
            ),
            cell(VERDICT_LABEL[s.verdict], VERDICT_TONE[s.verdict]),
            cell(CONFIDENCE_LABEL[s.confidence]),
          ]),
        },
      ],
    },
    {
      title: "Contrôles par scénario",
      blocks: [
        {
          type: "table",
          columns: ["Configuration", "Capacité", "Latence", "Mémoire", "Base de données"],
          rows: c.scenarios.map((s) => [
            cell(s.name),
            ...([s.checks.capacity, s.checks.latency, s.checks.memory, s.checks.database] as const).map(
              (check): Cell => cell(`${CHECK_LABEL[check.status]} — ${check.detail}`, CHECK_TONE[check.status]),
            ),
          ]),
        },
      ],
    },
    {
      title: "Choix",
      blocks: [
        c.best
          ? { type: "text", text: c.best.reason, tone: c.scenarios[c.best.index]?.verdict === "ok" ? "success" : "warning" }
          : { type: "text", text: "Aucune configuration ne tient l'objectif : voir le dimensionnement ci-dessous.", tone: "danger" },
      ],
    },
    {
      title: "Dimensionnement",
      blocks: [
        { type: "text", text: c.sizing.explanation },
        {
          type: "keyvalues",
          rows: [
            kv("Taille d'instance", `${c.sizing.template.vcpuPerInstance} vCPU, ${c.sizing.template.ramGbPerInstance} Go`),
            kv("Instances minimales (estimation centrale)", c.sizing.minimumInstances === null ? "—" : String(c.sizing.minimumInstances)),
            kv("Instances recommandées (cas pessimiste)", c.sizing.recommendedInstances === null ? "—" : String(c.sizing.recommendedInstances)),
            kv("Plafond de la mise à l'échelle", c.sizing.scaleOutLimitRps === null ? "—" : `${num(c.sizing.scaleOutLimitRps, 0)} req/s`),
            kv("Instances maximales (base de données)", c.sizing.databaseMaxInstances === null ? "—" : String(c.sizing.databaseMaxInstances)),
          ],
        },
      ],
    },
  ];

  const v = c.verification;
  const limits = v.withinServerLimits;
  sections.push({
    title: "Test de vérification proposé",
    blocks: [
      {
        type: "keyvalues",
        rows: [
          kv("Type de charge", v.executor.type),
          kv("Débit de pointe", `${num(v.expectedPeakRps)} req/s`),
          kv("Durée", `${formatNumber(v.durationSeconds, 0)} s`),
        ],
      },
      { type: "list", items: v.thresholds.map((th) => `${th.metric} ${th.expression}`) },
      { type: "list", items: v.notes },
      ...(limits && !limits.ok
        ? [{ type: "text" as const, text: `Ce plan dépasse les limites de ce serveur : ${limits.violations.join(" ; ")}.`, tone: "danger" as const }]
        : []),
    ],
  });

  if (c.warnings.length > 0) sections.push({ title: "Avertissements", blocks: [{ type: "list", items: c.warnings }] });
  sections.push({ title: "À retenir", blocks: [{ type: "text", text: ADVISORY_DISCLAIMER, tone: "muted" }] });
  return sections;
}

// --- Comparaisons ---------------------------------------------------------------------------------------------------

const CHANGE_LABEL: Record<ChangeVerdict, string> = { regression: "Régression", improvement: "Amélioration", unchanged: "Stable", unknown: "Non comparable" };
const CHANGE_TONE: Record<ChangeVerdict, Tone> = { regression: "danger", improvement: "success", unchanged: "normal", unknown: "muted" };
const LEVEL_LABEL = { comparable: "Comparables", partial: "Partiellement comparables", "not-comparable": "Non comparables" } as const;

const withUnit = (v: number | null, unit: MetricComparison["unit"]): string => (v === null ? "—" : `${formatNumber(v, unit === "%" ? 2 : 1)} ${unit}`);

function changeText(m: MetricComparison): string {
  if (m.change === null) return "—";
  return m.unit === "%" ? `${formatSigned(m.change, 2)} pt` : `${formatSigned(m.change, 1)} ${m.unit}`;
}

const THRESHOLD_STATE = { passed: "Respecté", failed: "En échec", mixed: "Variable", absent: "Absent" } as const;
const THRESHOLD_KIND: Record<ThresholdChange["kind"], string> = { "newly-failing": "Nouvel échec", "newly-passing": "Corrigé", unchanged: "Inchangé" };

export function loadComparisonSections(c: RunComparison): Section[] {
  const tone: Tone = { regression: "danger", improvement: "success", "no-change": "success", inconclusive: "warning" }[c.overall] as Tone;
  const sections: Section[] = [
    {
      title: "Synthèse de la comparaison",
      blocks: [
        { type: "text", text: c.summary, tone },
        {
          type: "keyvalues",
          rows: [
            kv("Référence", c.baselines.map((b) => `${b.label}${b.environment ? ` (${b.environment})` : ""}`).join(", ")),
            kv("Candidat", `${c.candidate.label}${c.candidate.environment ? ` (${c.candidate.environment})` : ""}`),
            kv("Tests de référence", String(c.baselineCount)),
            kv("Confiance", CONFIDENCE_LABEL[c.confidence]),
            kv("Comparabilité", LEVEL_LABEL[c.comparability.level], c.comparability.level === "comparable" ? "success" : "warning"),
          ],
        },
        ...(c.comparability.issues.length > 0 ? [{ type: "list" as const, items: c.comparability.issues }] : []),
      ],
    },
    {
      title: "Métriques",
      blocks: [
        {
          type: "table",
          columns: ["Métrique", "Référence", "Étendue", "Candidat", "Écart", "Écart %", "Verdict"],
          rows: c.metrics.map((m) => [
            cell(m.label),
            cell(withUnit(m.baseline, m.unit)),
            cell(m.baselineRange ? `${formatNumber(m.baselineRange[0], 1)}–${formatNumber(m.baselineRange[1], 1)}` : "—"),
            cell(withUnit(m.candidate, m.unit)),
            cell(changeText(m)),
            cell(m.changePercent === null ? "—" : `${formatSigned(m.changePercent, 1)} %`),
            cell(CHANGE_LABEL[m.verdict], CHANGE_TONE[m.verdict]),
          ]),
        },
        { type: "list", items: c.metrics.filter((m) => m.note).map((m) => `${m.label} : ${m.note}`) },
      ],
    },
  ];

  if (c.thresholds.length > 0) {
    sections.push({
      title: "Seuils",
      blocks: [
        {
          type: "table",
          columns: ["Métrique", "Expression", "Référence", "Candidat", "Évolution"],
          rows: c.thresholds.map((t) => [
            cell(t.metric),
            cell(t.expression),
            cell(THRESHOLD_STATE[t.baseline]),
            cell(THRESHOLD_STATE[t.candidate], t.candidate === "failed" ? "danger" : "success"),
            cell(THRESHOLD_KIND[t.kind], t.kind === "newly-failing" ? "danger" : t.kind === "newly-passing" ? "success" : undefined),
          ]),
        },
      ],
    });
  }
  if (c.notes.length > 0) sections.push({ title: "Notes", blocks: [{ type: "list", items: c.notes }] });
  return sections;
}

const STEP_KIND_LABEL = {
  "newly-failing": "Nouvel échec",
  fixed: "Corrigée",
  "newly-skipped": "Maintenant ignorée",
  "newly-run": "Maintenant exécutée",
  "assertions-changed": "Assertions modifiées",
} as const;

export function workflowComparisonSections(c: WorkflowComparison): Section[] {
  const tone: Tone = { regression: "danger", improvement: "success", "no-change": "success" }[c.overall] as Tone;
  const statusLabel = (s: "passed" | "failed") => (s === "passed" ? "Réussi" : "En échec");

  const sections: Section[] = [
    {
      title: "Synthèse de la comparaison",
      blocks: [
        { type: "text", text: c.summary, tone },
        {
          type: "keyvalues",
          rows: [kv("Résultat de référence", statusLabel(c.status.baseline)), kv("Résultat du candidat", statusLabel(c.status.candidate), c.status.candidate === "failed" ? "danger" : "success")],
        },
      ],
    },
  ];

  if (c.steps.length > 0) {
    sections.push({
      title: "Étapes modifiées",
      blocks: [
        {
          type: "table",
          columns: ["Étape", "Avant", "Après", "Changement", "Détails"],
          rows: c.steps.map((s) => [
            cell(s.name),
            cell(s.baselineStatus),
            cell(s.candidateStatus, s.kind === "newly-failing" ? "danger" : s.kind === "fixed" ? "success" : undefined),
            cell(STEP_KIND_LABEL[s.kind], s.kind === "newly-failing" ? "danger" : s.kind === "fixed" ? "success" : undefined),
            cell(s.changes.join(" ; ") || "—"),
          ]),
        },
      ],
    });
  }
  if (c.slower.length > 0) {
    sections.push({
      title: "Étapes plus lentes (indicatif)",
      blocks: [
        {
          type: "table",
          columns: ["Étape", "Avant (ms)", "Après (ms)", "Écart %"],
          rows: c.slower.map((s) => [cell(s.name), cell(formatNumber(s.baselineMs, 1)), cell(formatNumber(s.candidateMs, 1), "warning"), cell(`${formatSigned(s.changePercent, 0)} %`)]),
        },
      ],
    });
  }
  const changes = [...c.added.map((n) => `Étape ajoutée : ${n}`), ...c.removed.map((n) => `Étape retirée : ${n}`)];
  if (changes.length > 0) sections.push({ title: "Structure du workflow", blocks: [{ type: "list", items: changes }] });
  if (c.notes.length > 0) sections.push({ title: "Notes", blocks: [{ type: "list", items: c.notes }] });
  return sections;
}