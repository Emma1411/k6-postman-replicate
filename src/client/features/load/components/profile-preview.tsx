"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatInt } from "@/client/lib/format";
import { previewPoints, type ProfileDraft } from "../profile";
import { CHART_COLORS, TICK, TOOLTIP_STYLE } from "./latency-chart";

export function ProfilePreview({ profile }: { profile: ProfileDraft }) {
  const data = previewPoints(profile);
  const unit = profile.kind === "arrival-rate" ? "req/s" : "utilisateurs";
  return (
    <div role="img" aria-label={`Prévisualisation de la charge en ${unit} au fil du temps`} style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${v} s`} tick={TICK} stroke="var(--border)" />
          <YAxis tick={TICK} stroke="var(--border)" width={44} tickFormatter={(v) => formatInt(Number(v))} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => `t = ${v} s`} formatter={(value) => [`${formatInt(Number(value))} ${unit}`, "Charge"]} />
          <Area dataKey="value" type="linear" stroke={CHART_COLORS.rps} fill={CHART_COLORS.rps} fillOpacity={0.15} strokeWidth={2.5} dot isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}