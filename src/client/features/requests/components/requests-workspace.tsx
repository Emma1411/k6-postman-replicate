"use client";

import { FilePlus2, Gauge } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { addHistory } from "@/client/storage/repositories";
import { useAppDispatch, useAppSelector } from "@/client/store/hooks";
import { loadSavedDraft, saveDraft } from "../draft-persistence";
import {
  loadDraft,
  resetDraft,
  sendRequest,
  setAssertions,
  setAuth,
  setBody,
  setHeaders,
  setMethod,
  setName,
  setParams,
  setSettings,
  setUrl,
} from "../editor-slice";
import { loadEnvironments, selectActiveVariables } from "../environments-slice";
import { saveLoadHandoff } from "../load-handoff";
import { draftLabel, validateDraft } from "../model";
import { AssertionsEditor } from "./assertions-editor";
import { AuthEditor } from "./auth-editor";
import { BodyEditor } from "./body-editor";
import { CodeExportDialog } from "./code-export-dialog";
import { KeyValueTable } from "./key-value-table";
import { RequestBar } from "./request-bar";
import { ResponsePanel } from "./response-panel";
import { SettingsEditor } from "./settings-editor";
import { SidePanel } from "./side-panel";

function TabLabel({ children, count, dot }: { children: string; count?: number; dot?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {children}
      {count ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{count}</Badge> : null}
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
    </span>
  );
}

