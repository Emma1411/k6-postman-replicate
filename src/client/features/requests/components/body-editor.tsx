"use client";

import { CodeEditor } from "@/client/components/code-editor";
import { Input } from "@/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import type { BodyDraft, BodyKind } from "../model";
import { KeyValueTable } from "./key-value-table";

const KINDS: Array<{ value: BodyKind; label: string }> = [
  { value: "none", label: "Aucun" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
  { value: "raw", label: "Texte brut" },
  { value: "urlencoded", label: "Formulaire (urlencoded)" },
  { value: "form-data", label: "Formulaire (multipart, champs texte)" },
];

/** Un JSON invalide est signalé, sauf s'il contient des {{variables}} (remplacées à l'envoi). */
function jsonWarning(body: BodyDraft): string | null {
  if (body.kind !== "json" || body.content.trim() === "" || body.content.includes("{{")) return null;
  try {
    JSON.parse(body.content);
    return null;
  } catch {
    return "Ce JSON n'est pas valide : il sera envoyé tel quel.";
  }
}

interface Props {
  body: BodyDraft;
  onChange: (body: BodyDraft) => void;
}

export function BodyEditor({ body, onChange }: Props) {
  const warning = jsonWarning(body);
  return (
    <div className="space-y-3">
      <Select value={body.kind} onValueChange={(kind) => onChange({ ...body, kind: kind as BodyKind })}>
        <SelectTrigger className="w-72" aria-label="Type de corps">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((k) => (
            <SelectItem key={k.value} value={k.value}>
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {body.kind === "none" && <p className="text-sm text-muted-foreground">Cette requête n&apos;a pas de corps.</p>}

      {(body.kind === "json" || body.kind === "xml" || body.kind === "raw") && (
        <div className="space-y-2">
          {body.kind === "raw" && (
            <Input
              value={body.contentType}
              onChange={(e) => onChange({ ...body, contentType: e.target.value })}
              aria-label="Type de contenu"
              placeholder="text/plain"
              spellCheck={false}
              className="w-72 font-mono"
            />
          )}
          <CodeEditor
            value={body.content}
            onChange={(content) => onChange({ ...body, content })}
            language={body.kind === "json" ? "json" : body.kind === "xml" ? "xml" : "text"}
            ariaLabel="Corps de la requête"
            minHeight="180px"
          />
          {warning && (
            <p role="status" className="text-sm text-warning">
              {warning}
            </p>
          )}
        </div>
      )}

      {(body.kind === "urlencoded" || body.kind === "form-data") && (
        <KeyValueTable
          rows={body.fields}
          onChange={(fields) => onChange({ ...body, fields })}
          addLabel="Ajouter un champ"
          emptyText="Aucun champ."
        />
      )}
    </div>
  );
}