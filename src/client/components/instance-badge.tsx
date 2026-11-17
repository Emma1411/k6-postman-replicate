"use client";

import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { cn } from "@/client/lib/utils";
import { loadConfig } from "@/client/store/config-slice";
import { useAppDispatch, useAppSelector } from "@/client/store/hooks";
import { LimitsDialog } from "./limits-dialog";

/** Pastille d'état de l'instance. Ouvre la fenêtre « Limites ». */
export function InstanceBadge() {
  const config = useAppSelector((s) => s.config);
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);

  if (config.status === "idle" || config.status === "loading") return <Skeleton className="h-8 w-40" />;

  if (config.status === "error") {
    return (
      <Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => dispatch(loadConfig())}>
        Serveur injoignable · Réessayer
      </Button>
    );
  }

  const { deploymentMode, version, features } = config.value;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className={cn("size-2 rounded-full", features.loadTests ? "bg-success" : "bg-warning")} />
        <span className="font-medium">{deploymentMode === "public" ? "Instance publique" : "Instance privée"}</span>
        <span className="hidden text-muted-foreground sm:inline">{version === "dev" ? "dev" : `v${version}`}</span>
      </button>
      <LimitsDialog open={open} onOpenChange={setOpen} config={config.value} />
    </>
  );
}