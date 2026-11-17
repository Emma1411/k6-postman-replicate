"use client";

import { BookOpen } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/client/components/ui/sheet";
import { GLOSSARY, type GlossaryEntry } from "@/client/content/glossary";

const ENTRIES = (Object.entries(GLOSSARY) as Array<[string, GlossaryEntry]>).sort((a, b) =>
  a[1].label.localeCompare(b[1].label, "fr"),
);

export function GlossarySheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <BookOpen className="size-4" aria-hidden />
          <span className="hidden sm:inline">Glossaire</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Glossaire</SheetTitle>
          <SheetDescription>Les mots utilisés dans l&apos;application, avec un exemple quand il aide.</SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {ENTRIES.map(([key, entry]) => (
            <details key={key} className="group rounded-lg border border-border bg-card px-3 py-2">
              <summary className="cursor-pointer list-none text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {entry.label}
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{entry.definition}</p>
              {"example" in entry && entry.example ? (
                <p className="mt-2 rounded-md bg-muted p-2 text-xs">
                  <span className="font-medium">Exemple : </span>
                  {entry.example}
                </p>
              ) : null}
            </details>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}