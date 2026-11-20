"use client";

import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { describeError } from "@/client/api/errors";
import { Button } from "@/client/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import {
  draftToSendInput as _unused,
  validateDraft,
  type RequestDraft,
} from "@/client/features/requests/model";
import { loadSavedDraft } from "@/client/features/requests/draft-persistence";
import {
  loadEnvironments,
  selectActiveVariables,
} from "@/client/features/requests/environments-slice";
import { takeLoadHandoff } from "@/client/features/requests/load-handoff";
import { useSettingState } from "@/client/lib/use-setting-state";
import type { StoredLoadResult } from "@/client/storage/db";
import { listResults } from "@/client/storage/repositories";
import {
  useAppDispatch,
  useAppSelector,
  useAppStore,
} from "@/client/store/hooks";
import { loadConfig } from "@/client/store/config-slice";
import { resetLoad, scenarioRestored } from "../load-slice";
import { isCriteriaDraft, isProfileDraft } from "../persisted";
import { DEFAULT_CRITERIA, DEFAULT_PROFILE, buildScenario } from "../profile";
import {
  cancelRun,
  detachFromRun,
  findResumableRun,
  resumeRun,
  startRun,
  type ControllerDeps,
} from "../run-controller";
import { checkAgainstLimits, scenarioPeaks } from "../scenario-limits";
import { CriteriaSection } from "./criteria-section";
import { LaunchBar } from "./launch-bar";
import { LiveDashboard } from "./live-dashboard";
import { PreviousTests } from "./previous-tests";
import { ProfileSection } from "./profile-section";
import { ResultView } from "./result-view";
import { TargetSection, type TargetCheck } from "./target-section";
import {
  takeScenarioHandoff,
  type ScenarioHandoff,
} from "@/client/features/requests/load-handoff";
import { PlannedScenarioCard } from "./planned-scenario-card";

/** `variables: null` : on utilise celles de l'environnement choisi. */
interface Target {
  draft: RequestDraft;
  variables: Record<string, string> | null;
}

void _unused;

