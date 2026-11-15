# API Engineering Platform

Plateforme open source et gratuite pour **tester, mesurer et dimensionner des API** : client HTTP (type Postman),
tests fonctionnels, moteur de test de charge intégré (modèle d'exécuteurs, métriques et seuils inspiré de k6, sans
binaire externe), comparaison de résultats, rapports, et Scalability Advisor avec planification de capacité.
Aucune IA, aucune base de données : les configurations vivent dans le navigateur (export/import JSON).

## État du projet

- Serveur (API, moteur de charge, Advisor, import Postman/OpenAPI, Prometheus, rapports) : terminé et testé.
- Interface web : en cours de développement.

## Démarrage rapide

```bash
npm install
npm run dev          # construit le worker puis lance Next sur http://localhost:3000
npm test             # tests unitaires et d'intégration
npm run bench        # micro-benchmark safe-regex vs RegExp natif
```

Avec Docker :

```bash
cp .env.example .env
docker compose up --build        # http://127.0.0.1:3000
```

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `DEPLOYMENT_MODE` | `public` | `public` : inconnus autorisés, réseaux privés interdits en production. `private` : personnes de confiance. |
| `ALLOW_PRIVATE_NETWORKS` | `false` | Autorise les cibles en réseau privé (interdit en production en mode `public`). |
| `HTTP_*` | 30 s, 5 Mio, 5 redirections | Limites du client HTTP. |
| `WORKFLOW_MAX_STEPS` | 50 | Étapes maximum par workflow. |
| `LOAD_MAX_VUS` / `LOAD_MAX_DURATION_SECONDS` / `LOAD_MAX_RPS` | 100 / 120 / 500 | Plafonds d'un test de charge. |
| `LOAD_MAX_CONCURRENT_RUNS` | 1 | Tests de charge simultanés. |
| `RATE_LIMIT_*` | 120 req / 60 s, 10 tests/h | Limitation de débit par IP. |
| `TRUSTED_PROXY_HOPS` | 1 | Nombre de proxys de confiance devant l'application (lecture de `X-Forwarded-For`). |
| `PROMETHEUS_ALLOWED_HOSTS` | vide | Hôtes privés autorisés **uniquement** pour la connexion Prometheus. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |

Liste complète : `.env.example`.

## API

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/requests/execute` | Exécute une requête HTTP |
| POST | `/api/workflows/run` | Exécute un workflow (assertions, extractions) |
| POST | `/api/load-tests/run` | Lance un test de charge (flux SSE) |
| GET | `/api/load-tests/{id}` | État d'un test |
| GET | `/api/load-tests/{id}/events` | Rattache un flux SSE à un test |
| POST | `/api/load-tests/{id}/cancel` | Annule un test |
| POST | `/api/advisor/analyze` | Analyse d'un test (Scalability Advisor) |
| POST | `/api/advisor/capacity` | Planification de capacité |
| POST | `/api/infrastructure/check` · `/query` | Vérifie / interroge Prometheus |
| POST | `/api/import` | Import Postman v2.x ou OpenAPI 3.0/3.1 |
| POST | `/api/reports/export` | Rapport HTML ou JSON |
| GET | `/api/config` · `/api/health` | Limites publiques · santé |

## Sécurité

Voir [docs/security.md](docs/security.md) et [SECURITY.md](SECURITY.md). Points clés : protection SSRF avec
résolution DNS épinglée, limites strictes, aucun code utilisateur exécuté côté serveur, workers isolés,
rapports avec CSP stricte et secrets masqués.

## Déploiement

Docker, Docker Compose et Google Cloud Run : [docs/deploy-cloud-run.md](docs/deploy-cloud-run.md).

## Performances

Les expressions régulières écrites par l'utilisateur (extracteurs `regex`, assertions `matches`) s'exécutent dans un
bac à sable avec délai maximum de 50 ms, pour qu'un motif catastrophique ne bloque pas le serveur. Cette protection
coûte environ 0,12 ms par appel (mesuré sous Windows et sous Linux dans Docker). En test de charge, préfère les
assertions `status`, `responseTime`, `jsonPath` et `bodyContains`, qui n'ont pas ce coût.
