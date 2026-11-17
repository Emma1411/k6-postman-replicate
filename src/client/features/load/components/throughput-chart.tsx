"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatInt } from "@/client/lib/format";
import type { ChartPoint } from "../series";
import { CHART_COLORS, ChartLegend, TICK, TOOLTIP_STYLE } from "./latency-chart";

interface Props {
  data: ChartPoint[];
  saturationFrom?: number | null;
  ariaLabel: string;
}

export function ThroughputChart({ data, saturationFrom, ariaLabel }: Props) {
  const last = data.at(-1)?.t ?? 0;
  const hasErrors = data.some((p) => p.errors > 0);
  return (
    <figure className="space-y-3">
      <ChartLegend
        items={[
          { label: "Débit (req/s)", color: CHART_COLORS.rps, thick: true },
          { label: "Utilisateurs virtuels", color: CHART_COLORS.vus, dashed: true },
        ]}
      />
      <div role="img" aria-label={ariaLabel} style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${v} s`} tick={TICK} stroke="var(--border)" />
            <YAxis yAxisId="rps" tick={TICK} stroke="var(--border)" width={48} tickFormatter={(v) => formatInt(Number(v))} />
            <YAxis yAxisId="vus" orientation="right" tick={TICK} stroke="var(--border)" width={40} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(v) => `t = ${v} s`}
              formatter={(value, name) => [typeof value === "number" ? formatInt(Math.round(value * 10) / 10) : String(value), String(name)]}
            />
            {saturationFrom != null && <ReferenceArea yAxisId="rps" x1={saturationFrom} x2={last} fill={CHART_COLORS.sla} fillOpacity={0.12} />}
            <Line yAxisId="rps" dataKey="rps" name="Débit (req/s)" type="monotone" stroke={CHART_COLORS.rps} strokeWidth={3} dot={false} isAnimationActive={false} />
            <Line yAxisId="vus" dataKey="vus" name="Utilisateurs virtuels" type="stepAfter" stroke={CHART_COLORS.vus} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {hasErrors && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Erreurs par seconde</p>
          <div role="img" aria-label="Erreurs par seconde pendant le test" style={{ height: 90 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} hide />
                <YAxis tick={TICK} stroke="var(--border)" width={48} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => `t = ${v} s`} formatter={(value) => [String(value), "Erreurs"]} />
                <Bar dataKey="errors" fill={CHART_COLORS.errors} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </figure>
  );
}