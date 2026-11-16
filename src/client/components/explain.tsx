"use client";

import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/client/components/ui/popover";
import { GLOSSARY, type GlossaryEntry, type GlossaryTerm } from "@/client/content/glossary";

export function Explain({ term }: { term: GlossaryTerm }) {
  const entry: GlossaryEntry = GLOSSARY[term];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Qu'est-ce que : ${entry.label} ?`}
          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <p className="font-medium">{entry.label}</p>
        <p className="mt-1 text-muted-foreground">{entry.definition}</p>
        {"example" in entry && entry.example ? (
          <p className="mt-3 rounded-md bg-muted p-2 text-xs">
            <span className="font-medium">Exemple : </span>
            {entry.example}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}