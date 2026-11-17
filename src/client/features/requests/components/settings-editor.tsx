"use client";

import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import { formatDuration } from "@/client/lib/format";
import { useAppSelector } from "@/client/store/hooks";

interface Props {
  timeoutMs: number | null;
  followRedirects: boolean;
  onChange: (settings: { timeoutMs: number | null; followRedirects: boolean }) => void;
}

export function SettingsEditor({ timeoutMs, followRedirects, onChange }: Props) {
  const max = useAppSelector((s) => (s.config.status === "ready" ? s.config.value.limits.http.maxTimeoutMs : null));
  return (
    <div className="max-w-xl space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">
          Délai maximal (ms){max ? ` — au plus ${formatDuration(max / 1000)} sur cette instance` : ""}
        </span>
        <Input
          type="number"
          min={100}
          value={timeoutMs ?? ""}
          placeholder="Par défaut de l'instance"
          onChange={(e) => onChange({ timeoutMs: e.target.value === "" ? null : Number(e.target.value), followRedirects })}
          className="w-64 font-mono"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={followRedirects} onCheckedChange={(checked) => onChange({ timeoutMs, followRedirects: checked === true })} />
        Suivre les redirections
      </label>
      <p className="text-sm text-muted-foreground">Les certificats HTTPS sont toujours vérifiés : cette règle ne se désactive pas.</p>
    </div>
  );
}