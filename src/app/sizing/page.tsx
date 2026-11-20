import type { Metadata } from "next";
import { Suspense } from "react";
import { SizingWorkspace } from "@/client/features/sizing/components/sizing-workspace";

export const metadata: Metadata = { title: "Dimensionnement" };

export default function Page() {
  // useSearchParams (le test choisi dans l'adresse) exige une frontière Suspense.
  return (
    <Suspense fallback={null}>
      <SizingWorkspace />
    </Suspense>
  );
}