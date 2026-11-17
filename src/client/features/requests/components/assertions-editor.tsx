"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { CommitInput } from "@/client/components/commit-input";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import type { Assertion } from "@/shared/schemas";
import { formatPrimitive, formatStatus, parsePrimitive, parseStatusList, type Primitive } from "../assertion-values";

type Operator = [value: string, label: string];

const NUMBER_OPS: Operator[] = [["lt", "est inférieur à"], ["lte", "est inférieur ou égal à"], ["gt", "est supérieur à"], ["gte", "est supérieur ou égal à"]];
const HEADER_OPS: Operator[] = [["exists", "existe"], ["notExists", "n'existe pas"], ["equals", "est égal à"], ["contains", "contient"], ["matches", "correspond à (regex)"]];
const JSON_OPS: Operator[] = [
  ["exists", "existe"], ["notExists", "n'existe pas"], ["equals", "est égal à"], ["notEquals", "est différent de"],
  ["contains", "contient"], ["matches", "correspond à (regex)"], ["gt", "est supérieur à"], ["gte", "est supérieur ou égal à"],
  ["lt", "est inférieur à"], ["lte", "est inférieur ou égal à"], ["type", "est de type"],
];
const JSON_TYPES = ["string", "number", "boolean", "object", "array", "null"];

const TYPE_LABELS: Record<string, string> = {
  status: "Le statut HTTP",
  responseTime: "Le temps de réponse",
  header: "Un en-tête",
  jsonPath: "Une valeur JSON",
  bodyContains: "Le corps contient",
};

const noValue = (op: string) => op === "exists" || op === "notExists";

function OperatorSelect({ value, options, onChange, label }: { value: string; options: Operator[]; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-52" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Row({ title, children, onRemove }: { title: string; children: ReactNode; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 p-2">
      <span className="min-w-36 px-1 text-sm font-medium">{title}</span>
      {children}
      <Button type="button" variant="ghost" size="icon" className="ml-auto" onClick={onRemove} aria-label={`Supprimer l'assertion : ${title}`}>
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function AssertionRow({ assertion: a, onChange, onRemove }: { assertion: Assertion; onChange: (a: Assertion) => void; onRemove: () => void }) {
  switch (a.type) {
    case "status": {
      const text = formatStatus(a.expected);
      return (
        <Row title={TYPE_LABELS.status} onRemove={onRemove}>
          <span className="text-sm text-muted-foreground">est</span>
          <CommitInput
            key={text}
            value={text}
            onCommit={(t) => {
              const parsed = parseStatusList(t);
              if (parsed !== null) onChange({ ...a, expected: parsed });
            }}
            validate={(t) => parseStatusList(t) !== null}
            ariaLabel="Codes de statut attendus"
            placeholder="200 ou 200, 201"
            className="w-44"
          />
        </Row>
      );
    }
    case "responseTime":
      return (
        <Row title={TYPE_LABELS.responseTime} onRemove={onRemove}>
          <OperatorSelect value={a.operator} options={NUMBER_OPS} label="Comparaison" onChange={(v) => onChange({ ...a, operator: v as typeof a.operator })} />
          <Input
            type="number"
            min={1}
            value={a.valueMs}
            onChange={(e) => onChange({ ...a, valueMs: Number(e.target.value) })}
            aria-label="Temps en millisecondes"
            className="w-28 font-mono"
          />
          <span className="text-sm text-muted-foreground">ms</span>
        </Row>
      );
    case "header":
      return (
        <Row title={TYPE_LABELS.header} onRemove={onRemove}>
          <Input value={a.headerName} onChange={(e) => onChange({ ...a, headerName: e.target.value })} aria-label="Nom de l'en-tête" placeholder="Content-Type" spellCheck={false} className="w-44 font-mono" />
          <OperatorSelect
            value={a.operator}
            options={HEADER_OPS}
            label="Comparaison"
            onChange={(v) => onChange({ ...a, operator: v as typeof a.operator, value: noValue(v) ? undefined : (a.value ?? "") })}
          />
          {!noValue(a.operator) && (
            <Input value={a.value ?? ""} onChange={(e) => onChange({ ...a, value: e.target.value })} aria-label="Valeur attendue" spellCheck={false} className="w-44 font-mono" />
          )}
        </Row>
      );
    case "jsonPath": {
      const text = formatPrimitive(a.value);
      return (
        <Row title={TYPE_LABELS.jsonPath} onRemove={onRemove}>
          <Input value={a.path} onChange={(e) => onChange({ ...a, path: e.target.value })} aria-label="Chemin JSONPath" placeholder="$.data.id" spellCheck={false} className="w-44 font-mono" />
          <OperatorSelect
            value={a.operator}
            options={JSON_OPS}
            label="Comparaison"
            onChange={(v) =>
              onChange({ ...a, operator: v as typeof a.operator, value: noValue(v) ? undefined : v === "type" ? "string" : (a.value ?? "") })
            }
          />
          {a.operator === "type" ? (
            <Select value={String(a.value ?? "string")} onValueChange={(v) => onChange({ ...a, value: v })}>
              <SelectTrigger className="w-36" aria-label="Type attendu">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JSON_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            !noValue(a.operator) && (
              <CommitInput
                key={text}
                value={text}
                onCommit={(t) => onChange({ ...a, value: parsePrimitive(t) as Primitive })}
                ariaLabel="Valeur attendue"
                placeholder='482, true, "texte"'
                className="w-44"
              />
            )
          )}
        </Row>
      );
    }
    case "bodyContains":
      return (
        <Row title={TYPE_LABELS.bodyContains} onRemove={onRemove}>
          <Input value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value })} aria-label="Texte recherché" spellCheck={false} className="w-72 font-mono" />
        </Row>
      );
    default:
      return (
        <Row title="Schéma JSON (importé)" onRemove={onRemove}>
          <span className="text-sm text-muted-foreground">Cette assertion vient d&apos;un import ; elle s&apos;exécute mais ne se modifie pas ici.</span>
        </Row>
      );
  }
}

const NEW_ASSERTIONS: Array<{ label: string; create: () => Assertion }> = [
  { label: "Le statut HTTP", create: () => ({ type: "status", expected: 200 }) },
  { label: "Le temps de réponse", create: () => ({ type: "responseTime", operator: "lt", valueMs: 500 }) },
  { label: "Un en-tête", create: () => ({ type: "header", headerName: "Content-Type", operator: "contains", value: "json" }) },
  { label: "Une valeur JSON", create: () => ({ type: "jsonPath", path: "$.id", operator: "exists" }) },
  { label: "Le corps contient", create: () => ({ type: "bodyContains", value: "" }) },
];

interface Props {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
}

export function AssertionsEditor({ assertions, onChange }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Une assertion est une vérification faite sur la réponse. Le résultat s&apos;affiche dans l&apos;onglet « Assertions » de la réponse.
      </p>
      {assertions.map((assertion, i) => (
        <AssertionRow
          key={i}
          assertion={assertion}
          onChange={(next) => onChange(assertions.map((a, j) => (j === i ? next : a)))}
          onRemove={() => onChange(assertions.filter((_, j) => j !== i))}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        {NEW_ASSERTIONS.map((n) => (
          <Button key={n.label} type="button" variant="outline" size="sm" onClick={() => onChange([...assertions, n.create()])}>
            <Plus className="size-4" aria-hidden />
            {n.label}
          </Button>
        ))}
      </div>
    </div>
  );
}