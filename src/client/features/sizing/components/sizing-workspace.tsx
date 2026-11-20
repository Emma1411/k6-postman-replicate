"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { ProvenanceBadge } from "@/client/components/provenance-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { saveScenarioHandoff } from "@/client/features/requests/load-handoff";
import type { StoredLoadResult } from "@/client/storage/db";
import { getSetting, listResults, setSetting } from "@/client/storage/repositories";
import { loadConfig } from "@/client/store/config-slice";
import { useAppDispatch, useAppSelector, useAppStore } from "@/client/store/hooks";
import { analyzeStored } from "../analysis";
import { isCapacityDraft, objectivesFromStored, validateCapacity } from "../capacity-input";
import { DEFAULT_INFRA, isInfraDraft, type InfraDraft } from "../infra";
import { clearCapacity, clearMetrics, computeCapacity, hydrateSizing, selectRun, setCapacityDraft, setInfra, setMetrics } from "../sizing-slice";
import { buildVerificationScenario } from "../verification";
import { CapacityForm } from "./capacity-form";
import { CapacityResultView } from "./capacity-result-view";
import { FindingsView } from "./findings-view";
import { InfraForm } from "./infra-form";
import { InfrastructureTab } from "./infrastructure-tab";
import { RunSelector } from "./run-selector";

const INFRA_KEY = "sizing-infra";
const CAPACITY_KEY = "sizing-capacity";

const sameInfra = (a: InfraDraft, b: InfraDraft) =>
  a.instances === b.instances && a.vcpuPerInstance === b.vcpuPerInstance && a.ramGbPerInstance === b.ramGbPerInstance && a.poolSizePerInstance === b.poolSizePerInstance && a.dbMaxConnections === b.dbMaxConnections;

