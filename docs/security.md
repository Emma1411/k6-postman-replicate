# Modèle de sécurité

## Principe

Le serveur effectue des requêtes réseau choisies par l'utilisateur : c'est son rôle, et c'est donc la principale
surface d'attaque (SSRF, abus comme outil de charge). La défense repose sur des plafonds stricts et sur le fait
qu'aucun code fourni par l'utilisateur n'est exécuté côté serveur.

## Modes de déploiement

- `public` : n'importe qui peut utiliser l'instance. Les réseaux privés sont interdits en production, sans exception.
- `private` : réservé à des personnes de confiance. Quiconque peut utiliser l'instance peut faire appeler par le
  serveur tout ce qu'il atteint (réseau interne, métadonnées cloud). Ne l'expose jamais sur Internet.

## Menaces et mesures

| Menace | Mesure | Où |
|---|---|---|
| SSRF vers réseaux privés ou métadonnées | Liste de blocage IPv4/IPv6, noms d'hôtes interdits, résolution DNS puis connexion épinglée à l'IP validée (anti-rebinding), revalidation à chaque redirection | `middlewares/ssrf-guard.ts` |
| Contournements d'adresses (décimal, octal, hex, IPv4 mappé IPv6) | Normalisation WHATWG avant contrôle | `tests/security/ssrf-matrix.test.ts` |
| Abus comme outil de charge | Plafonds VUs, durée, débit ; 1 test simultané ; quota horaire ; limitation par IP | `config/`, `middlewares/with-api.ts` |
| Épuisement mémoire | Taille max des corps et réponses, protection contre les bombes de décompression, plafond de points de séries | `services/http-executor/` |
| ReDoS | Expressions utilisateur exécutées dans `node:vm` avec délai de 50 ms | `engine/vu/safe-regex.ts` |
| YAML bomb | `maxAliasCount` à 100, taille limitée | `services/import/spec-text.ts` |
| Exécution de code | Aucun script serveur ; `pm.test` d'un import Postman n'est jamais exécuté (avertissement) ; test statique interdisant `eval`, `new Function`, `child_process` | `tests/security/` |
| XSS dans les rapports | Échappement systématique, CSP `default-src 'none'`, `sandbox`, téléchargement en pièce jointe | `shared/reports/html.ts` |
| Fuite de secrets | Masquage par défaut dans rapports et logs ; erreurs internes génériques côté client | `shared/reports/redaction.ts`, `utils/logger.ts` |
| Pollution de prototype | Schémas Zod, accès `hasOwn`, test dédié | `tests/security/input-hardening.test.ts` |
| Rejeu / énumération d'un test | Identifiant de test imprévisible (capability) ; non journalisé dans les chemins | `engine/runs/` |
| Fuite de topologie | `/api/config` n'expose que des booléens et des limites | `config/public-config.ts` |

## Risques résiduels (acceptés et documentés)

- Instance publique : un utilisateur peut générer du trafic vers un tiers dans la limite des plafonds (100 VUs,
  500 req/s par défaut). Les plafonds sont réglables ; baisse-les pour une instance très exposée.
- Limitation de débit en mémoire : par instance. Avec `max-instances=1`, elle est exacte ; avec plusieurs instances,
  elle est multipliée.
- `X-Forwarded-For` : fiable seulement si `TRUSTED_PROXY_HOPS` correspond à l'infrastructure réelle (procédure de
  vérification dans `deploy-cloud-run.md`).
- Le navigateur stocke les collections (dont d'éventuels secrets) dans IndexedDB, en clair. Les exports masquent les
  secrets par défaut.
- Les métriques Prometheus d'un hôte privé autorisé (`PROMETHEUS_ALLOWED_HOSTS`) sont accessibles à tout utilisateur de
  l'instance : n'y mets que des Prometheus sans données sensibles.

## Liste de contrôle opérateur

- [ ] Mode `public` pour toute instance ouverte ; `private` jamais exposé sur Internet
- [ ] Plafonds de charge adaptés à ton quota et à ton risque d'abus
- [ ] `TRUSTED_PROXY_HOPS` vérifié derrière ton proxy
- [ ] Alerte de budget configurée chez l'hébergeur
- [ ] Image reconstruite régulièrement (Dependabot + `npm audit`)
- [ ] Docker : pas de socket Docker monté, utilisateur non root, système de fichiers en lecture seule (déjà le cas dans `docker-compose.yml`)