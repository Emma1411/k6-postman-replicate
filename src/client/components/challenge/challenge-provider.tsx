"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, Cpu, RotateCw, ShieldCheck, Terminal } from "lucide-react";
import { setChallengeHandler } from "@/client/api/client";
import { verifyBot } from "@/client/api/endpoints";
import { ApiError } from "@/client/api/errors";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useAppSelector } from "@/client/store/hooks";
import { Turnstile } from "./turnstile";

// Lien vers la doc d'auto-hébergement Docker. Tant que c'est null, la ligne est masquée.
const SELF_HOST_URL: string | null = null;

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Affiche le contrôle anti-robot quand une requête reçoit « CHALLENGE_REQUIRED »,
 * puis laisse le client API rejouer la requête.
 */
export function ChallengeProvider({ children }: { children: ReactNode }) {
  const siteKey = useAppSelector((s) =>
    s.config.status === "ready"
      ? (s.config.value.features.botProtection?.siteKey ?? null)
      : null,
  );
  const siteKeyRef = useRef(siteKey);
  useEffect(() => {
    siteKeyRef.current = siteKey;
  }, [siteKey]);

  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null);

  const requestChallenge = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        if (!siteKeyRef.current) {
          reject(
            new ApiError(
              "CHALLENGE_REQUIRED",
              "La vérification anti-robot n'est pas disponible : la configuration du service n'est pas chargée.",
              403,
            ),
          );
          return;
        }
        pending.current = { resolve, reject };
        setError(null);
        setAttempt((n) => n + 1);
        setOpen(true);
      }),
    [],
  );

  useEffect(() => {
    console.log("[challenge] handler enregistré");
    setChallengeHandler(requestChallenge);
    return () => {
      console.log("[challenge] handler retiré");
      setChallengeHandler(null);
    };
  }, [requestChallenge]);

  useEffect(() => {
    setChallengeHandler(requestChallenge);
    return () => setChallengeHandler(null);
  }, [requestChallenge]);

  const onToken = useCallback(async (token: string) => {
    setVerifying(true);
    try {
      await verifyBot({ token });
      pending.current?.resolve();
      pending.current = null;
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "La vérification a échoué. Réessaie.",
      );
      setAttempt((n) => n + 1); // nouveau widget
    } finally {
      setVerifying(false);
    }
  }, []);

  const onWidgetError = useCallback((message: string) => setError(message), []);

  const reload = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const close = useCallback(() => {
    pending.current?.reject(
      new ApiError("CHALLENGE_REQUIRED", "Vérification annulée.", 403),
    );
    pending.current = null;
    setOpen(false);
  }, []);

  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent className="gap-5 sm:max-w-xl">
          <DialogHeader className="flex-row items-start gap-4 space-y-0 text-left">
            <div className="rounded-lg border bg-muted/40 p-2.5 text-primary">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <DialogTitle>Contrôle anti-robot</DialogTitle>
              <DialogDescription>
                Vérification d’accès au service public
              </DialogDescription>
            </div>
          </DialogHeader>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Pour protéger le banc de test partagé contre les surcharges
            automatisées et garantir des créneaux d’exécution équitables pour
            chaque développeur.
          </p>

          <div className="rounded-xl border bg-muted/30 p-4">
            {siteKey && (
              <Turnstile
                key={attempt}
                siteKey={siteKey}
                onToken={onToken}
                onError={onWidgetError}
              />
            )}
            <p
              className="mt-3 min-h-5 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {verifying
                ? "Vérification en cours…"
                : "Un cookie technique de courte durée est posé après la vérification."}
            </p>
            {error && (
              <p role="alert" className="mt-2 text-sm text-destructive-text">
                {error}
              </p>
            )}
          </div>

          <div className="rounded-xl bg-muted/20 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Cpu className="size-4 text-primary" aria-hidden /> Pourquoi ce
              contrôle ?
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Chaque test de charge mobilise des threads CPU sur notre
              générateur. Ce filtre stoppe l’automatisation abusive sans toucher
              à tes données : tes scénarios, clés d’API et payloads restent dans
              ton navigateur (IndexedDB).
            </p>
            {SELF_HOST_URL && (
              <a
                href={SELF_HOST_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center justify-between rounded-md bg-background/60 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  <Terminal className="size-4" aria-hidden /> Besoin de bypass
                  complet ?
                </span>
                <span className="flex items-center gap-1 font-medium text-foreground">
                  Déployer en Docker autonome{" "}
                  <ArrowRight className="size-4" aria-hidden />
                </span>
              </a>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" onClick={close}>
              Annuler
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={reload}
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <RotateCw className="size-3.5" aria-hidden /> Widget bloqué ?
              Recharger le défi
            </button>
            <span>Touche Échap pour fermer</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
