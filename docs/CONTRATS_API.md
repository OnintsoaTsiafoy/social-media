# Contrats API initiaux — Sprint 01

Les contrats sont versionnés. Les routes mobiles publiques commencent par `/api/v1`; les routes interservices par `/internal/v1`. Les sondes `/health`, `/ready` et `/openapi.json` sont hors versionnement.

## Enveloppes JSON

Une réponse métier réussie suit la forme suivante :

```json
{
  "data": {},
  "meta": { "requestId": "req_01H..." }
}
```

Une liste paginée utilise :

```json
{
  "data": [],
  "page": { "limit": 20, "nextCursor": "opaque-or-null", "previousCursor": null },
  "meta": { "requestId": "req_01H..." }
}
```

Une erreur suit toujours :

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Les données envoyées ne sont pas valides.",
    "details": [{ "field": "email", "code": "invalid_format" }],
    "requestId": "req_01H..."
  }
}
```

`/health` et `/ready` sont des exceptions délibérées : ils retournent directement `{ "status", "service" }` afin de rester utilisables par les orchestrateurs.

## Codes d'erreur stables

| HTTP | Code | Usage |
|---:|---|---|
| 400 | `validation_failed` | corps, paramètre ou transition invalide |
| 401 | `authentication_required` / `token_expired` | absence ou invalidité de jeton |
| 403 | `forbidden` | utilisateur, marque ou service non autorisé |
| 404 | `not_found` | ressource inconnue ou non accessible |
| 409 | `conflict` / `idempotency_conflict` | doublon ou transition concurrente |
| 422 | `unprocessable` | règle métier non satisfaite |
| 429 | `rate_limited` | limite atteinte ; inclure `Retry-After` |
| 502/503/504 | `provider_unavailable` | dépendance sociale, IA ou file de travaux indisponible |

Codes métier ajoutés au Sprint 04 :

| HTTP | Code | Usage |
|---:|---|---|
| 409 | `media_in_use` | média rattaché à une publication ou utilisé comme avatar |
| 409 | `idempotency_conflict` | même `Idempotency-Key` réutilisée avec un autre corps, ou commande déjà en cours |
| 413 | `media_too_large` | fichier au-delà de la taille autorisée |
| 415 | `media_type_not_allowed` | type réel hors JPEG, PNG et WebP (ADR-08) |
| 422 | `media_not_ready` | média introuvable, supprimé ou pas encore disponible |
| 503 | `storage_unavailable` | stockage objet non configuré ou injoignable |

Codes métier ajoutés aux Sprints 09 et 10 :

| HTTP | Code | Usage |
|---:|---|---|
| 503 | `ai_unavailable` | service d'analyse ou de génération injoignable, modèles non entraînés, ou mode de modèle non supporté. Distinct de `provider_unavailable`, réservé aux dépendances sociales : le mobile a un message propre à l'IA (« saisissez le texte manuellement »). Traduit par `lib/aiServiceClient.js` à partir des codes internes `ai_error` et `provider_unavailable`. |
| 409 | `conflict` | proposition de réponse bloquée par le contrôle de sécurité, déjà envoyée ou rejetée ; envoi demandé sans approbation préalable |

## Authentification à figer au Sprint 02

- `POST /api/v1/auth/register`, `login`, `refresh`, `logout`, `forgot-password`, `reset-password`, `change-password` ; `GET /api/v1/auth/me`.
- L'access token est court et envoyé en `Authorization: Bearer <token>`.
- Le refresh token est rotatif, stocké uniquement dans SecureStore côté mobile et sous forme de hash en base. Il n'est jamais journalisé.
- Toute ressource de marque vérifie l'appartenance et le rôle côté API, sans faire confiance à un `brandId` envoyé seul par le client.

Les schémas OpenAPI de départ sont dans `contracts/openapi/`. Ils sont le point de départ du Sprint 02 ; ils ne rendent pas les endpoints métier déjà implémentés.

## Contrats interservices

- `Authorization: Bearer <service-jwt>` obligatoire sur `/internal/v1`.
- Le JWT contient un `aud` correspondant au service cible, des scopes minimaux et un identifiant de requête propagé.
- Les commandes à effet de bord portent une `Idempotency-Key` et un `socialAccountId`; aucun token Meta brut ne traverse l'API publique.
- **Sprint 11** : Firebase Cloud Messaging remplace le plan Socket.IO du Sprint 01 (`contracts/socket-events.yaml`, désormais obsolète — conservé pour le vocabulaire des types, pas pour son mécanisme de transport). Le payload FCM est un message *data-only* (jamais de bloc `notification` — c'est le client qui affiche, jamais l'OS directement, pour rester cohérent premier plan/arrière-plan/fermé) : `{ version, eventId, type, notificationId, resourceType, resourceId, brandId }`, toutes les valeurs en chaîne. Il ne transporte aucune donnée métier : le client recharge la ressource via `/api/v1/notifications` avant d'agir. Voir `services/api/src/notifications/push.js`.

La correspondance endpoint → sprint est détaillée dans [MATRICE_ENDPOINT_SPRINT.md](MATRICE_ENDPOINT_SPRINT.md).