export function LoadWorkspace() {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const load = useAppSelector((s) => s.load);
  const config = useAppSelector((s) => s.config);
  const envVariables = useAppSelector(selectActiveVariables);
  const deps = useMemo<ControllerDeps>(
    () => ({ dispatch: store.dispatch, getState: store.getState }),
    [store],
  );
  const [planned, setPlanned] = useState<ScenarioHandoff | null>(null);

  const [tab, setTab] = useState<"new" | "previous">("new");
  const [viewing, setViewing] = useState<StoredLoadResult | null>(null);
  const [target, setTarget] = useState<Target | null | undefined>(undefined);
  const [check, setCheck] = useState<TargetCheck | null>(null);
  const [profile, setProfile] = useSettingState(
    "load-profile",
    DEFAULT_PROFILE,
    isProfileDraft,
  );
  const [criteria, setCriteria] = useSettingState(
    "load-criteria",
    DEFAULT_CRITERIA,
    isCriteriaDraft,
  );
  const [previousCount, setPreviousCount] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  /* Configuration de l'instance, environnements et requête à tester. */
  useEffect(() => {
    dispatch(loadConfig());
    dispatch(loadEnvironments());
    (async () => {
      const plannedScenario = await takeScenarioHandoff().catch(() => null);
      if (plannedScenario) {
        setPlanned(plannedScenario);
        return;
      }
      const handoff = await takeLoadHandoff().catch(() => null);
      if (handoff) {
        setTarget({ draft: handoff.draft, variables: handoff.variables });
        return;
      }
      const saved = await loadSavedDraft();
      const fallback: Target | null =
        saved && validateDraft(saved) === null
          ? { draft: saved, variables: null }
          : null;
      setTarget((previous) => previous ?? fallback);
    })();
  }, [dispatch]);

  /* Reprise d'un test lancé avant un rechargement ou une navigation. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const phase = store.getState().load.phase;
      if (phase === "finished" || phase === "error") return;
      const record = await findResumableRun();
      if (cancelled || !record) return;
      if (!store.getState().load.scenario)
        dispatch(scenarioRestored(record.scenario ?? null));
      void resumeRun(record.runId, deps);
    })();
    return () => {
      cancelled = true;
      detachFromRun();
    };
  }, [deps, dispatch, store]);

  /* Nombre de tests enregistrés. */
  useEffect(() => {
    listResults()
      .then((all) => setPreviousCount(all.length))
      .catch(() => setPreviousCount(null));
  }, [load.phase]);

  const limits = config.status === "ready" ? config.value.limits : null;
  const instanceBusy =
    config.status === "ready" &&
    config.value.status.busy &&
    load.phase !== "starting" &&
    load.phase !== "running";
  const unavailable =
    config.status === "ready" && !config.value.features.loadTests;
  const variables = target?.variables ?? envVariables;

  const scenario = useMemo(
    () =>
      target
        ? buildScenario({
            draft: target.draft,
            variables,
            profile,
            criteria,
            vuCap: limits?.load.maxVus ?? 100,
          })
        : null,
    [target, variables, profile, criteria, limits],
  );
  const problems = useMemo(
    () => (scenario && limits ? checkAgainstLimits(scenario, limits) : []),
    [scenario, limits],
  );
  const peaks = scenario ? scenarioPeaks(scenario.executor) : null;

  const launch = useCallback(() => {
    if (scenario) void startRun(scenario, deps);
  }, [scenario, deps]);

  const replay = useCallback(
    (replayScenario: NonNullable<StoredLoadResult["scenario"]>) => {
      setViewing(null);
      setTab("new");
      void startRun(replayScenario, deps);
    },
    [deps],
  );

  async function cancel() {
    const runId = store.getState().load.run?.runId;
    if (!runId) return;
    try {
      await cancelRun(runId);
      setCancelError(null);
    } catch (err) {
      setCancelError(describeError(err).detail);
    }
  }

  const onChanged = useCallback((count: number) => setPreviousCount(count), []);

  function renderNew() {
    if (viewing) {
      return (
        <ResultView
          result={viewing.result}
          points={viewing.points}
          scenario={viewing.scenario}
          onBack={() => {
            setViewing(null);
            setTab("previous");
          }}
          onReplay={
            viewing.scenario ? () => replay(viewing.scenario!) : undefined
          }
          onNew={() => setViewing(null)}
        />
      );
    }
    if (load.phase === "starting" || load.phase === "running") {
      return <LiveDashboard onCancel={cancel} cancelError={cancelError} />;
    }
    if (load.phase === "finished" && load.result) {
      if (planned) {
        return (
          <PlannedScenarioCard
            planned={planned}
            limits={limits}
            busy={instanceBusy}
            unavailable={unavailable}
            onLaunch={() => {
              const scenarioToRun = planned.scenario;
              setPlanned(null);
              void startRun(scenarioToRun, deps);
            }}
            onDismiss={() => setPlanned(null)}
          />
        );
      }
      return (
        <ResultView
          result={load.result}
          points={load.points}
          scenario={load.scenario}
          onNew={() => dispatch(resetLoad())}
          onReplay={load.scenario ? () => replay(load.scenario!) : undefined}
        />
      );
    }
    if (load.phase === "error" && load.error) {
      return (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive/50 bg-card p-6"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive-text">
            <AlertTriangle className="size-5" aria-hidden />
            {load.error.title}
          </h2>
          <p className="text-sm">{load.error.detail}</p>
          {load.error.hint && (
            <p className="text-sm text-muted-foreground">{load.error.hint}</p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => dispatch(resetLoad())}
          >
            Revenir à la préparation
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Préparer un test de charge</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Trois étapes : la cible, la charge à appliquer, et ce qui fait
            réussir le test. Le test est exécuté depuis cette instance.
          </p>
        </div>
        <TargetSection
          draft={target?.draft}
          variables={variables}
          check={check}
          onCheck={setCheck}
        />
        <ProfileSection
          profile={profile}
          onChange={setProfile}
          maxVus={limits?.load.maxVus ?? 100}
          maxRps={limits?.load.maxRequestsPerSecond ?? 500}
          maxDurationSeconds={limits?.load.maxDurationSeconds ?? 120}
          checkMs={check?.ms ?? null}
        />
        <CriteriaSection
          criteria={criteria}
          onChange={setCriteria}
          hasAssertions={(target?.draft.assertions.length ?? 0) > 0}
        />
        <LaunchBar
          peaks={peaks}
          limits={limits ? limits.load : null}
          problems={problems}
          busy={instanceBusy}
          unavailable={unavailable}
          hasTarget={Boolean(target)}
          onLaunch={launch}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "new" | "previous")}
      >
        <TabsList>
          <TabsTrigger value="new">Nouveau test</TabsTrigger>
          <TabsTrigger value="previous">
            Tests précédents
            {previousCount !== null ? ` (${previousCount})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "previous" ? (
        <PreviousTests
          onChanged={onChanged}
          onOpen={(result) => {
            setViewing(result);
            setTab("new");
          }}
          onReplay={(result) => result.scenario && replay(result.scenario)}
        />
      ) : (
        renderNew()
      )}
    </div>
  );
}
