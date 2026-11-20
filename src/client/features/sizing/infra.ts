import type { InfraMetrics, InfraSample, InfraSpec } from "@/shared/schemas";

/** L'architecture sur laquelle le test a tourné. */
export interface InfraDraft {
  instances: number;
  vcpuPerInstance: number;
  ramGbPerInstance: number;
  /** Connexions de pool par instance (facultatif). */
  poolSizePerInstance: number | null;
  /** Connexions maximales de la base de données (facultatif). */
  dbMaxConnections: number | null;
}

export const DEFAULT_INFRA: InfraDraft = {
  instances: 2,
  vcpuPerInstance: 2,
  ramGbPerInstance: 4,
  poolSizePerInstance: null,
  dbMaxConnections: null,
};

const isPositiveInt = (n: number) => Number.isInteger(n) && n >= 1;

export function validateInfra(d: InfraDraft): string[] {
  const problems: string[] = [];
  if (!isPositiveInt(d.instances) || d.instances > 10_000) problems.push("Le nombre d'instances doit être un entier entre 1 et 10 000.");
  if (!(d.vcpuPerInstance > 0) || d.vcpuPerInstance > 1024) problems.push("Le nombre de vCPU par instance doit être supérieur à 0 (1 024 au plus).");
  if (!(d.ramGbPerInstance > 0) || d.ramGbPerInstance > 65_536) problems.push("La mémoire par instance doit être supérieure à 0 Go.");
  if (d.poolSizePerInstance !== null && !isPositiveInt(d.poolSizePerInstance)) problems.push("Le pool de connexions par instance doit être un entier d'au moins 1.");
  if (d.dbMaxConnections !== null && !isPositiveInt(d.dbMaxConnections)) problems.push("Le maximum de connexions de la base doit être un entier d'au moins 1.");
  return problems;
}

export function toInfraSpec(d: InfraDraft): InfraSpec {
  return {
    instances: d.instances,
    vcpuPerInstance: d.vcpuPerInstance,
    ramGbPerInstance: d.ramGbPerInstance,
    ...(d.poolSizePerInstance !== null ? { poolSizePerInstance: d.poolSizePerInstance } : {}),
    ...(d.dbMaxConnections !== null ? { dbMaxConnections: d.dbMaxConnections } : {}),
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);

export function isInfraDraft(value: unknown): value is InfraDraft {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return isNum(d.instances) && isNum(d.vcpuPerInstance) && isNum(d.ramGbPerInstance) && isNumOrNull(d.poolSizePerInstance) && isNumOrNull(d.dbMaxConnections);
}

/* ───────── Saisie manuelle de métriques (CSV) ───────── */

const METRIC_COLUMNS = ["cpuPercent", "memoryPercent", "memoryAvailableMb", "dbConnectionsUsed", "networkRttMs"] as const;
type MetricColumn = (typeof METRIC_COLUMNS)[number];
const PERCENT_COLUMNS = new Set<string>(["cpuPercent", "memoryPercent"]);
const MAX_ERRORS_SHOWN = 8;
export const MAX_CSV_SAMPLES = 20_000;

export const CSV_EXAMPLE = "t,cpuPercent,memoryPercent,dbConnectionsUsed\n0,12,41,3\n30,35,44,11\n60,38,47,19";

export interface CsvResult {
  samples: InfraSample[];
  errors: string[];
}

/**
 * Lit des mesures d'infrastructure collées par l'utilisateur. Première ligne : les noms de colonnes.
 * `t` (secondes depuis le début du test) est obligatoire, avec au moins une mesure.
 * Séparateur « , », « ; » ou tabulation ; la virgule décimale n'est acceptée qu'avec « ; » ou la tabulation.
 */
export function parseInfraCsv(text: string): CsvResult {
  const errors: string[] = [];
  const rows = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw, index) => ({ line: index + 1, text: raw.trim() }))
    .filter((r) => r.text !== "" && !r.text.startsWith("#"));

  if (rows.length === 0) return { samples: [], errors: ["Colle des mesures : la première ligne contient les noms de colonnes."] };

  const header = rows[0];
  const delimiter = header.text.includes(";") ? ";" : header.text.includes("\t") ? "\t" : ",";
  const columns = header.text.split(delimiter).map((c) => c.trim());
  const knownColumns = new Set<string>(["t", ...METRIC_COLUMNS]);

  for (const column of columns) {
    if (!knownColumns.has(column)) errors.push(`Colonne inconnue « ${column} ». Colonnes acceptées : t, ${METRIC_COLUMNS.join(", ")}.`);
  }
  if (!columns.includes("t")) errors.push("La colonne « t » (secondes depuis le début du test) est obligatoire.");
  if (!columns.some((c) => (METRIC_COLUMNS as readonly string[]).includes(c))) errors.push("Ajoute au moins une colonne de mesure.");
  if (errors.length > 0) return { samples: [], errors };

  const toNumber = (cell: string) => Number(delimiter === "," ? cell : cell.replace(",", "."));
  const samples: InfraSample[] = [];
  const dataRows = rows.slice(1);

  if (dataRows.length > MAX_CSV_SAMPLES) {
    return { samples: [], errors: [`Trop de lignes : ${MAX_CSV_SAMPLES.toLocaleString("fr-CA")} au maximum.`] };
  }

  for (const row of dataRows) {
    const cells = row.text.split(delimiter).map((c) => c.trim());
    const rowErrors: string[] = [];
    let t: number | null = null;
    const sample: InfraSample = { t: 0 };
    let measures = 0;

    columns.forEach((column, i) => {
      const cell = cells[i] ?? "";
      if (column === "t") {
        const value = toNumber(cell);
        if (cell === "" || !Number.isFinite(value) || value < 0) rowErrors.push("t doit être un nombre positif ou nul");
        else t = value;
        return;
      }
      if (cell === "") return;
      const value = toNumber(cell);
      if (!Number.isFinite(value)) return void rowErrors.push(`${column} n'est pas un nombre`);
      if (PERCENT_COLUMNS.has(column) && (value < 0 || value > 100)) return void rowErrors.push(`${column} doit être entre 0 et 100`);
      if (value < 0) return void rowErrors.push(`${column} ne peut pas être négatif`);
      sample[column as MetricColumn] = value;
      measures++;
    });

    if (rowErrors.length === 0 && measures === 0) rowErrors.push("aucune mesure sur cette ligne");
    if (rowErrors.length > 0 || t === null) {
      errors.push(`Ligne ${row.line} : ${rowErrors.join(", ")}.`);
      continue;
    }
    sample.t = t;
    samples.push(sample);
  }

  if (errors.length === 0 && samples.length === 0) errors.push("Aucune ligne de mesure sous l'en-tête.");
  if (errors.length > MAX_ERRORS_SHOWN) {
    const hidden = errors.length - MAX_ERRORS_SHOWN;
    errors.splice(MAX_ERRORS_SHOWN, hidden, `… et ${hidden} autre${hidden > 1 ? "s" : ""} erreur${hidden > 1 ? "s" : ""}.`);
  }
  samples.sort((a, b) => a.t - b.t);
  return { samples, errors };
}

/** Des mesures saisies par l'utilisateur, au format de l'Advisor. */
export function userMetrics(samples: InfraSample[]): InfraMetrics | null {
  return samples.length > 0 ? { provenance: "user-provided", samples } : null;
}