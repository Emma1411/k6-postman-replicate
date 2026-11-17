"use client";

import { Check, Code2, Copy } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/client/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { useCopy } from "@/client/lib/use-copy";
import { generateCode, type CodeFormat } from "../export-code";
import type { RequestDraft } from "../model";

const FORMATS: Array<{ value: CodeFormat; label: string }> = [
  { value: "curl", label: "cURL" },
  { value: "fetch", label: "Fetch" },
  { value: "httpie", label: "HTTPie" },
];

function CodeBlock({ code }: { code: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="space-y-2">
      <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed">{code}</pre>
      <Button type="button" variant="secondary" size="sm" onClick={() => copy(code)} className="gap-2">
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? "Copié" : "Copier"}
      </Button>
    </div>
  );
}

export function CodeExportDialog({ draft, variables, disabled }: { draft: RequestDraft; variables: Record<string, string>; disabled: boolean }) {
  const codes = useMemo(
    () => Object.fromEntries(FORMATS.map((f) => [f.value, generateCode(f.value, draft, variables)])) as Record<CodeFormat, string>,
    [draft, variables],
  );
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="gap-2">
          <Code2 className="size-4" aria-hidden />
          Code
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Copier la requête en code</DialogTitle>
          <DialogDescription>
            Les variables de l&apos;environnement sélectionné sont remplacées par leurs valeurs : relis le code avant de le partager, il peut contenir des secrets.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="curl">
          <TabsList>
            {FORMATS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>
            ))}
          </TabsList>
          {FORMATS.map((f) => (
            <TabsContent key={f.value} value={f.value} className="pt-3">
              <CodeBlock code={codes[f.value]} />
            </TabsContent>
          ))}
        </Tabs>
        <p className="text-sm text-muted-foreground">Le cURL est écrit pour un terminal de type bash. PowerShell et cmd utilisent d&apos;autres guillemets.</p>
      </DialogContent>
    </Dialog>
  );
}