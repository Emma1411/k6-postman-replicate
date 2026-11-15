## Déploiement sur Google Cloud Run

Pourquoi ces réglages
--max-instances 1 : le registre des tests de charge et la limitation de débit sont en mémoire.
SSE et non WebSocket : fonctionne sur Cloud Run sans configuration spéciale.
Facturation à la requête (défaut) : le CPU n'est alloué que pendant une requête ouverte. Un test de charge est suivi par un flux SSE ouvert, donc il dispose du CPU. Sans client, le test est détaché après 30 secondes puis interrompu.
--timeout doit dépasser la durée maximale d'un test (120 secondes par défaut) ; 900 secondes laisse de la marge.
Commandes
bash
gcloud auth login
gcloud config set project PROJECT_ID

gcloud run deploy api-engineering-platform \
  --source . \
  --region REGION \
  --port 8080 \
  --cpu 1 --memory 1Gi \
  --min-instances 0 --max-instances 1 \
  --concurrency 40 \
  --timeout 900 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,DEPLOYMENT_MODE=public,TRUSTED_PROXY_HOPS=1,APP_VERSION=1.0.0"


--source . construit l'image avec le Dockerfile. Vérifie les quotas gratuits actuels sur la page de tarification officielle de Cloud Run avant de t'y fier : ils changent et dépendent de la région.

Protection contre les robots automatisés (Turnstile)

La protection anti-robots utilise Cloudflare Turnstile et un laissez-passer signé par HMAC.

Les secrets ne doivent jamais être transmis avec --set-env-vars. Ils sont stockés dans Google Secret Manager et injectés directement dans les variables d'environnement du conteneur.

1. Créer les secrets

Récupère la clé secrète Turnstile depuis le tableau de bord Cloudflare.

bash
printf '%s' "$TURNSTILE_SECRET" \
  | gcloud secrets create turnstile-secret --data-file=-


Génère ensuite une clé HMAC cryptographiquement aléatoire :

bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" \
  | gcloud secrets create bot-token-secret --data-file=-


Conserve ces secrets dans Secret Manager. Ne les ajoute jamais au dépôt Git, aux fichiers .env versionnés ou aux commandes --set-env-vars.

2. Créer un compte de service dédié
bash
gcloud iam service-accounts create api-engineering-platform \
  --display-name="API Engineering Platform Cloud Run"


Définis son adresse :

bash
PROJECT_ID=$(gcloud config get-value project)
SERVICE_ACCOUNT="api-engineering-platform@${PROJECT_ID}.iam.gserviceaccount.com"

3. Autoriser l'accès aux secrets

Le compte de service utilisé par Cloud Run doit posséder le rôle roles/secretmanager.secretAccessor sur chacun des deux secrets.

bash
for SECRET in turnstile-secret bot-token-secret; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
done


Cette permission permet au service de lire les secrets au démarrage.

4. Déployer avec les secrets injectés

Remplace TA_CLE_DE_SITE par la clé publique fournie par Cloudflare Turnstile.

bash
gcloud run deploy api-engineering-platform \
  --source . \
  --region REGION \
  --service-account "$SERVICE_ACCOUNT" \
  --port 8080 \
  --cpu 1 --memory 1Gi \
  --min-instances 0 --max-instances 1 \
  --concurrency 40 \
  --timeout 900 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,DEPLOYMENT_MODE=public,TRUSTED_PROXY_HOPS=1,APP_VERSION=1.0.0,BOT_PROTECTION=turnstile,TURNSTILE_SITE_KEY=TA_CLE_DE_SITE" \
  --set-secrets "TURNSTILE_SECRET_KEY=turnstile-secret:latest,BOT_TOKEN_SECRET=bot-token-secret:latest"


Les deux secrets sont injectés par Cloud Run. Ils ne sont pas exposés dans les paramètres publics du déploiement.

5. Vérifier la configuration

Vérifie que le service a démarré correctement :

bash
gcloud run services describe api-engineering-platform \
  --region REGION \
  --format="yaml(status.conditions)"


Vérifie également que les variables publiques sont configurées sans afficher les secrets :

bash
gcloud run services describe api-engineering-platform \
  --region REGION \
  --format="yaml(spec.template.spec.containers[0].env)"


Teste ensuite le parcours utilisateur :

Une requête vers une route protégée sans laissez-passer doit répondre 403 CHALLENGE_REQUIRED.
La résolution de Turnstile doit permettre d'obtenir le cookie.
Une requête avec un cookie valide doit être autorisée.
Un cookie expiré ou lié à une autre adresse réseau doit être refusé.
Vérifier TRUSTED_PROXY_HOPS

Une mauvaise valeur permet de contourner la limitation par IP (valeur trop faible : tout le monde partage une IP ; trop élevée : l'IP est falsifiable).

Redéploie temporairement avec LOG_LEVEL=debug.
Appelle l'API avec une IP falsifiée :
bash
curl -H "X-Forwarded-For: 1.2.3.4" https://SERVICE_URL/api/config

Dans les logs, la ligne « Client identifié » doit montrer ton IP publique, pas 1.2.3.4.
Si c'est 1.2.3.4, vérifie le nombre réel de proxys avant de modifier TRUSTED_PROXY_HOPS.
Remets LOG_LEVEL=info.
Coûts et abus

Configure une alerte de budget (Cloud Billing) avant d'ouvrir l'URL.

Une instance publique peut être utilisée par des inconnus : baisse LOAD_MAX_VUS, LOAD_MAX_RPS et LOAD_MAX_DURATION_SECONDS si besoin.