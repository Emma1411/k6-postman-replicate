"use client";

import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import { loadConfig } from "@/client/store/config-slice";
import { useAppDispatch, useAppSelector } from "@/client/store/hooks";

export function InstanceBadge() {
  const config = useAppSelector((s) => s.config);
  const dispatch = useAppDispatch();

  if (config.status === "idle" || config.status === "loading") {
    return <Skeleton className="h-5 w-32" />;
  }
  if (config.status === "error") {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-destructive-text">Serveur injoignable</p>
        <button
          type="button"
          onClick={() => dispatch(loadConfig())}
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const { deploymentMode, version } = config.value;
  return (
    <div className="flex items-center gap-2">
      <Badge variant={deploymentMode === "public" ? "secondary" : "outline"}>
        {deploymentMode === "public" ? "Instance publique" : "Instance privée"}
      </Badge>
      <span className="text-xs text-muted-foreground">{version === "dev" ? "dev" : `v${version}`}</span>
    </div>
  );
}