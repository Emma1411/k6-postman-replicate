"use client";

import type { ReactNode } from "react";
import { StoreProvider } from "@/client/store/store-provider";
import { ChallengeProvider } from "./challenge/challenge-provider";
import { ConfigBootstrap } from "./config-bootstrap";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <ChallengeProvider>
        <ConfigBootstrap />
        {children}
      </ChallengeProvider>
    </StoreProvider>
  );
}