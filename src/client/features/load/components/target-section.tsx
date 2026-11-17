"use client";

import { AlertTriangle, Check, KeyRound, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/client/api/client";
import { describeError } from "@/client/api/errors";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { draftToSendInput, type RequestDraft } from "@/client/features/requests/model";
import { cn } from "@/client/lib/utils";
import type { SendRequestResult } from "@/shared/types/send-result";

export interface TargetCheck {
  status: number;
  ms: number;
  at: number;
}

interface Props {
  draft: RequestDraft | null | undefined;
  variables: Record<string, string>;
  check: TargetCheck | null;
  onCheck: (check: TargetCheck | null) => void;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function TargetSection({ draft, variables, check, onCheck }: Props) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  async function testTarget() {
    if (!draft) return;
    setChecking(true);
    setError(null);
    try {
      // Une seule requête, sans assertions : elle sert à mesurer le temps de réponse.
      const res = await apiFetch<SendRequestResult>("/api/requests/execute", {
        body: draftToSendInput({ ...draft, assertions: [] }, variables),
      });
      onCheck({ status: res.status, ms: res.timings.totalMs, at: Date.now() });
    } catch (err) {
      const d = describeError(err);
      setError({ title: d.title, detail: d.detail });
      onCheck(null);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section aria-labelledby="target-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">1</span>
        <h2 id="target-title" className="text-lg font-semibold">
          Cible du test
        </h2>
        <Badge variant="secondary">Requête unique</Badge>
        {draft && (
          <Button asChild variant="ghost" size="sm" className="ml-auto">
            <Link href="/requests">Changer</Link>
          </Button>
        )}
      </div>

      {draft === undefined ? null : draft === null ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Aucune requête à tester. Prépare-la dans la page Requêtes, puis clique sur « Tester sous charge ».
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/requests">Ouvrir les requêtes</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 p-3">
            <Badge variant="outline" className="font-mono">{draft.method}</Badge>
            <span className="min-w-0 flex-1 break-all font-mono text-sm">{draft.url}</span>
            {draft.auth.type !== "none" && (
              <Badge variant="secondary" className="gap-1">
                <KeyRound className="size-3" aria-hidden />
                Authentification
              </Badge>
            )}
            <Badge variant="secondary">{draft.assertions.length} assertion{draft.assertions.length > 1 ? "s" : ""}</Badge>
          </div>

          {!SAFE_METHODS.has(draft.method) && (
            <p role="note" className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                Cette requête ({draft.method}) peut modifier des données. Le test l&apos;enverra des milliers de fois : vise un
                environnement de test.
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={testTarget} disabled={checking} className="gap-2">
              {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
              Tester la cible
            </Button>
            {check && (
              <span role="status" className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-success" aria-hidden />
                <span className={cn("font-mono", check.status >= 400 && "text-destructive-text")}>{check.status}</span>
                <span className="font-mono text-muted-foreground">{check.ms} ms</span>
                <Badge variant="secondary" className="font-mono text-[10px] uppercase">Mesuré</Badge>
              </span>
            )}
            {!check && !error && !checking && (
              <span className="text-xs text-muted-foreground">Envoie la requête une fois pour vérifier l&apos;adresse et estimer le débit.</span>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              <strong>{error.title}.</strong> {error.detail}
            </p>
          )}
        </>
      )}
    </section>
  );
}