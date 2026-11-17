
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { cn } from "@/client/lib/utils";
import { GlossarySheet } from "./glossary-sheet";
import { InstanceBadge } from "./instance-badge";
import { NAV_ITEMS } from "./nav-items";

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Aller au contenu
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto grid  grid-cols-1 items-center gap-2 px-4 py-2 md:h-14 md:grid-cols-[1fr_auto_1fr] md:py-0">

          {/* Logo à gauche */}
          <Link
            href="/"
            className="flex items-center gap-2 justify-self-start rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="size-4" aria-hidden />
            </span>
            <span className="text-sm font-semibold">API Engineering</span>
          </Link>

          {/* Navigation centrée */}
          <nav
            aria-label="Navigation principale"
            className="w-full overflow-x-auto md:w-auto md:justify-self-center"
          >
            <ul className="flex items-center justify-center gap-1">
              {NAV_ITEMS.map(({ href, label }) => {
                const active = isActive(pathname, href);

                return (
                  <li key={href} className="shrink-0">
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Outils à droite */}
          <div className="flex items-center gap-2 justify-self-end">
            <InstanceBadge />
            <GlossarySheet />
          </div>

        </div>
      </header>

      <main
        id="contenu"
        tabIndex={-1}
        className="px-4 py-8 focus:outline-none md:px-8 md:py-10"
      >
        {children}
      </main>
    </div>
  );
}
