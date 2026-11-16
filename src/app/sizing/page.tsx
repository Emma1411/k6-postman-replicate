import type { Metadata } from "next";
import { ComingSoon } from "@/client/components/coming-soon";

export const metadata: Metadata = { title: "Dimensionnement" };

export default function Page() {
  return (
    <ComingSoon
      title="Dimensionnement"
      step="9.4"
      description="Le diagnostic d'un test, la planification de capacité et la connexion à Prometheus."
    />
  );
}