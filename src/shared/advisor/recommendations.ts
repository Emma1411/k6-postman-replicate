import type { Objectives } from "@/shared/schemas";
import type { CapacityEvidence, Finding, FindingCode, Recommendation } from "@/shared/types/advisor-result";
import { requiredRps } from "./objectives";
import { round1 } from "./stats";

function has(findings: Finding[], code: FindingCode): Finding | undefined {
  return findings.find((f) => f.code === code);
}

/** Facteur par lequel multiplier la capacité observée pour tenir l'objectif avec marge, si calculable. */
function capacityFactor(capacity: CapacityEvidence, objectives: Objectives): string | null {
  const needed = requiredRps(objectives);
  if (needed === null || capacity.sustainedRps === null || capacity.sustainedRps <= 0) return null;
  const factor = needed / capacity.sustainedRps;
  const qualifier = capacity.kind === "lower-bound" ? "au plus" : "environ";
  return `Objectif avec marge : ${round1(needed)} req/s, soit ${qualifier} ×${round1(factor)} la capacité observée (${capacity.sustainedRps} req/s).`;
}

export function buildRecommendations(findings: Finding[], capacity: CapacityEvidence, objectives: Objectives): Recommendation[] {
  const recs: Recommendation[] = [];
  const factorText = capacityFactor(capacity, objectives);

  const cpu = has(findings, "cpu-limit");
  if (cpu) {
    recs.push({
      kind: "scale-out",
      priority: 1,
      title: "Ajouter des instances applicatives",
      detail: ["Le CPU est le facteur limitant : répartir la charge sur plus d'instances est la voie la plus directe.", factorText].filter(Boolean).join(" "),
      actions: [
        "Ajouter des instances applicatives derrière un load balancer",
        "Vérifier que les services partagés (base de données, cache) supportent la charge supplémentaire",
        "Adapter le nombre de réplicas à la charge cible plus la marge",
      ],
      basedOn: ["cpu-limit"],
    });
    recs.push({
      kind: "scale-up",
      priority: 2,
      title: "Augmenter les vCPU par instance",
      detail: "Alternative à l'ajout d'instances : utile si l'application exploite bien plusieurs cœurs. Le gain n'est pas proportionnel (voir le capacity planning).",
      actions: ["Augmenter le nombre de vCPU par instance", "Vérifier les limites CPU des conteneurs", "Profiler les endpoints les plus coûteux avant de dimensionner"],
      basedOn: ["cpu-limit"],
    });
  }

  const memory = has(findings, "memory-pressure");
  if (memory) {
    recs.push({
      kind: "scale-up",
      priority: memory.severity === "critical" ? 1 : 2,
      title: "Augmenter la mémoire ou réduire l'empreinte",
      detail: "La mémoire est sous pression. Si elle croît sans cesse pendant le test, cherche d'abord une fuite avant d'ajouter de la RAM.",
      actions: [
        "Augmenter la RAM par instance",
        "Vérifier les limites mémoire des conteneurs",
        "Examiner les caches et files en mémoire, et la croissance de la mémoire dans le temps",
      ],
      basedOn: ["memory-pressure"],
    });
  }

  if (has(findings, "db-pool-limit")) {
    recs.push({
      kind: "tune",
      priority: 1,
      title: "Adapter les pools de connexions et les limites de la base",
      detail: "Le pool est saturé. Le total des pools (taille du pool × nombre d'instances) doit rester sous la limite de connexions de la base, avec une marge.",
      actions: [
        "Ajuster la taille du pool par instance",
        "Vérifier la limite de connexions de la base de données",
        "Envisager un répartiteur de connexions (par exemple PgBouncer pour PostgreSQL)",
        "Examiner les requêtes lentes qui retiennent les connexions",
      ],
      basedOn: ["db-pool-limit"],
    });
  }

  if (has(findings, "io-or-dependency-wait")) {
    recs.push({
      kind: "investigate",
      priority: 1,
      title: "Chercher l'attente (base de données, appels externes, verrous)",
      detail: "Le CPU est faible alors que la latence est élevée : n'ajoute pas de vCPU. Identifie ce que le service attend.",
      actions: [
        "Tracer les requêtes les plus lentes et les appels vers des services externes",
        "Vérifier les verrous, les files d'attente et les pools de threads ou de connexions",
        "Contrôler les délais d'attente (timeouts) des dépendances",
      ],
      basedOn: ["io-or-dependency-wait"],
    });
  }

  if (has(findings, "shared-dependency-scaling")) {
    recs.push({
      kind: "investigate",
      priority: 1,
      title: "Examiner les dépendances partagées avant d'ajouter des instances",
      detail: "La mise à l'échelle ne suit pas le nombre d'instances : un composant commun limite probablement le débit.",
      actions: [
        "Vérifier la capacité des services partagés (base de données, cache, file de messages)",
        "Contrôler les limites de débit imposées par des services tiers",
        "Mesurer l'utilisation de ces services pendant un test avec plusieurs instances",
      ],
      basedOn: ["shared-dependency-scaling"],
    });
  }

  if (has(findings, "network-latency")) {
    recs.push({
      kind: "investigate",
      priority: 2,
      title: "Vérifier le chemin réseau",
      detail: "Le RTT est élevé. Vérifie d'abord que le générateur n'est pas simplement loin du service.",
      actions: ["Comparer avec un test lancé depuis la même région que le service", "Vérifier la réutilisation des connexions (keep-alive) et le coût du TLS", "Examiner le routage et la présence d'un CDN"],
      basedOn: ["network-latency"],
    });
  }

  if (has(findings, "generator-saturated") || has(findings, "dropped-iterations")) {
    recs.push({
      kind: "verify",
      priority: 1,
      title: "Relancer le test avec un générateur moins chargé",
      detail: "Les mesures sont faussées ou la cadence n'a pas été tenue : les conclusions sont à confirmer.",
      actions: ["Augmenter le nombre de workers ou lancer le test depuis une machine séparée", "Réduire la charge demandée au générateur"],
      basedOn: (["generator-saturated", "dropped-iterations"] as FindingCode[]).filter((c) => has(findings, c)),
    });
  }

  if (has(findings, "insufficient-load-range")) {
    recs.push({
      kind: "verify",
      priority: 2,
      title: "Lancer un test en rampe pour trouver la limite",
      detail: "Le test à charge constante ne montre pas où la capacité s'arrête.",
      actions: ["Utiliser un executor ramping-arrival-rate ou ramping-vus qui monte au-delà de l'objectif"],
      basedOn: ["insufficient-load-range"],
    });
  }

  if (has(findings, "no-infra-metrics")) {
    recs.push({
      kind: "tune",
      priority: 2,
      title: "Collecter les métriques d'infrastructure",
      detail: "Sans CPU, mémoire et connexions DB, la cause d'un dépassement d'objectif ne peut pas être identifiée.",
      actions: ["Connecter Prometheus ou saisir les métriques CPU et mémoire observées pendant le test"],
      basedOn: ["no-infra-metrics"],
    });
  }

  const slo = has(findings, "slo-p95-breach");
  const errors = has(findings, "error-rate-anomaly");
  if ((slo || errors) && recs.every((r) => r.kind === "verify" || r.kind === "tune")) {
    recs.push({
      kind: "investigate",
      priority: 1,
      title: "Identifier la cause du dépassement d'objectif",
      detail: "L'objectif n'est pas tenu mais les indicateurs disponibles ne désignent pas de cause précise.",
      actions: ["Ajouter les métriques d'infrastructure manquantes", "Lancer un test en rampe pour situer le niveau de charge où la dégradation commence"],
      basedOn: (["slo-p95-breach", "error-rate-anomaly"] as FindingCode[]).filter((c) => has(findings, c)),
    });
  }

  recs.push({
    kind: "verify",
    priority: 3,
    title: "Valider tout changement par un nouveau test",
    detail: "Ces recommandations sont consultatives : rien n'est modifié automatiquement. Après chaque changement, relance un test avec la même forme de charge pour confirmer l'effet.",
    actions: ["Relancer le même scénario et comparer les résultats avec ce test"],
    basedOn: [],
  });

  return recs.sort((a, b) => a.priority - b.priority);
}