"use client";

import { useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore } from "./index";

export function StoreProvider({ children }: { children: ReactNode }) {
  // Un store par session de navigateur (et non partagé entre requêtes serveur).
  const [store] = useState(makeStore);
  return <Provider store={store}>{children}</Provider>;
}