export function SizingWorkspace() {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const router = useRouter();
  const params = useSearchParams();
  const sizing = useAppSelector((s) => s.sizing);
  const config = useAppSelector((s) => s.config);

  const [results, setResults] = useState<StoredLoadResult[] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [infraConfirmed, setInfraConfirmed] = useState(false);
  const [tab, setTab] = useState("diagnostic");
  const [verifyError, setVerifyError] = useState<string | null>(null);

  /* Réglages enregistrés, tests précédents et configuration de l'instance. */
  useEffect(() => {
    let cancelled = false;
    dispatch(loadConfig());
    (async () => {
      const [infra, capacity, all] = await Promise.all([
        getSetting<unknown>(INFRA_KEY, null).catch(() => null),
        getSetting<unknown>(CAPACITY_KEY, null).catch(() => null),
        listResults().catch(() => [] as StoredLoadResult[]),
      ]);
      if (cancelled) return;
      dispatch(hydrateSizing({ infra: isInfraDraft(infra) ? infra : undefined, capacity: isCapacityDraft(capacity) ? capacity : undefined }));
      if (isInfraDraft(infra)) setInfraConfirmed(true);
      setResults(all);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  /* Conservation des réglages (l'architecture seulement une fois confirmée ou modifiée). */
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      if (infraConfirmed || !sameInfra(sizing.infra, DEFAULT_INFRA)) void setSetting(INFRA_KEY, sizing.infra).catch(() => undefined);
      void setSetting(CAPACITY_KEY, sizing.capacity).catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [sizing.infra, sizing.capacity, infraConfirmed, hydrated]);

  /* Test analysé : celui de l'adresse, sinon le dernier choisi, sinon le plus récent. */
  const wanted = params.get("run");
  useEffect(() => {
    if (!results || !hydrated) return;
    const previous = store.getState().sizing.selectedId;
    const id = results.some((r) => r.id === wanted) ? wanted : results.some((r) => r.id === previous) ? previous : (results[0]?.id ?? null);
    dispatch(selectRun(id));
  }, [results, hydrated, wanted, dispatch, store]);

  const storedId = sizing.selectedId;
  const stored = useMemo(() => results?.find((r) => r.id === storedId) ?? null, [results, storedId]);

  /* Les objectifs reprennent les critères de succès du test choisi. */
  useEffect(() => {
    const found = results?.find((r) => r.id === storedId);
    if (!found) return;
    const patch = objectivesFromStored(found);
    if (Object.keys(patch).length === 0) return;
    const current = store.getState().sizing.capacity;
    dispatch(setCapacityDraft({ ...current, objectives: { ...current.objectives, ...patch } }));
  }, [storedId, results, dispatch, store]);

  const metrics = sizing.metrics && sizing.metrics.forRunId === storedId ? sizing.metrics : null;
  const limits = config.status === "ready" ? config.value.limits : null;

  const analysis = useMemo(
    () => (stored ? analyzeStored({ stored, infra: sizing.infra, metrics: metrics?.infraMetrics ?? null, targetRps: sizing.capacity.objectives.targetRps }) : null),
    [stored, sizing.infra, metrics, sizing.capacity.objectives.targetRps],
  );

  const problems = validateCapacity(sizing.capacity, sizing.infra, { hasRun: stored !== null });
  const capacityState = sizing.capacityState;
  const capacityResult = capacityState.status === "done" ? capacityState.result : null;

  const changeRun = useCallback(
    (id: string) => {
      dispatch(selectRun(id));
      router.replace(`/sizing?run=${encodeURIComponent(id)}`);
    },
    [dispatch, router],
  );

  const verification = useMemo(() => {
    if (!capacityResult || !stored) return null;
    return buildVerificationScenario(stored, capacityResult.verification, limits);
  }, [capacityResult, stored, limits]);

  async function verify() {
    if (!verification || !verification.ok) return;
    setVerifyError(null);
    try {
      await saveScenarioHandoff({
        scenario: verification.scenario,
        label: "Plan de vérification de l'Advisor : il confirme ou infirme l'estimation de capacité.",
        createdAt: Date.now(),
      });
      router.push("/load");
    } catch {
      setVerifyError("Le stockage du navigateur est indisponible : impossible de transmettre le test.");
    }
  }

  const infraUnconfirmed = !infraConfirmed && sameInfra(sizing.infra, DEFAULT_INFRA);
  const verdictBadge = capacityResult ? capacityResult.scenarios.find((s) => s.isReference)?.verdict ?? capacityResult.scenarios[0]?.verdict : null;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold">Dimensionnement</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Comprends pourquoi ton API a décroché, puis calcule l&apos;architecture qu&apos;il te faut pour une charge visée. Le calcul est déterministe : pas d&apos;IA.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RunSelector results={results} value={storedId} onChange={changeRun} />
          {stored && <ProvenanceBadge kind="measured" />}
          {results !== null && results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucun test enregistré. <Link href="/load" className="text-primary underline underline-offset-2">Lance un test de charge</Link> pour obtenir un diagnostic, ou utilise le mode « à partir d&apos;hypothèses » de l&apos;onglet Capacité.
            </p>
          )}
        </div>
      </header>

      <InfraForm
        value={sizing.infra}
        onChange={(value) => dispatch(setInfra(value))}
        unconfirmed={infraUnconfirmed}
        onConfirm={() => setInfraConfirmed(true)}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="diagnostic">
            Diagnostic{analysis?.ok ? <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">{analysis.result.findings.length}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="capacity">
            Capacité{verdictBadge ? <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">{verdictBadge}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="infrastructure">
            Infrastructure{metrics ? <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">{metrics.source === "prometheus" ? "Prometheus" : "CSV"}</Badge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="diagnostic" className="pt-6">
          {!stored ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-6">
              <h2 className="text-base font-semibold">Choisis un test, ou lance-en un</h2>
              <p className="text-sm text-muted-foreground">Le diagnostic analyse un test de charge terminé : latences, débit, erreurs, et les mesures d&apos;infrastructure si tu en as.</p>
              <Button asChild variant="outline" size="sm"><Link href="/load">Préparer un test de charge</Link></Button>
            </div>
          ) : analysis && !analysis.ok ? (
            <p role="alert" className="rounded-xl border border-border bg-card p-6 text-sm">{analysis.reason}</p>
          ) : analysis ? (
            <FindingsView analysis={analysis.result} stored={stored} />
          ) : null}
        </TabsContent>

        <TabsContent value="capacity" className="space-y-6 pt-6">
          <CapacityForm
            draft={sizing.capacity}
            infra={sizing.infra}
            onChange={(draft) => {
              dispatch(setCapacityDraft(draft));
              if (capacityState.status !== "idle") dispatch(clearCapacity());
            }}
            problems={problems}
            loading={capacityState.status === "loading"}
            hasRun={stored !== null}
            onCompute={() => void dispatch(computeCapacity({ stored }))}
          />
          {capacityState.status === "error" && (
            <div role="alert" className="space-y-1 rounded-xl border border-destructive/50 bg-card p-5">
              <h2 className="font-semibold text-destructive-text">{capacityState.error.title}</h2>
              <p className="text-sm">{capacityState.error.detail}</p>
              {capacityState.error.hint && <p className="text-sm text-muted-foreground">{capacityState.error.hint}</p>}
            </div>
          )}
          {capacityResult && (
            <CapacityResultView
              result={capacityResult}
              verification={{
                blockers: verification?.ok ? verification.blockers : [],
                error: verifyError ?? (verification && !verification.ok ? verification.error : null),
                ready: verification?.ok === true,
              }}
              onVerify={verify}
            />
          )}
        </TabsContent>

        <TabsContent value="infrastructure" className="pt-6">
          <InfrastructureTab
            stored={stored}
            infra={sizing.infra}
            metrics={metrics}
            onApply={(m) => dispatch(setMetrics(m))}
            onClear={() => dispatch(clearMetrics())}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}