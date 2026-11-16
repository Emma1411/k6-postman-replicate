import { Activity, Gauge, Home, Send } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/requests", label: "Requêtes", icon: Send },
  { href: "/load", label: "Test de charge", icon: Activity },
  { href: "/sizing", label: "Dimensionnement", icon: Gauge },
] as const;