export function RequestsWorkspace() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const draft = useAppSelector((s) => s.editor.draft);
  const send = useAppSelector((s) => s.editor.send);
  const variables = useAppSelector(selectActiveVariables);
  const sending = send.status === "sending";

  const [hydrated, setHydrated] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const pending = useRef<{ abort: () => void } | null>(null);
  const recorded = useRef<number | null>(null);

  /* Reprise du brouillon enregistré et des environnements. */
  useEffect(() => {
    let cancelled = false;
    loadSavedDraft().then((saved) => {
      if (cancelled) return;
      if (saved) dispatch(loadDraft(saved));
      setHydrated(true);
    });
    dispatch(loadEnvironments());
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  /* Le brouillon est conservé dans le navigateur, avec un léger délai. */
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => void saveDraft(draft), 500);
    return () => clearTimeout(timer);
  }, [draft, hydrated]);

  /* Chaque réponse reçue entre dans l'historique. */
  useEffect(() => {
    if (send.status !== "done" || recorded.current === send.sentAt) return;
    recorded.current = send.sentAt;
    addHistory({
      id: crypto.randomUUID(),
      createdAt: send.sentAt,
      kind: "request",
      label: draftLabel(draft),
      summary: { draft, status: send.response.status, durationMs: send.response.timings.totalMs },
    })
      .then(() => setHistoryKey((k) => k + 1))
      .catch(() => {
        /* stockage indisponible : l'historique n'est pas conservé */
      });
  }, [send, draft]);

  const submit = useCallback(() => {
    if (sending) return;
    pending.current = dispatch(sendRequest({ variables }));
  }, [dispatch, sending, variables]);

  const cancel = useCallback(() => pending.current?.abort(), []);

  /* Ctrl+Entrée (ou Cmd+Entrée) envoie, même depuis un champ : on valide d'abord la saisie en cours. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      setTimeout(submit, 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submit]);

  const runExample = () => {
    dispatch(setMethod("GET"));
    dispatch(setUrl("https://example.com"));
    dispatch(setAssertions([{ type: "status", expected: 200 }, { type: "responseTime", operator: "lt", valueMs: 2000 }]));
    setTimeout(submit, 0);
  };

  const invalid = validateDraft(draft) !== null;

  async function testUnderLoad() {
    setHandoffError(null);
    try {
      await saveLoadHandoff({ draft, variables, createdAt: Date.now() });
      router.push("/load");
    } catch {
      setHandoffError("Le stockage du navigateur est indisponible : impossible de transmettre la requête.");
    }
  }

  const activeParams = draft.params.filter((p) => p.enabled && p.key).length;
  const activeHeaders = draft.headers.filter((h) => h.enabled && h.key).length;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[280px_1fr]">
      <div className="order-2 lg:order-1">
        <SidePanel refreshKey={historyKey} />
      </div>

      <div className="order-1 min-w-0 space-y-6 lg:order-2">
        <section aria-label="Requête" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draft.name}
              onChange={(e) => dispatch(setName(e.target.value))}
              placeholder="Requête sans titre"
              aria-label="Nom de la requête"
              className="max-w-xs border-transparent bg-transparent px-1 text-base font-medium shadow-none focus-visible:border-input"
            />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => dispatch(resetDraft())}>
                <FilePlus2 className="size-4" aria-hidden />
                Nouvelle
              </Button>
              <CodeExportDialog draft={draft} variables={variables} disabled={invalid} />
              <Button type="button" variant="outline" size="sm" className="gap-2" disabled={invalid} onClick={testUnderLoad}>
                <Gauge className="size-4" aria-hidden />
                Tester sous charge
              </Button>
            </div>
          </div>
          {handoffError && (
            <p role="alert" className="text-sm text-destructive-text">
              {handoffError}
            </p>
          )}

          <RequestBar
            method={draft.method}
            url={draft.url}
            sending={sending}
            onMethod={(m) => dispatch(setMethod(m))}
            onUrl={(u) => dispatch(setUrl(u))}
            onSend={submit}
            onCancel={cancel}
          />

          <Tabs defaultValue="params">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="params"><TabLabel count={activeParams}>Paramètres</TabLabel></TabsTrigger>
              <TabsTrigger value="headers"><TabLabel count={activeHeaders}>En-têtes</TabLabel></TabsTrigger>
              <TabsTrigger value="body"><TabLabel dot={draft.body.kind !== "none"}>Corps</TabLabel></TabsTrigger>
              <TabsTrigger value="auth"><TabLabel dot={draft.auth.type !== "none"}>Auth</TabLabel></TabsTrigger>
              <TabsTrigger value="assertions"><TabLabel count={draft.assertions.length}>Assertions</TabLabel></TabsTrigger>
              <TabsTrigger value="settings"><TabLabel>Réglages</TabLabel></TabsTrigger>
            </TabsList>

            <TabsContent value="params" className="pt-4">
              <KeyValueTable
                rows={draft.params}
                onChange={(rows) => dispatch(setParams(rows))}
                keyLabel="Paramètre"
                keyPlaceholder="page"
                addLabel="Ajouter un paramètre"
                emptyText="Aucun paramètre. Les lignes actives s'ajoutent à l'adresse, et l'adresse les met à jour."
              />
            </TabsContent>
            <TabsContent value="headers" className="pt-4">
              <KeyValueTable
                rows={draft.headers}
                onChange={(rows) => dispatch(setHeaders(rows))}
                keyLabel="En-tête"
                keyPlaceholder="Accept"
                addLabel="Ajouter un en-tête"
                emptyText="Aucun en-tête personnalisé."
              />
            </TabsContent>
            <TabsContent value="body" className="pt-4">
              <BodyEditor body={draft.body} onChange={(body) => dispatch(setBody(body))} />
            </TabsContent>
            <TabsContent value="auth" className="pt-4">
              <AuthEditor auth={draft.auth} onChange={(auth) => dispatch(setAuth(auth))} />
            </TabsContent>
            <TabsContent value="assertions" className="pt-4">
              <AssertionsEditor assertions={draft.assertions} onChange={(a) => dispatch(setAssertions(a))} />
            </TabsContent>
            <TabsContent value="settings" className="pt-4">
              <SettingsEditor
                timeoutMs={draft.timeoutMs}
                followRedirects={draft.followRedirects}
                onChange={(settings) => dispatch(setSettings(settings))}
              />
            </TabsContent>
          </Tabs>
        </section>

        <ResponsePanel onCancel={cancel} onExample={runExample} />
      </div>
    </div>
  );
}