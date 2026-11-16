"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { cn } from "@/client/lib/utils";
import { InstanceBadge } from "./instance-badge";
import { NAV_ITEMS } from "./nav-items";

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

function NavList({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  return (
    <ul className={cn("flex gap-1", orientation === "vertical" ? "flex-col" : "overflow-x-auto px-3 pb-2")}>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-3 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Activity className="size-4" aria-hidden />
      </span>
      <span className="text-sm font-semibold leading-tight">
        API Engineering
        <br />
        Platform
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Aller au contenu
      </a>

      <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <Brand />
        <nav aria-label="Navigation principale" className="flex-1 px-3">
          <NavList orientation="vertical" />
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <InstanceBadge />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="border-b border-sidebar-border bg-sidebar md:hidden">
          <Brand />
          <nav aria-label="Navigation principale">
            <NavList orientation="horizontal" />
          </nav>
        </header>
        <main id="contenu" tabIndex={-1} className="min-w-0 flex-1 px-5 py-8 focus:outline-none md:px-10 md:py-12">
          {children}
        </main>
      </div>
    </div>
  );
}