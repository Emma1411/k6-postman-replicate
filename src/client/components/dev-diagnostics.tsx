"use client";

import { useState } from "react";
import { apiFetch } from "@/client/api/client";
import { describeError } from "@/client/api/errors";
import { Button } from "@/client/components/ui/button";

export function DevDiagnostics() {
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setResult("");
    try {
      const res = await apiFetch<{ status: number }>("/api/requests/execute", {
        body: { request: { method: "GET", url: "https://example.com" } },
      });
      setResult(`Réussi : example.com a répondu avec le statut ${res.status}.`);
    } catch (err) {
      const d = describeError(err);
      setResult(`${d.title} — ${d.detail}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-dashed border-border p-4">
      <h2 className="text-sm font-medium">Diagnostic (développement uniquement)</h2>
      <p className="text-xs text-muted-foreground">
        Envoie une requête vers example.com. Avec BOT_PROTECTION=turnstile, le contrôle anti-robot doit s&apos;ouvrir, puis la requête est rejouée.
      </p>
      <Button size="sm" variant="secondary" onClick={run} disabled={busy}>
        {busy ? "En cours…" : "Tester la requête et le défi"}
      </Button>
      {result && (
        <p className="text-sm" aria-live="polite">
          {result}
        </p>
      )}
    </section>
  );
}