import type { PrometheusMetricKey } from "@/shared/schemas";

export interface LabelMatcher {
  label: string;
  op: "=" | "!=" | "=~" | "!~";
  value: string;
}

export type ComputeSource = "node_exporter" | "cadvisor";
export type DatabaseSource = "postgres_exporter" | "mysql_exporter";

export interface PromQlPresetInput {
  compute?: {
    source: ComputeSource;
    matchers?: LabelMatcher[];
    /** cAdvisor : label qui identifie un conteneur (« name » avec Docker, « pod » avec Kubernetes). */
    instanceLabel?: string;
    vcpuPerInstance: number;
    ramGbPerInstance: number;
  };
  database?: { source: DatabaseSource; matchers?: LabelMatcher[] };
  /** Fenêtre de rate(), par exemple « 1m » : au moins 4 intervalles de collecte. */
  rangeWindow?: string;
}

export type PromQlPresets = Partial<Record<PrometheusMetricKey, string>>;

const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPERATORS = new Set(["=", "!=", "=~", "!~"]);
const RANGE_WINDOW = /^\d{1,4}[smh]$/;

const escapeValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

function matcherToString(m: LabelMatcher): string {
  if (!LABEL_NAME.test(m.label)) throw new Error(`Nom de label invalide : « ${m.label} ».`);
  if (!OPERATORS.has(m.op)) throw new Error(`Opérateur invalide : « ${m.op} ».`);
  return `${m.label}${m.op}"${escapeValue(m.value)}"`;
}

function selector(metric: string, matchers: LabelMatcher[], fixed: string[] = []): string {
  const parts = [...fixed, ...matchers.map(matcherToString)];
  return parts.length === 0 ? metric : `${metric}{${parts.join(",")}}`;
}

/**
 * Requêtes de départ à vérifier dans l'interface de Prometheus avant usage : les noms de métriques dépendent
 * de la version de l'exporter et de ta configuration. Chaque requête renvoie une seule série agrégée.
 */
export function buildPromQlPresets(input: PromQlPresetInput): PromQlPresets {
  const window = input.rangeWindow ?? "1m";
  if (!RANGE_WINDOW.test(window)) throw new Error(`Fenêtre invalide : « ${window} » (exemple : 1m).`);
  const presets: PromQlPresets = {};

  const compute = input.compute;
  if (compute) {
    const m = compute.matchers ?? [];
    if (compute.source === "node_exporter") {
      // CPU et mémoire moyens sur les machines sélectionnées.
      presets.cpuPercent = `100 * (1 - avg(rate(${selector("node_cpu_seconds_total", m, ['mode="idle"'])}[${window}])))`;
      presets.memoryPercent = `100 * (1 - sum(${selector("node_memory_MemAvailable_bytes", m)}) / sum(${selector("node_memory_MemTotal_bytes", m)}))`;
      presets.memoryAvailableMb = `avg(${selector("node_memory_MemAvailable_bytes", m)}) / 1048576`;
    } else {
      const label = compute.instanceLabel ?? "name";
      if (!LABEL_NAME.test(label)) throw new Error(`Nom de label invalide : « ${label} ».`);
      if (!(compute.vcpuPerInstance > 0) || !(compute.ramGbPerInstance > 0)) {
        throw new Error("Les vCPU et la RAM par instance doivent être positifs.");
      }
      const ramBytes = Math.round(compute.ramGbPerInstance * 1024 ** 3);
      // CPU consommé par conteneur, rapporté au nombre de vCPU de l'instance ; mémoire rapportée à la RAM de l'instance.
      presets.cpuPercent = `100 * avg(sum by (${label}) (rate(${selector("container_cpu_usage_seconds_total", m)}[${window}]))) / ${compute.vcpuPerInstance}`;
      presets.memoryPercent = `100 * avg(${selector("container_memory_working_set_bytes", m)}) / ${ramBytes}`;
      presets.memoryAvailableMb = `(${ramBytes} - avg(${selector("container_memory_working_set_bytes", m)})) / 1048576`;
    }
  }

  const database = input.database;
  if (database) {
    const m = database.matchers ?? [];
    presets.dbConnectionsUsed =
      database.source === "postgres_exporter"
        ? `sum(${selector("pg_stat_database_numbackends", m)})`
        : `sum(${selector("mysql_global_status_threads_connected", m)})`;
  }

  return presets;
}