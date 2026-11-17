"use client";

import { useState } from "react";
import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";

interface Props {
  value: string;
  onCommit: (text: string) => void;
  validate?: (text: string) => boolean;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}

/** Utilise `key={value}` côté parent : le champ se réinitialise quand la valeur validée change. */
export function CommitInput({ value, onCommit, validate, ariaLabel, placeholder, className }: Props) {
  const [text, setText] = useState(value);
  const invalid = validate ? !validate(text) : false;
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(text);
      }}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      placeholder={placeholder}
      spellCheck={false}
      className={cn("font-mono", className, invalid && "border-destructive")}
    />
  );
}