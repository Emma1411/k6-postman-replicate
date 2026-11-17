export interface GlossaryEntry {
  label: string;
  definition: string;
  example?: string;
}

export const GLOSSARY = {
  p50: {
    label: "Médiane (p50)",
    definition:
      "La moitié des requêtes sont plus rapides que cette valeur, l'autre moitié plus lentes. C'est le temps de réponse « typique ».",
    example: "p50 = 80 ms : une requête sur deux répond en moins de 80 ms.",
  },
  p95: {
    label: "p95",
    definition:
      "95 % des requêtes sont plus rapides que cette valeur. C'est plus parlant que la moyenne, car les requêtes lentes y sont visibles.",
    example: "p95 = 300 ms : 19 requêtes sur 20 répondent en moins de 300 ms.",
  },
  p99: {
    label: "p99",
    definition:
      "99 % des requêtes sont plus rapides que cette valeur. Il met en évidence les lenteurs rares mais bien réelles que vivent certains utilisateurs.",
    example: "p99 = 1,2 s : une requête sur cent met plus de 1,2 seconde.",
  },
  vu: {
    label: "Utilisateur virtuel (VU)",
    definition:
      "Un utilisateur simulé qui enchaîne les étapes de ton scénario en boucle, comme le ferait une vraie personne.",
    example: "50 VUs = 50 personnes simulées qui utilisent ton API en même temps.",
  },
  rps: {
    label: "Requêtes par seconde (débit)",
    definition:
      "Le nombre de requêtes que le service traite chaque seconde. C'est à la fois la mesure de la charge appliquée et celle de la capacité du service.",
    example: "300 req/s, c'est environ 18 000 requêtes par minute.",
  },
  latency: {
    label: "Latence (temps de réponse)",
    definition: "Le temps écoulé entre l'envoi de la requête et la réception complète de la réponse.",
  },
  errorRate: {
    label: "Taux d'erreur",
    definition:
      "La part des requêtes que le test considère comme échouées : erreur réseau, délai dépassé ou réponse d'erreur.",
    example: "1 % = 1 requête sur 100.",
  },
  threshold: {
    label: "Seuil (threshold)",
    definition: "Une règle de réussite que tu fixes pour le test. Si elle n'est pas respectée à la fin, le test est en échec.",
    example: "p(95)<500 : le test échoue si le p95 dépasse 500 ms.",
  },
  iteration: {
    label: "Itération",
    definition: "Un passage complet d'un utilisateur virtuel dans ton scénario : toutes les étapes, une fois.",
  },
  ramp: {
    label: "Montée en charge (rampe)",
    definition:
      "La charge augmente progressivement au lieu de rester constante. C'est le meilleur moyen de trouver le niveau où le service commence à se dégrader.",
  },
  saturation: {
    label: "Saturation",
    definition:
      "Une ressource (processeur, mémoire, connexions à la base) est presque entièrement utilisée. Au-delà, le service ne peut plus absorber de charge sans se dégrader.",
  },
  generatorSaturation: {
    label: "Générateur saturé",
    definition:
      "Le programme qui envoie la charge manque lui-même de ressources. Les temps mesurés incluent alors son propre retard : les résultats sont à prendre avec prudence.",
  },
  capacity: {
    label: "Capacité",
    definition:
      "Le débit maximal que ton service tient tout en respectant tes objectifs, par exemple un p95 sous 300 ms et moins de 1 % d'erreurs.",
  },
  confidence: {
    label: "Niveau de confiance",
    definition:
      "Indique à quel point un constat est solide : élevé quand plusieurs indicateurs concordent, faible quand il repose sur un seul indicateur ou sur peu de données.",
  },
    dns: {
    label: "Résolution DNS",
    definition:
      "Le temps pour transformer le nom du site (exemple.com) en adresse IP. Il est souvent nul quand l'adresse est déjà connue.",
    example: "DNS = 4 ms : l'adresse a été trouvée presque instantanément.",
  },
  connect: {
    label: "Connexion TCP",
    definition:
      "Le temps pour établir la connexion avec le serveur (un aller-retour réseau). Il est nul quand une connexion existante est réutilisée.",
  },
  tls: {
    label: "Négociation TLS",
    definition:
      "Le temps pour mettre en place le chiffrement d'une connexion HTTPS : échange du certificat et des clés. Il n'existe que pour les adresses https://.",
  },
  ttfb: {
    label: "Attente du serveur (TTFB)",
    definition:
      "Time To First Byte : le temps entre l'envoi de la requête et l'arrivée du premier octet de la réponse. Il comprend le traitement côté serveur.",
    example: "TTFB = 32 ms sur 71 ms : près de la moitié du temps est passée à attendre le serveur.",
  },
  transfer: {
    label: "Transfert",
    definition:
      "Le temps pour télécharger le corps de la réponse une fois qu'elle a commencé à arriver. Il grandit avec la taille de la réponse.",
  },
    healthyThroughput: {
    label: "Débit maximal sain",
    definition:
      "Le plus haut débit observé pendant lequel tes objectifs (p95, taux d'erreur) étaient encore respectés.",
  },
  saturationPoint: {
    label: "Seuil de saturation",
    definition:
      "Le débit à partir duquel tes objectifs ne sont plus respectés. C'est une estimation, encadrée par les mesures du test.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryTerm = keyof typeof GLOSSARY;