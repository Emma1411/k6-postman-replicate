export const REPORT_FORMAT = "api-engineering-platform/report" as const;

export type Tone = "normal" | "muted" | "success" | "warning" | "danger";

export type ReportKind =
  | "functional"
  | "load"
  | "advisor"
  | "capacity"
  | "load-comparison"
  | "functional-comparison";

export interface Cell {
  text: string;
  tone?: Tone;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSpec {
  title: string;
  unit: string;
  xLabel?: string;
  series: Array<{ label: string; points: ChartPoint[] }>;
  /** Ligne horizontale de référence (objectif). */
  limit?: { label: string; y: number };
}

export type Block =
  | { type: "text"; text: string; tone?: Tone }
  | { type: "keyvalues"; rows: Array<{ label: string; value: string; tone?: Tone }> }
  | { type: "table"; caption?: string; columns: string[]; rows: Cell[][] }
  | { type: "list"; items: string[] }
  | { type: "code"; title?: string; text: string }
  | { type: "chart"; chart: ChartSpec };

export interface Section {
  title: string;
  blocks: Block[];
}

export interface ReportDocument {
  format: typeof REPORT_FORMAT;
  version: 1;
  kind: ReportKind;
  title: string;
  subtitle?: string;
  /** Date de génération, au format ISO 8601. */
  generatedAt: string;
  verdict?: { label: string; tone: Tone };
  sections: Section[];
  /** Les données d'origine (expurgées si demandé), pour un traitement automatique. */
  data: unknown;
}

export interface ReportMeta {
  /** Date de génération : passée en paramètre pour que les constructeurs restent purs. */
  now: Date;
  title?: string;
  environment?: string;
}

export interface ReportOptions {
  /** Masque les secrets probables (par défaut : oui). */
  redactSecrets: boolean;
  /** Inclut des extraits des corps de réponse (par défaut : non). */
  includeResponsePreviews: boolean;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = { redactSecrets: true, includeResponsePreviews: false };

export const cell = (text: string, tone?: Tone): Cell => (tone ? { text, tone } : { text });

export const kv = (label: string, value: string, tone?: Tone) => (tone ? { label, value, tone } : { label, value });

/** « 2026-11-14 10:30 UTC » */
export const formatDateTime = (date: Date): string => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);