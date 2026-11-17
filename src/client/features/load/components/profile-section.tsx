"use client";

import { Info } from "lucide-react";
import { Explain } from "@/client/components/explain";
import { ProvenanceBadge } from "@/client/components/provenance-badge";
import { Input } from "@/client/components/ui/input";
import { Slider } from "@/client/components/ui/slider";
import { formatInt, formatDuration } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import { estimateRps, totalDurationSeconds, type ProfileDraft, type ProfileKind } from "../profile";
import { ProfilePreview } from "./profile-preview";

const KINDS: Array<{ kind: ProfileKind; title: string; text: string; path: string; dashed?: boolean }> = [
  { kind: "ramp", title: "Montée progressive", text: "De 0 à N utilisateurs, un palier, puis la descente.", path: "M2 28 L28 8 L62 8 L88 28" },
  { kind: "constant", title: "Palier constant", text: "Une charge fixe et continue.", path: "M2 10 L88 10" },
  { kind: "spike", title: "Pic brutal", text: "Montée quasi instantanée, puis retour au calme.", path: "M2 26 L32 26 L36 6 L56 6 L60 26 L88 26" },
  { kind: "arrival-rate", title: "À cadence fixe", text: "Un débit imposé en requêtes par seconde.", path: "M2 18 L88 18", dashed: true },
];

function NumberField({
  label,
  value,
  onChange,
  unit,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit: string;
  min?: number;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <Input
          type="number"
          min={min}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? min : Number(e.target.value))}
          className="w-28 font-mono"
        />
        <span className="text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
}

interface Props {
  profile: ProfileDraft;
  onChange: (profile: ProfileDraft) => void;
  maxVus: number;
  maxRps: number;
  maxDurationSeconds: number;
  /** Temps de réponse mesuré par « Tester la cible », en ms. */
  checkMs: number | null;
}

