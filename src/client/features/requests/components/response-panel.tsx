"use client";

import { AlertTriangle, Check, Copy, Loader2, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CodeEditor, type CodeLanguage } from "@/client/components/code-editor";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { formatBytes } from "@/client/lib/format";
import { useCopy } from "@/client/lib/use-copy";
import { cn } from "@/client/lib/utils";
import { useAppSelector } from "@/client/store/hooks";
import type { SendRequestResult } from "@/shared/types/send-result";
import type { SendError } from "../editor-slice";
import { TimingBreakdown } from "./timing-breakdown";

const PANEL = "rounded-xl border border-border bg-card";

function statusClasses(status: number): string {
  if (status >= 500) return "border-destructive/50 bg-destructive/10 text-destructive-text";
  if (status >= 400) return "border-warning/40 bg-warning/10 text-warning";
  if (status >= 300) return "border-primary/40 bg-primary/10 text-primary";
  return "border-success/40 bg-success/10 text-success";
}

function EmptyState({ onExample }: { onExample: () => void }) {
  return (
    <div className={cn(PANEL, "flex flex-col items-start gap-3 p-6")}>
      <h2 className="text-base font-semibold">Prêt à envoyer</h2>
      <p className="max-w-xl text-sm text-muted-foreground">
        Colle une adresse dans la barre ci-dessus, puis clique sur Envoyer. Tu verras la réponse, le temps passé à chaque étape du trajet réseau, et le résultat de tes assertions.
      </p>
      <Button type="button" variant="outline" onClick={onExample} className="gap-2">
        <Play className="size-4" aria-hidden />
        Essayer avec un exemple
      </Button>
    </div>
  );
}

