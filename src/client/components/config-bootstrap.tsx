"use client";

import { useEffect } from "react";
import { loadConfig } from "@/client/store/config-slice";
import { useAppDispatch } from "@/client/store/hooks";

/** Charge la configuration de l'instance (limites, mode, protection) au démarrage. */
export function ConfigBootstrap() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const request = dispatch(loadConfig());
    return () => request.abort();
  }, [dispatch]);
  return null;
}