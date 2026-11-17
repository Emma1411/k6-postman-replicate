"use client";

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMs } from "@/client/lib/format";
import type { ChartPoint } from "../series";

export const CHART_COLORS = {
  p50: "#60a5fa",
  p95: "#3b82f6",
  p99: "#2563eb",
  sla: "#f0716b",
  rps: "#38bdf8",
  vus: "#bfdbfe",
  errors: "#f0716b",
} as const;

export const TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
export const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--foreground)",
  fontSize: 12,
} as const;

export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
  thick?: boolean;
  zone?: boolean;
}

/** Légende : le trait (plein, épais, pointillé) distingue les séries sans dépendre de la couleur. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.zone ? (
            <span aria-hidden className="size-3 rounded-sm" style={{ background: item.color, opacity: 0.35 }} />
          ) : (
            <svg aria-hidden width="22" height="6">
              <line
                x1="0"
                y1="3"
                x2="22"
                y2="3"
                stroke={item.color}
                strokeWidth={item.thick ? 3 : 1.5}
                strokeDasharray={item.dashed ? "5 3" : undefined}
              />
            </svg>
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  data: ChartPoint[];
  slaMs?: number;
  saturationFrom?: number | null;
  ariaLabel: string;
  height?: number;
}

export function LatencyChart({ data, slaMs, saturationFrom, ariaLabel, height = 300 }: Props) {
  const last = data.at(-1)?.t ?? 0;
  const legend: LegendItem[] = [
    { label: "p50 (médiane)", color: CHART_COLORS.p50 },
    { label: "p95", color: CHART_COLORS.p95, thick: true },
    { label: "p99", color: CHART_COLORS.p99, dashed: true },
  ];
  if (slaMs !== undefined) legend.push({ label: `Objectif p95 (${formatMs(slaMs)})`, color: CHART_COLORS.sla, dashed: true });
  if (saturationFrom != null) legend.push({ label: "Zone saturée", color: CHART_COLORS.sla, zone: true });

  return (
    <figure className="space-y-3">
      <ChartLegend items={legend} />
      <div role="img" aria-label={ariaLabel} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${v} s`} tick={TICK} stroke="var(--border)" />
            <YAxis tickFormatter={(v) => formatMs(Number(v))} tick={TICK} stroke="var(--border)" width={64} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(v) => `t = ${v} s`}
              formatter={(value, name) => [typeof value === "number" ? formatMs(value) : String(value), String(name)]}
            />
            {saturationFrom != null && <ReferenceArea x1={saturationFrom} x2={last} fill={CHART_COLORS.sla} fillOpacity={0.12} />}
            {slaMs !== undefined && <ReferenceLine y={slaMs} stroke={CHART_COLORS.sla} strokeDasharray="6 4" />}
            <Line dataKey="p50" name="p50" type="monotone" stroke={CHART_COLORS.p50} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="p95" name="p95" type="monotone" stroke={CHART_COLORS.p95} strokeWidth={3} dot={false} isAnimationActive={false} />
            <Line dataKey="p99" name="p99" type="monotone" stroke={CHART_COLORS.p99} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}