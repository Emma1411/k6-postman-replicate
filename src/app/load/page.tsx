import type { Metadata } from "next";
import { LoadWorkspace } from "@/client/features/load/components/load-workspace";

export const metadata: Metadata = { title: "Test de charge" };

export default function Page() {
  return <LoadWorkspace />;
}