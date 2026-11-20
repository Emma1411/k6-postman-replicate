"use client";

import { Check, Loader2, Minus, Plug, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "@/client/api/errors";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import type { StoredLoadResult } from "@/client/storage/db";
import { getSetting, setSetting } from "@/client/storage/repositories";
import type { PrometheusMetricKey } from "@/shared/schemas";
import {
  CSV_EXAMPLE,
  parseInfraCsv,
  userMetrics,
  type InfraDraft,
} from "../infra";
import { METRIC_META, METRIC_ORDER } from "../metrics-series";
import {
  DEFAULT_PROM,
  SCRAPE_STEP_SECONDS,
  buildConnection,
  buildQueryInput,
  checkPrometheus,
  isPersistedProm,
  persistableProm,
  queryPrometheus,
  queryWarnings,
  validateConnection,
  type PromDraft,
} from "../prometheus";
import type { MetricsState } from "../sizing-slice";
import { MetricsPreview } from "./metrics-preview";

const PROM_KEY = "sizing-prometheus";
const STATUS_LABELS = {
  ok: "Données reçues",
  "no-data": "Aucune donnée",
  error: "Erreur",
} as const;
const NO_DATA_HINTS: Partial<Record<PrometheusMetricKey, string>> = {
  dbConnectionsUsed:
    "Vérifie aussi que l'exporter de la base est bien collecté par Prometheus (page Status > Targets : la cible doit être UP).",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

interface Props {
  stored: StoredLoadResult | null;
  infra: InfraDraft;
  metrics: MetricsState | null;
  onApply: (metrics: MetricsState) => void;
  onClear: () => void;
}

export function InfrastructureTab({
  stored,
  infra,
  metrics,
  onApply,
  onClear,
}: Props) {
  const [prom, setProm] = useState<PromDraft>(DEFAULT_PROM);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [csv, setCsv] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSetting<unknown>(PROM_KEY, null)
      .then((saved) => {
        if (!cancelled && isPersistedProm(saved))
          setProm((p) => ({ ...p, ...saved }));
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(
      () =>
        void setSetting(PROM_KEY, persistableProm(prom)).catch(() => undefined),
      500,
    );
    return () => clearTimeout(timer);
  }, [prom, loaded]);

  const set = (patch: Partial<PromDraft>) =>
    setProm((p) => ({ ...p, ...patch }));
  const connectionProblems = validateConnection(prom);

  async function test() {
    setChecking(true);
    setFeedback(null);
    try {
      const res = await checkPrometheus(buildConnection(prom));
      setFeedback({
        tone: "success",
        text: `Connexion réussie (${res.latencyMs} ms).`,
      });
    } catch (err) {
      const d = describeError(err);
      setFeedback({
        tone: "error",
        text: `${d.title}. ${d.detail}${d.hint ? ` ${d.hint}` : ""}`,
      });
    } finally {
      setChecking(false);
    }
  }

  async function fetchMetrics() {
    const connectionProblems = validateConnection(prom);

    const reliability = stored
      ? queryWarnings(prom, stored.result.durationSeconds)
      : [];
    if (!stored) return;
    const built = buildQueryInput(prom, infra, stored);
    if (!built.ok) return setFeedback({ tone: "error", text: built.error });
    setQuerying(true);
    setFeedback(null);
    try {
      const res = await queryPrometheus(built.input);
      if (res.infraMetrics.samples.length === 0) {
        setFeedback({
          tone: "error",
          text: "Prometheus n'a renvoyé aucune donnée sur la période de ce test. Vérifie les requêtes, le filtre et le décalage d'horloge.",
        });
        return;
      }
      onApply({
        source: "prometheus",
        forRunId: stored.id,
        infraMetrics: res.infraMetrics,
        statuses: res.metrics,
        warnings: res.warnings,
      });
      setFeedback({
        tone: "success",
        text: `${res.range.samples} mesures récupérées.`,
      });
    } catch (err) {
      const d = describeError(err);
      setFeedback({
        tone: "error",
        text: `${d.title}. ${d.detail}${d.hint ? ` ${d.hint}` : ""}`,
      });
    } finally {
      setQuerying(false);
    }
  }

  const csvResult = csv.trim() === "" ? null : parseInfraCsv(csv);

  if (!stored) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Choisis d&apos;abord un test à analyser : les mesures
        d&apos;infrastructure sont récupérées sur sa période.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {metrics && (
        <section
          aria-labelledby="applied-title"
          className="space-y-4 rounded-xl border border-border bg-card p-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="applied-title" className="text-base font-semibold">
              Mesures utilisées pour l&apos;analyse
            </h2>
            <Badge
              variant="secondary"
              className="font-mono text-[10px] uppercase"
            >
              {metrics.source === "prometheus"
                ? "Mesuré (Prometheus)"
                : "Fourni par toi"}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto gap-1"
              onClick={onClear}
            >
              <Trash2 className="size-4" aria-hidden />
              Retirer
            </Button>
          </div>
          {metrics.statuses.length > 0 && (
            <ul className="space-y-1 text-sm">
              {metrics.statuses.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center gap-2">
                  {s.status === "ok" ? (
                    <Check className="size-4 text-success" aria-hidden />
                  ) : (
                    <X className="size-4 text-destructive-text" aria-hidden />
                  )}
                  <span>{METRIC_META[s.key].label}</span>
                  <span className="text-muted-foreground">
                    {STATUS_LABELS[s.status]}
                    {s.status === "ok" ? ` (${s.points} points)` : ""}
                  </span>
                  {s.message && (
                    <span className="text-xs text-muted-foreground">
                      {s.message}
                    </span>
                  )}
                  {s.status === "no-data" && NO_DATA_HINTS[s.key] && (
                    <span className="text-xs text-muted-foreground">
                      {NO_DATA_HINTS[s.key]}
                    </span>
                  )}
                </li>
              ))}
              {METRIC_ORDER.filter(
                (key) => !metrics.statuses.some((s) => s.key === key),
              ).map((key) => (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-2 text-muted-foreground"
                >
                  <Minus className="size-4" aria-hidden />
                  <span>{METRIC_META[key].label}</span>
                  <span>Non mesurée</span>
                </li>
              ))}
            </ul>
          )}
          {metrics.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-warning">
              {metrics.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <MetricsPreview samples={metrics.infraMetrics.samples} />
        </section>
      )}

      <section
        aria-labelledby="prom-title"
        className="space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <div>
          <h2 id="prom-title" className="text-base font-semibold">
            Connexion à Prometheus
          </h2>
          <p className="text-sm text-muted-foreground">
            L&apos;outil interroge ton Prometheus depuis le serveur, sur la
            période exacte du test. Les identifiants ne sont jamais enregistrés.
            Une instance publique refuse les adresses privées : utilise une
            adresse publique, ou ta propre instance.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Adresse de Prometheus">
            <Input
              value={prom.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              placeholder="https://prometheus.exemple.com"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Field label="Authentification">
            <Select
              value={prom.authType}
              onValueChange={(v) =>
                set({ authType: v as PromDraft["authType"] })
              }
            >
              <SelectTrigger aria-label="Authentification">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune</SelectItem>
                <SelectItem value="basic">
                  Basic (identifiant et mot de passe)
                </SelectItem>
                <SelectItem value="bearer">Bearer (jeton)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {prom.authType === "basic" && (
            <>
              <Field label="Identifiant">
                <Input
                  value={prom.username}
                  onChange={(e) => set({ username: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label="Mot de passe">
                <Input
                  type="password"
                  value={prom.password}
                  onChange={(e) => set({ password: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </>
          )}
          {prom.authType === "bearer" && (
            <Field label="Jeton">
              <Input
                type="password"
                value={prom.token}
                onChange={(e) => set({ token: e.target.value })}
                autoComplete="off"
              />
            </Field>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Mesures du processeur et de la mémoire">
            <Select
              value={prom.compute}
              onValueChange={(v) => set({ compute: v as PromDraft["compute"] })}
            >
              <SelectTrigger aria-label="Source processeur et mémoire">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune</SelectItem>
                <SelectItem value="node_exporter">node_exporter</SelectItem>
                <SelectItem value="cadvisor">cAdvisor</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Mesures de la base de données">
            <Select
              value={prom.database}
              onValueChange={(v) =>
                set({ database: v as PromDraft["database"] })
              }
            >
              <SelectTrigger aria-label="Source base de données">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune</SelectItem>
                <SelectItem value="postgres_exporter">
                  postgres_exporter
                </SelectItem>
                <SelectItem value="mysql_exporter">mysql_exporter</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Filtre : label">
            <Input
              value={prom.matcherLabel}
              onChange={(e) => set({ matcherLabel: e.target.value })}
              placeholder="job"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Field label="Filtre : valeur">
            <Input
              value={prom.matcherValue}
              onChange={(e) => set({ matcherValue: e.target.value })}
              placeholder="api"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        </div>

        <details className="rounded-lg border border-border bg-background/40 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Réglages avancés et requêtes PromQL personnalisées
          </summary>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Fenêtre de calcul des taux">
              <Input
                value={prom.rangeWindow}
                onChange={(e) => set({ rangeWindow: e.target.value })}
                placeholder="1m"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <Field label="Pas des mesures (s)">
              <Input
                type="number"
                min={1}
                max={300}
                value={prom.stepSeconds}
                onChange={(e) =>
                  set({
                    stepSeconds: Number(e.target.value) || SCRAPE_STEP_SECONDS,
                  })
                }
                className="font-mono"
              />
            </Field>
            <Field label="Décalage d'horloge (s)">
              <Input
                type="number"
                min={-3600}
                max={3600}
                value={prom.clockOffsetSeconds}
                onChange={(e) =>
                  set({ clockOffsetSeconds: Number(e.target.value) || 0 })
                }
                className="font-mono"
              />
            </Field>
            <Field label="Label d'instance (facultatif)">
              <Input
                value={prom.instanceLabel}
                onChange={(e) => set({ instanceLabel: e.target.value })}
                placeholder="instance"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          </div>
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Une requête saisie ici remplace celle du préréglage pour cette
              mesure.
            </p>
            {METRIC_ORDER.map((key: PrometheusMetricKey) => (
              <Field
                key={key}
                label={`${METRIC_META[key].label}${METRIC_META[key].unit ? ` (${METRIC_META[key].unit})` : ""}`}
              >
                <Input
                  value={prom.custom[key] ?? ""}
                  onChange={(e) =>
                    set({ custom: { ...prom.custom, [key]: e.target.value } })
                  }
                  placeholder="Requête PromQL"
                  spellCheck={false}
                  className="font-mono"
                />
              </Field>
            ))}
          </div>
        </details>

        {connectionProblems.length > 0 && prom.baseUrl !== "" && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {connectionProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={test}
            disabled={checking || connectionProblems.length > 0}
            className="gap-2"
          >
            {checking ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plug className="size-4" aria-hidden />
            )}
            Tester la connexion
          </Button>
          <Button
            type="button"
            onClick={fetchMetrics}
            disabled={querying || connectionProblems.length > 0}
          >
            {querying && (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            )}
            Récupérer les mesures du test
          </Button>
        </div>
        {feedback && (
          <p
            role={feedback.tone === "error" ? "alert" : "status"}
            className={
              feedback.tone === "error"
                ? "text-sm text-destructive-text"
                : "text-sm text-success"
            }
          >
            {feedback.text}
          </p>
        )}
      </section>

      <section
        aria-labelledby="csv-title"
        className="space-y-3 rounded-xl border border-border bg-card p-5"
      >
        <div>
          <h2 id="csv-title" className="text-base font-semibold">
            Ou colle tes mesures
          </h2>
          <p className="text-sm text-muted-foreground">
            Une ligne par mesure, avec les noms de colonnes en première ligne.{" "}
            <code className="font-mono text-xs">t</code> est le temps en
            secondes depuis le début du test. Colonnes :{" "}
            {METRIC_ORDER.join(", ")}.
          </p>
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-label="Mesures au format CSV"
          placeholder={CSV_EXAMPLE}
          className="w-full rounded-lg border border-input bg-background p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {csvResult && csvResult.errors.length > 0 && (
          <ul
            role="alert"
            className="list-disc space-y-0.5 pl-5 text-sm text-destructive-text"
          >
            {csvResult.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {csvResult && csvResult.errors.length === 0 && (
          <p className="text-sm text-success">
            {csvResult.samples.length} mesures lues.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCsv(CSV_EXAMPLE)}
          >
            Insérer un exemple
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!csvResult || csvResult.errors.length > 0}
            onClick={() => {
              const m = csvResult ? userMetrics(csvResult.samples) : null;
              if (m)
                onApply({
                  source: "csv",
                  forRunId: stored.id,
                  infraMetrics: m,
                  statuses: [],
                  warnings: [],
                });
            }}
          >
            Utiliser ces mesures
          </Button>
        </div>
      </section>
    </div>
  );
}