export function ProfileSection({ profile, onChange, maxVus, maxRps, maxDurationSeconds, checkMs }: Props) {
  const set = (patch: Partial<ProfileDraft>) => onChange({ ...profile, ...patch });
  const isRate = profile.kind === "arrival-rate";
  const vuMax = Math.max(1, maxVus);
  const total = totalDurationSeconds(profile);

  return (
    <section aria-labelledby="profile-title" className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">2</span>
        <h2 id="profile-title" className="text-lg font-semibold">Profil de charge</h2>
        <Explain term="ramp" />
      </div>
      <p className="text-sm text-muted-foreground">Choisis comment les utilisateurs virtuels arrivent, restent, puis partent.</p>

      <fieldset>
        <legend className="sr-only">Type de charge</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {KINDS.map((k) => (
            <label
              key={k.kind}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-background/40 p-3 transition-colors hover:bg-accent/40",
                "has-[input:checked]:border-primary has-[input:checked]:bg-primary/5 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring",
              )}
            >
              <input type="radio" name="profile-kind" className="sr-only" checked={profile.kind === k.kind} onChange={() => set({ kind: k.kind })} />
              <svg aria-hidden viewBox="0 0 90 34" className="h-8 w-full">
                <path d={k.path} fill="none" stroke="var(--ring)" strokeWidth="2" strokeDasharray={k.dashed ? "4 3" : undefined} />
              </svg>
              <span className="text-sm font-medium">{k.title}</span>
              <span className="text-xs text-muted-foreground">{k.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          {isRate ? (
            <>
              <div className="space-y-2">
                <label htmlFor="rate" className="flex items-center gap-1 text-sm font-medium">
                  Débit imposé <Explain term="rps" />
                </label>
                <div className="flex items-center gap-3">
                  <Slider id="rate" min={1} max={Math.max(1, maxRps)} step={1} value={[Math.min(profile.rate, maxRps)]} onValueChange={(v) => set({ rate: v[0] ?? 1 })} className="flex-1" />
                  <span className="w-24 text-right font-mono text-sm tabular-nums">{formatInt(profile.rate)} req/s</span>
                </div>
                <p className="text-xs text-muted-foreground">Maximum de cette instance : {formatInt(maxRps)} req/s.</p>
              </div>
              <NumberField label="Utilisateurs virtuels disponibles (maximum)" value={profile.vus} onChange={(vus) => set({ vus })} unit="VU" min={1} />
            </>
          ) : (
            <div className="space-y-2">
              <label htmlFor="vus" className="flex items-center gap-1 text-sm font-medium">
                Utilisateurs virtuels {profile.kind === "ramp" ? "au palier" : ""} <Explain term="vu" />
              </label>
              <div className="flex items-center gap-3">
                <Slider id="vus" min={1} max={vuMax} step={1} value={[Math.min(profile.vus, vuMax)]} onValueChange={(v) => set({ vus: v[0] ?? 1 })} className="flex-1" />
                <span className="w-20 text-right font-mono text-sm tabular-nums">{formatInt(profile.vus)} VU</span>
              </div>
              <p className="text-xs text-muted-foreground">Maximum de cette instance : {formatInt(maxVus)} utilisateurs.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {profile.kind === "ramp" && <NumberField label="Montée" value={profile.rampUpSeconds} onChange={(n) => set({ rampUpSeconds: n })} unit="s" />}
            <NumberField label={profile.kind === "spike" ? "Durée du pic" : "Palier"} value={profile.plateauSeconds} onChange={(n) => set({ plateauSeconds: n })} unit="s" min={1} />
            {profile.kind === "ramp" && <NumberField label="Descente" value={profile.rampDownSeconds} onChange={(n) => set({ rampDownSeconds: n })} unit="s" />}
          </div>

          <NumberField label="Délai de réflexion entre deux requêtes" value={profile.thinkTimeMs} onChange={(n) => set({ thinkTimeMs: n })} unit="ms" />

          <p className={cn("text-sm", total > maxDurationSeconds ? "text-destructive-text" : "text-muted-foreground")}>
            Durée totale : <strong className="tabular-nums">{formatDuration(total)}</strong> (maximum {formatDuration(maxDurationSeconds)}).
          </p>
        </div>

        <div className="space-y-4">
          <ProfilePreview profile={profile} />
          <LittleCard profile={profile} checkMs={checkMs} />
        </div>
      </div>
    </section>
  );
}

function LittleCard({ profile, checkMs }: { profile: ProfileDraft; checkMs: number | null }) {
  const isRate = profile.kind === "arrival-rate";
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-medium">
          <Info className="size-4 text-primary" aria-hidden />
          Loi de Little
        </h3>
        <ProvenanceBadge kind="estimated" />
      </div>
      <p className="font-mono text-xs text-muted-foreground">débit ≈ utilisateurs ÷ (temps de réponse + délai de réflexion)</p>
      {checkMs === null ? (
        <p className="text-muted-foreground">Clique sur « Tester la cible » pour obtenir une estimation chiffrée du débit.</p>
      ) : isRate ? (
        <p>
          Pour tenir <strong>{formatInt(profile.rate)} req/s</strong> avec un temps de réponse de {checkMs} ms et {profile.thinkTimeMs} ms de réflexion, il faut
          environ <strong>{formatInt(Math.ceil((profile.rate * (checkMs + profile.thinkTimeMs)) / 1000))} utilisateurs</strong> simultanés.
        </p>
      ) : (
        <p>
          {formatInt(profile.vus)} utilisateurs ÷ ({checkMs} ms + {profile.thinkTimeMs} ms) ≈{" "}
          <strong>{formatInt(Math.round(estimateRps(profile.vus, checkMs, profile.thinkTimeMs)))} req/s</strong>.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Le débit réel dépendra de la capacité de ton API à garder son temps de réponse sous forte charge. Si elle sature, le débit sera plus bas.
      </p>
    </div>
  );
}