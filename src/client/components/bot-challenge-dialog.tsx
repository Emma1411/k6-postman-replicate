"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Cpu,
  RotateCw,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import {
  settleBotChallenge,
  subscribeBotChallenge,
} from "@/client/lib/bot-challenge";

const SELF_HOST_URL = "https://github.com/Emma1411/k6-postman-replicate";

let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile_script"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

let siteKeyCache: string | null = null;
async function getSiteKey(): Promise<string | null> {
  if (siteKeyCache) return siteKeyCache;
  const res = await fetch("/api/config");
  const data = await res.json();
  siteKeyCache = data?.bot?.siteKey ?? null;
  return siteKeyCache;
}

type Status = "loading" | "ready" | "verifying" | "error";

export function BotChallengeDialog() {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const wasOpen = useRef(false);

  useEffect(() => subscribeBotChallenge(setOpen), []);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        setToken(null);
        setMessage(null);
        setStatus("loading");
      }
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    getSiteKey()
      .then((key) => {
        if (key) setSiteKey(key);
        else {
          setStatus("error");
          setMessage("Protection mal configurée côté serveur.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Impossible de joindre le serveur.");
      });
  }, [open]);

  useEffect(() => {
    if (!open || !box || !siteKey) return;
    let widgetId: string | undefined;
    let cancelled = false;
    setStatus("loading");
    loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(box, {
          sitekey: siteKey,
          theme: "dark",
          size: "flexible",
          language: "fr",
          callback: (t: string) => {
            setToken(t);
            setMessage(null);
            setStatus("ready");
          },
          "expired-callback": () => {
            setToken(null);
            setStatus("loading");
          },
          "error-callback": () => {
            setToken(null);
            setStatus("error");
            setMessage("Le widget a rencontré une erreur. Recharge le défi.");
          },
        });
      })
      .catch(() => {
        setStatus("error");
        setMessage(
          "Le widget n'a pas pu charger (réseau ou bloqueur de contenu).",
        );
      });
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [open, box, siteKey, attempt]);

  async function submit() {
    if (!token) return;
    setStatus("verifying");
    try {
      const res = await fetch("/api/bot/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        settleBotChallenge(true);
        return;
      }
      const body = await res.json().catch(() => null);
      setMessage(
        body?.error?.message ??
          body?.message ??
          "La vérification a échoué. Réessaie.",
      );
    } catch {
      setMessage("Serveur injoignable. Réessaie.");
    }
    setToken(null);
    setAttempt((a) => a + 1);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && settleBotChallenge(false)}>
      <DialogContent className="max-w-xl gap-5 border-sky-950 bg-slate-950 p-8 text-slate-100">
        <DialogHeader className="flex-row items-start gap-4 space-y-0">
          <div className="rounded-lg border border-sky-900/60 bg-sky-950/40 p-2.5 text-sky-300">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div>
            <DialogTitle className="text-xl">Contrôle anti-robot</DialogTitle>
            <DialogDescription className="text-slate-400">
              Vérification d’accès au service public
            </DialogDescription>
          </div>
        </DialogHeader>

        <p className="text-base leading-relaxed text-slate-300">
          Pour protéger le banc de test partagé contre les surcharges
          automatisées et garantir des créneaux d’exécution équitables pour
          chaque développeur.
        </p>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div ref={setBox} className="min-h-[65px]" />
          <p className="mt-3 text-xs text-slate-400">
            Cookie technique de courte durée · aucun profilage publicitaire
          </p>
          {message && (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {message}
            </p>
          )}
        </div>

        <div className="rounded-xl bg-slate-900/50 p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Cpu className="size-4 text-sky-300" aria-hidden /> Pourquoi ce
            contrôle ?
          </div>
          <p className="text-sm leading-relaxed text-slate-400">
            Chaque test de charge mobilise des threads CPU sur notre générateur.
            Ce filtre stoppe l’automatisation abusive sans toucher à tes données
            : tes scénarios, clés d’API et payloads restent dans ton navigateur
            (IndexedDB).
          </p>
          <a
            href={SELF_HOST_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center justify-between rounded-md bg-slate-950/60 px-3 py-2 text-sm text-slate-300 hover:text-sky-300"
          >
            <span className="flex items-center gap-2">
              <Terminal className="size-4" aria-hidden /> Besoin de bypass
              complet ?
            </span>
            <span className="flex items-center gap-1 font-medium text-slate-100">
              Déployer en Docker autonome{" "}
              <ArrowRight className="size-4" aria-hidden />
            </span>
          </a>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => settleBotChallenge(false)}>
            Annuler
          </Button>
          <Button
            onClick={submit}
            disabled={!token || status === "verifying"}
            className="flex-1 bg-sky-300 text-slate-950 hover:bg-sky-200 disabled:bg-slate-800 disabled:text-slate-500"
          >
            <Zap className="mr-2 size-4" aria-hidden />
            {status === "verifying"
              ? "Vérification…"
              : "Continuer vers le test de charge"}
          </Button>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="flex items-center gap-1.5 hover:text-slate-300"
          >
            <RotateCw className="size-3.5" aria-hidden /> Widget bloqué ?
            Recharger le défi
          </button>
          <span>Touche Échap pour fermer</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