function SendingState({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, [startedAt]);
  return (
    <div className={cn(PANEL, "space-y-4 p-6")} aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        <p className="text-sm font-medium">Envoi en cours… {(elapsed / 1000).toFixed(1).replace(".", ",")} s</p>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="ml-auto gap-1">
          <X className="size-4" aria-hidden />
          Annuler
        </Button>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function ErrorState({ error }: { error: SendError }) {
  return (
    <div role="alert" className={cn(PANEL, "space-y-2 border-destructive/50 p-6")}>
      <h2 className="flex items-center gap-2 text-base font-semibold text-destructive-text">
        <AlertTriangle className="size-5" aria-hidden />
        {error.title}
      </h2>
      <p className="text-sm">{error.detail}</p>
      {error.hint && <p className="text-sm text-muted-foreground">{error.hint}</p>}
    </div>
  );
}

/* ───────── Corps de la réponse ───────── */

const contentTypeOf = (headers: Array<{ key: string; value: string }>) =>
  headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";

function detectLanguage(contentType: string, text: string): CodeLanguage {
  if (contentType.includes("json")) return "json";
  if (contentType.includes("xml")) return "xml";
  if (contentType === "" && /^\s*[[{]/.test(text)) return "json";
  return "text";
}

function BodyView({ response }: { response: SendRequestResult }) {
  const { body, sizeBytes, headers } = response;
  const [mode, setMode] = useState<"formatted" | "raw">("formatted");
  const { copied, copy } = useCopy();

  const text = body.encoding === "utf8" ? body.content : "";
  const language = useMemo(() => detectLanguage(contentTypeOf(headers), text), [headers, text]);
  const pretty = useMemo(() => {
    if (language !== "json" || body.truncated) return null;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return null;
    }
  }, [language, text, body.truncated]);

  if (body.encoding === "base64") {
    return <p className="p-4 text-sm text-muted-foreground">Contenu binaire ({formatBytes(sizeBytes)}) : il n&apos;est pas affiché.</p>;
  }
  if (text === "") return <p className="p-4 text-sm text-muted-foreground">La réponse n&apos;a pas de corps.</p>;

  const shown = mode === "formatted" && pretty !== null ? pretty : text;
  return (
    <div className="space-y-2">
      {body.truncated && (
        <p role="status" className="text-sm text-warning">
          Réponse tronquée : la taille maximale de l&apos;instance est atteinte, l&apos;affichage est partiel.
        </p>
      )}
      <div className="flex items-center gap-1 text-sm">
        {pretty !== null && (
          <>
            <Button type="button" variant={mode === "formatted" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("formatted")}>Formaté</Button>
            <Button type="button" variant={mode === "raw" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("raw")}>Brut</Button>
          </>
        )}
        <Button type="button" variant="ghost" size="sm" className="ml-auto gap-1" onClick={() => copy(shown)}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copié" : "Copier"}
        </Button>
      </div>
      <CodeEditor value={shown} language={language} readOnly minHeight="160px" maxHeight="520px" ariaLabel="Corps de la réponse" />
    </div>
  );
}

function HeadersView({ headers }: { headers: Array<{ key: string; value: string }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-border">
          {headers.map((h, i) => (
            <tr key={i}>
              <th scope="row" className="whitespace-nowrap px-3 py-2 font-mono text-xs font-normal text-muted-foreground">{h.key}</th>
              <td className="break-all px-3 py-2 font-mono text-xs">{h.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssertionsView({ assertions }: { assertions: SendRequestResult["assertions"] }) {
  if (assertions.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">Aucune assertion. Ajoute-en dans l&apos;onglet « Assertions » de la requête.</p>;
  }
  return (
    <ul className="space-y-2">
      {assertions.map((a, i) => (
        <li key={i} className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3 text-sm">
          {a.passed ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0 text-destructive-text" aria-hidden />}
          <div className="min-w-0">
            <p>
              {a.label} <span className="sr-only">{a.passed ? "réussie" : "échouée"}</span>
            </p>
            {a.message && <p className="mt-0.5 text-muted-foreground">{a.message}</p>}
          </div>
          <Badge variant="outline" className={cn("ml-auto shrink-0", a.passed ? "text-success" : "text-destructive-text")}>
            {a.passed ? "Réussie" : "Échouée"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function ResponseView({ response }: { response: SendRequestResult }) {
  const { status, statusText, headers, sizeBytes, timings, redirects, finalUrl, assertions } = response;
  const passed = assertions.filter((a) => a.passed).length;
  const encoding = headers.find((h) => h.key.toLowerCase() === "content-encoding")?.value;

  return (
    <div className="space-y-6">
      <div className={cn(PANEL, "space-y-2 p-4")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-md border px-2.5 py-1 font-mono text-sm font-medium", statusClasses(status))}>
            {status} {statusText}
          </span>
          <Badge variant="outline" className="font-mono">{timings.totalMs} ms</Badge>
          <Badge variant="outline" className="font-mono">{formatBytes(sizeBytes)}</Badge>
          {encoding && <Badge variant="outline" className="font-mono">Compression : {encoding}</Badge>}
          <Badge variant="secondary">Mesuré</Badge>
        </div>
        {redirects.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Redirigé {redirects.length} {redirects.length > 1 ? "fois" : "fois"} vers <span className="break-all font-mono text-xs">{finalUrl}</span>
          </p>
        )}
      </div>

      <TimingBreakdown timings={timings} />

      <div className={cn(PANEL, "p-4")}>
        <Tabs defaultValue="body">
          <TabsList>
            <TabsTrigger value="body">Corps</TabsTrigger>
            <TabsTrigger value="headers">En-têtes ({headers.length})</TabsTrigger>
            <TabsTrigger value="assertions">
              Assertions{assertions.length > 0 ? ` (${passed}/${assertions.length})` : ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="body" className="pt-3"><BodyView response={response} /></TabsContent>
          <TabsContent value="headers" className="pt-3"><HeadersView headers={headers} /></TabsContent>
          <TabsContent value="assertions" className="pt-3"><AssertionsView assertions={assertions} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

interface Props {
  onCancel: () => void;
  onExample: () => void;
}

export function ResponsePanel({ onCancel, onExample }: Props) {
  const send = useAppSelector((s) => s.editor.send);
  if (send.status === "idle") return <EmptyState onExample={onExample} />;
  if (send.status === "sending") return <SendingState startedAt={send.startedAt} onCancel={onCancel} />;
  if (send.status === "error") return <ErrorState error={send.error} />;
  return <ResponseView response={send.response} />;
}