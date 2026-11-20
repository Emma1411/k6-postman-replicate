"use client";

import { Input } from "@/client/components/ui/input";

interface Props {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Un champ vide donne null (valeur facultative). Sinon, il revient au minimum. */
  nullable?: boolean;
  hint?: string;
  placeholder?: string;
}

export function NumberField({ label, value, onChange, unit, min = 0, max, step, nullable = false, hint, placeholder }: Props) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === "" ? (nullable ? null : min) : Number(e.target.value))}
          className="w-32 font-mono"
        />
        {unit && <span className="text-muted-foreground">{unit}</span>}
      </span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}