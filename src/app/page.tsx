import Link from "next/link";
import { Activity, Gauge, Send } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/client/components/ui/card";
import { DevDiagnostics } from "@/client/components/dev-diagnostics";
import { InstanceLimits } from "@/client/components/instance-limits";
import { redirect } from "next/navigation";

const PATHS = [
  {
    href: "/requests",
    icon: Send,
    title: "Tester une requête",
    description:
      "Envoie une requête HTTP et regarde la réponse, ses temps (DNS, connexion, TLS, attente) et tes vérifications.",
    when: "Pour comprendre ou déboguer une API.",
    cta: "Ouvrir le client API",
  },
  {
    href: "/load",
    icon: Activity,
    title: "Mesurer la performance",
    description:
      "Simule des utilisateurs qui appellent ton API en même temps, suis le résultat en direct et obtiens un verdict à la fin.",
    when: "Pour savoir ce que ton API supporte.",
    cta: "Préparer un test de charge",
  },
  {
    href: "/sizing",
    icon: Gauge,
    title: "Dimensionner mon infrastructure",
    description:
      "À partir d'un test ou de tes hypothèses, estime combien d'instances, de processeurs et de mémoire il te faut pour une charge visée.",
    when: "Pour préparer une mise en production.",
    cta: "Planifier la capacité",
  },
] as const;

export default function HomePage() {
 redirect("/requests");
}