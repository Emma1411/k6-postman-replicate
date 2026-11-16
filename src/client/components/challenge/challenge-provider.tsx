"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { setChallengeHandler } from "@/client/api/client";
import { verifyBot } from "@/client/api/endpoints";
import { ApiError } from "@/client/api/errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useAppSelector } from "@/client/store/hooks";
import { Turnstile } from "./turnstile";

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
    s.config.status === "ready" ? (s.config.value.features.botProtection?.siteKey ?? null) : null,
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
      setError(err instanceof ApiError ? err.message : "La vérification a échoué. Réessaie.");
      setAttempt((n) => n + 1); // nouveau widget
    } finally {
      setVerifying(false);
    }
  }, []);

  const onWidgetError = useCallback((message: string) => setError(message), []);

  const close = useCallback(() => {
    pending.current?.reject(new ApiError("CHALLENGE_REQUIRED", "Vérification annulée.", 403));
    pending.current = null;
    setOpen(false);
  }, []);

  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Un contrôle rapide</DialogTitle>
            <DialogDescription>
              Ce service est public. Ce contrôle protège les ressources partagées contre les robots. Il ne prend que
              quelques secondes.
            </DialogDescription>
          </DialogHeader>
          {siteKey && <Turnstile key={attempt} siteKey={siteKey} onToken={onToken} onError={onWidgetError} />}
          <p className="min-h-5 text-sm" aria-live="polite">
            {verifying ? "Vérification en cours…" : null}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}