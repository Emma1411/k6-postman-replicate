"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import type { KeyValue } from "@/shared/schemas";

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyLabel?: string;
  valueLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  emptyText?: string;
}

export function KeyValueTable({
  rows,
  onChange,
  keyLabel = "Clé",
  valueLabel = "Valeur",
  keyPlaceholder = "nom",
  valuePlaceholder = "valeur ou {{variable}}",
  addLabel = "Ajouter une ligne",
  emptyText = "Aucune ligne pour l'instant.",
}: Props) {
  const update = (index: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 px-1 text-xs text-muted-foreground" aria-hidden>
            <span className="w-4" />
            <span>{keyLabel}</span>
            <span>{valueLabel}</span>
            <span className="w-8" />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
              <Checkbox
                checked={row.enabled}
                onCheckedChange={(checked) => update(i, { enabled: checked === true })}
                aria-label={`Activer la ligne ${i + 1}`}
              />
              <Input
                value={row.key}
                onChange={(e) => update(i, { key: e.target.value })}
                placeholder={keyPlaceholder}
                aria-label={`${keyLabel}, ligne ${i + 1}`}
                spellCheck={false}
                className="font-mono"
              />
              <Input
                value={row.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder={valuePlaceholder}
                aria-label={`${valueLabel}, ligne ${i + 1}`}
                spellCheck={false}
                className="font-mono"
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label={`Supprimer la ligne ${i + 1}`}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { key: "", value: "", enabled: true }])}>
        <Plus className="size-4" aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
}