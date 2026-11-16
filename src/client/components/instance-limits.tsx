"use client";

import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Explain } from "@/client/components/explain";
import type { GlossaryTerm } from "@/client/content/glossary";
import { formatBytes, formatDuration, formatInt } from "@/client/lib/format";
import { useAppSelector } from "@/client/store/hooks";

interface Row {
  label: string;
  value: string;
  term?: GlossaryTerm;
}

export function InstanceLimits() {
  const config = useAppSelector((s) => s.config);

  if (config.status === "idle" || config.status === "loading") {
    return <Skeleton className="h-48 w-full" />;
  }
  if (config.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        Impossible de lire les limites de l&apos;instance : {config.message}
      </p>
    );
  }

  const { limits, deploymentMode, features } = config.value;
  const rows: Row[] = [
    { label: "Utilisateurs virtuels simultanés", value: formatInt(limits.load.maxVus), term: "vu" },
    { label: "Durée d'un test de charge", value: formatDuration(limits.load.maxDurationSeconds) },
    { label: "Débit maximal", value: `${formatInt(limits.load.maxRequestsPerSecond)} req/s`, term: "rps" },
    { label: "Tests de charge en parallèle", value: formatInt(limits.load.maxConcurrentRuns) },
    { label: "Tests de charge par heure", value: formatInt(limits.rateLimit.maxLoadRunsPerHour) },
    {
      label: "Appels à l'API",
      value: `${formatInt(limits.rateLimit.maxRequests)} par ${formatDuration(limits.rateLimit.windowSeconds)}`,
    },
    { label: "Taille maximale d'une réponse", value: formatBytes(limits.http.maxResponseBytes) },
    { label: "Délai maximal d'une requête", value: formatDuration(limits.http.maxTimeoutMs / 1000) },
    { label: "Étapes par scénario", value: formatInt(limits.workflow.maxSteps) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">Limites de cette instance</h2>
        {features.privateNetworks && <Badge variant="outline">Réseaux privés autorisés</Badge>}
        {!features.loadTests && <Badge variant="destructive">Test de charge indisponible</Badge>}
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {deploymentMode === "public"
          ? "Ce service est partagé : ces plafonds évitent qu'un seul test mobilise toutes les ressources. Pour des charges plus élevées, lance ta propre instance avec Docker."
          : "Cette instance est privée : les plafonds sont fixés par la personne qui l'administre."}
      </p>
      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="bg-card p-4">
            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
              {row.label}
              {row.term && <Explain term={row.term} />}
            </dt>
            <dd className="mt-1 text-lg font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}