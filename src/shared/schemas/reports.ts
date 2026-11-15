import { z } from "zod";
import { REPORT_FORMAT } from "../reports/model";

const Tone = z.enum(["normal", "muted", "success", "warning", "danger"]);
const finite = z.number().refine((n) => Number.isFinite(n), "Nombre fini attendu.");

const CellSchema = z.object({ text: z.string().max(5000), tone: Tone.optional() });

const ChartSchema = z.object({
  title: z.string().max(200),
  unit: z.string().max(20),
  xLabel: z.string().max(50).optional(),
  series: z
    .array(z.object({ label: z.string().max(100), points: z.array(z.object({ x: finite, y: finite })).max(2000) }))
    .max(6),
  limit: z.object({ label: z.string().max(100), y: finite }).optional(),
});

const BlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(20_000), tone: Tone.optional() }),
  z.object({
    type: z.literal("keyvalues"),
    rows: z.array(z.object({ label: z.string().max(200), value: z.string().max(5000), tone: Tone.optional() })).max(200),
  }),
  z.object({
    type: z.literal("table"),
    caption: z.string().max(300).optional(),
    columns: z.array(z.string().max(200)).max(30),
    rows: z.array(z.array(CellSchema).max(30)).max(2000),
  }),
  z.object({ type: z.literal("list"), items: z.array(z.string().max(5000)).max(1000) }),
  z.object({ type: z.literal("code"), title: z.string().max(200).optional(), text: z.string().max(200_000) }),
  z.object({ type: z.literal("chart"), chart: ChartSchema }),
]);

export const ReportDocumentSchema = z.object({
  format: z.literal(REPORT_FORMAT),
  version: z.literal(1),
  kind: z.enum(["functional", "load", "advisor", "capacity", "load-comparison", "functional-comparison"]),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  generatedAt: z.string().min(1).max(40),
  verdict: z.object({ label: z.string().max(200), tone: Tone }).optional(),
  sections: z.array(z.object({ title: z.string().max(200), blocks: z.array(BlockSchema).max(100) })).max(50),
  data: z.unknown().optional(),
});

export const ReportExportInputSchema = z.object({
  format: z.enum(["html", "json"]),
  report: ReportDocumentSchema,
});
export type ReportExportInput = z.output<typeof ReportExportInputSchema>;