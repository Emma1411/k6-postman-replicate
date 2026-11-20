"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import { Skeleton } from "@/client/components/ui/skeleton";
import { statusLabel } from "@/client/features/load/verdict";
import type { StoredLoadResult } from "@/client/storage/db";

const DATE = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" });

interface Props {
  results: StoredLoadResult[] | null;
  value: string | null;
  onChange: (id: string) => void;
}

export function RunSelector({ results, value, onChange }: Props) {
  if (results === null) return <Skeleton className="h-10 w-80" />;
  if (results.length === 0) return null;
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Test analysé</span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-80" aria-label="Test analysé">
          <SelectValue placeholder="Choisis un test" />
        </SelectTrigger>
        <SelectContent>
          {results.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name} · {DATE.format(r.savedAt)} · {statusLabel(r.result).label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}