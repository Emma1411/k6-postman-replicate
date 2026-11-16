import type { Metadata } from "next";
import { ComingSoon } from "@/client/components/coming-soon";

export const metadata: Metadata = { title: "Test de charge" };

export default function Page() {
  return (
    <ComingSoon
      title="Test de charge"
      step="9.3"
      description="Un assistant en trois étapes (cible, charge, critères de réussite) et un tableau de bord en temps réel."
    />
  );
}