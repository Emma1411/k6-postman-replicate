import type { Metadata } from "next";
import { RequestsWorkspace } from "@/client/features/requests/components/requests-workspace";

export const metadata: Metadata = { title: "Requêtes" };

export default function Page() {
  return <RequestsWorkspace />;
}