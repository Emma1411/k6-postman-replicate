"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, TICK, TOOLTIP_STYLE } from "@/client/features/load/components/latency-chart";
import { formatInt } from "@/client/lib/format";
import type { InfraSample } from "@/shared/schemas";
import { METRIC_META, availableMetrics, metricSeries, yDomain } from "../metrics-series";

export function MetricsPreview({ samples }: { samples: InfraSample[] }) {
  const keys = availableMetrics(samples);
  if (keys.length === 0) return <p className="text-sm text-muted-foreground">Aucune mesure à afficher.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {keys.map((key) => {
        const meta = METRIC_META[key];
        return (
          <figure key={key} className="space-y-1 rounded-lg border border-border bg-background/40 p-3">
            <figcaption className="text-sm font-medium">{meta.label}{meta.unit ? ` (${meta.unit})` : ""}</figcaption>
            <div role="img" aria-label={`${meta.label} pendant le test`} style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metricSeries(samples, key)} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${v} s`} tick={TICK} stroke="var(--border)" />
                  <YAxis domain={yDomain(key)} tick={TICK} stroke="var(--border)" width={44} tickFormatter={(v) => formatInt(Number(v))} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => `t = ${v} s`} formatter={(value) => [`${formatInt(Math.round(Number(value) * 10) / 10)}${meta.unit ? ` ${meta.unit}` : ""}`, meta.label]} />
                  <Line dataKey="value" type="monotone" stroke={CHART_COLORS.rps} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>
        );
      })}
    </div>
  );
}