# API Engineering Platform

## Description

**API Engineering Platform** est une plateforme open source et gratuite dédiée au développement, au test et au dimensionnement des API.

Elle regroupe dans une seule interface les fonctionnalités essentielles d'un outil d'ingénierie API : client HTTP, tests fonctionnels, tests de charge, analyse des performances et planification de capacité.

L'objectif est de permettre aux développeurs de tester leurs API, d'identifier leurs problèmes de performance et d'estimer les ressources nécessaires à leur mise en production, sans dépendre d'outils externes complexes.

La plateforme intègre son propre moteur de test de charge, inspiré du modèle d'exécution et des métriques de k6, sans nécessiter de binaire externe.

### Caractéristiques principales

- Client HTTP pour exécuter et analyser des requêtes API
- Tests fonctionnels avec assertions et extractions de données
- Moteur de test de charge intégré avec utilisateurs virtuels, métriques et seuils
- Comparaison des résultats et génération de rapports
- Intégration Prometheus pour interroger les métriques d'infrastructure
- Protection anti-robot avec Cloudflare Turnstile

Aucune intelligence artificielle et aucune base de données ne sont nécessaires. Les collections, scénarios et configurations sont conservés localement dans le navigateur (IndexedDB), avec possibilité d'export et d'import JSON.

**Lien de démonstration :https://api-engineering-602169670138.northamerica-northeast1.run.app/

---

## Stack technique

| Composant              | Technologie                  |
|------------------------|------------------------------|
| Framework              | Next.js 16 (App Router)      |
| Langage                | TypeScript                   |
| Interface              | React                        |
| Styling                | Tailwind CSS                 |
| Composants UI          | shadcn/ui                    |
| Icônes                 | Lucide React                 |
| Typographies           | Geist, Geist Mono            |
| Validation             | Zod                          |
| Moteur de charge       | Workers Node.js / TypeScript |
| Construction des workers | tsup                       |
| Tests                  | Vitest                       |
| Qualité du code        | ESLint, TypeScript           |
| Conteneurisation       | Docker                       |
| CI/CD                  | GitHub Actions               |
| Hébergement            | Google Cloud Run             |
| Protection anti-robot  | Cloudflare Turnstile         |
| Observabilité          | Prometheus                   |
| Stockage des secrets   | Google Secret Manager        |

---

## Architecture technique

La plateforme repose sur une architecture Next.js full-stack. Le frontend communique avec les routes API internes, qui délèguent les opérations aux différents contrôleurs et services métier.

### Architecture applicative

```
┌──────────────────────────────────────┐
│           React / Next.js            │
│              Interface UI            │
├──────────────────────────────────────┤
│                                      │
│  Requêtes HTTP                       │
│  Tests de charge                     │
│  Dimensionnement                     │
│  Rapports                            │
│                                      │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│            API Routes Next.js         │
├──────────────────────────────────────┤
│                                      │
│  Requests Controller                 │
│  Load Tests Controller               │
│  Advisor Controller                  │
│  Infrastructure Controller           │
│  Reports Controller                  │
│                                      │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│              Couche métier           │
├──────────────────────────────────────┤
│                                      │
│  Client HTTP sécurisé                │
│  Workflow Engine                     │
│  Load Test Engine                    │
│  Scalability Advisor                 │
│  Rate Limiting                       │
│  Bot Protection                      │
│                                      │
└──────────────────┬───────────────────┘
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
┌──────────────────┐ ┌──────────────────┐
│   Load Workers   │ │    Prometheus    │
│     Node.js      │ │    Metrics API   │
└──────────────────┘ └──────────────────┘
          │
          ▼
┌──────────────────────────────────────┐
│           Google Cloud Run           │
│                                      │
│          Docker Container            │
│          Next.js + Workers            │
└──────────────────────────────────────┘
```
