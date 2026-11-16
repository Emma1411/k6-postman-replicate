import Link from "next/link";
import { Activity, Gauge, Send } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/client/components/ui/card";
import { DevDiagnostics } from "@/client/components/dev-diagnostics";
import { InstanceLimits } from "@/client/components/instance-limits";

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
  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Que veux-tu faire ?</h1>
        <p className="max-w-2xl text-muted-foreground">
          Teste tes API, mesure leur performance et découvre si ton infrastructure tiendra la charge. Gratuit, sans
          compte : tes collections et tes réglages sont enregistrés dans ton navigateur, pas sur le serveur.
        </p>
      </header>

      <section aria-labelledby="chemins" className="grid gap-4 md:grid-cols-3">
        <h2 id="chemins" className="sr-only">
          Par où commencer hhhhhhhhhhhhhhhhhhhhhhhhhh
        </h2>
        {PATHS.map(({ href, icon: Icon, title, description, when, cta }) => (
          <Card key={href} className="flex flex-col">
            <CardHeader>
              <Icon className="mb-2 size-6 text-primary" aria-hidden />
              <CardTitle>{title}</CardTitle>
              <CardDescription>{when}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 text-sm text-muted-foreground">{description}</CardContent>
            <CardFooter>
              <Button asChild>
                <Link href={href}>{cta}</Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </section>

      <section aria-label="Limites de l'instance">
        <InstanceLimits />
      </section>

      {process.env.NODE_ENV !== "production" && <DevDiagnostics />}
    </div>
  );
}