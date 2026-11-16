import type { Metadata } from "next";
import { ComingSoon } from "@/client/components/coming-soon";

export const metadata: Metadata = { title: "Requêtes" };

export default function Page() {
  return (
    <ComingSoon
      title="Requêtes"
      step="9.2"
      description="Envoie une requête, lis la réponse et sa décomposition par temps, organise tes collections."
    />
  );
}