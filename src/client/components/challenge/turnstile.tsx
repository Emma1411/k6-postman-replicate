"use client";

import { useEffect, useRef } from "react";

interface TurnstileParams {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  callback: (token: string) => void;
  "error-callback"?: (code?: string) => void;
  "expired-callback"?: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, params: TurnstileParams): string;
      remove(widgetId: string): void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Le contrôle de sécurité n'a pas pu être chargé. Vérifie ta connexion."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface Props {
  siteKey: string;
  /** Doivent être stables (useCallback), sinon le widget est recréé à chaque rendu. */
  onToken: (token: string) => void;
  onError: (message: string) => void;
}

export function Turnstile({ siteKey, onToken, onError }: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: onToken,
          "error-callback": () => onError("Le contrôle a rencontré une erreur. Réessaie."),
          "expired-callback": () => onError("Le contrôle a expiré. Recommence."),
        });
      })
      .catch((err: Error) => onError(err.message));

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken, onError]);

  return <div ref={container} />;
}