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
- Les événements Socket.IO sont versionnés, possèdent `eventId`, `occurredAt`, `userId` et, si applicable, `brandId`.

La correspondance endpoint → sprint est détaillée dans [MATRICE_ENDPOINT_SPRINT.md](MATRICE_ENDPOINT_SPRINT.md).
