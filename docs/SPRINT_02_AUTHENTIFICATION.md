# Sprint 02 — PostgreSQL, Prisma et authentification

## Tables migrées

La migration `20260731000000_auth_initial` crée la tranche de persistance requise par le Sprint 02, en suivant [la spécification PostgreSQL/Prisma](../sprint_listing/APIS/07_POSTGRESQL_PRISMA.md).

| Table | Contenu |
|---|---|
| `users` | Identité, email unique, hash bcrypt, langue, fuseau, statut et dates. Les champs de profil sont dans cette table, conformément à la spécification. |
| `user_sessions` | Sessions par appareil, hash du refresh token, expiration, révocation, remplacement et dernière utilisation. |
| `password_reset_tokens` | Token de réinitialisation hashé, expiration et usage unique. |
| `audit_logs` | Événements d’authentification et modifications sensibles, avec `requestId`. |

Les tables `brands`, comptes sociaux, médias, publications, commentaires, IA, notifications et métriques sont volontairement reportées à leurs sprints respectifs. Elles sont listées dans la spécification source mais ne sont pas nécessaires pour une migration d’authentification isolée.

## Endpoints livrés

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/change-password`

L’access token est un JWT court ; le refresh token est opaque, rotatif et seul son hash bcrypt est conservé. La réutilisation d’un refresh token révoqué révoque les sessions actives de l’utilisateur. Chaque endpoint sensible utilise validation Zod, enveloppes d’erreur stables, rate limiting et audit.

## Mobile

Les écrans d’inscription, connexion, oubli/réinitialisation de mot de passe, le splash et la déconnexion utilisent l’API réelle. Les access et refresh tokens sont conservés dans SecureStore (ou `sessionStorage` sur web) et l’intercepteur HTTP effectue une seule tentative de refresh avant de déconnecter l’utilisateur.

## Initialisation locale

Après avoir démarré Docker Desktop :

```powershell
Copy-Item .env.example .env
Copy-Item social-media/.env.example social-media/.env
.\scripts\start.ps1
.\scripts\seed.ps1
```

Le seed crée uniquement `lea@studio-vega.fr` avec le mot de passe `ChangeMe123!` pour une démonstration locale.

## Limite explicitement suivie

Le token de réinitialisation est créé, hashé et expirant, mais aucun fournisseur d’email n’a été choisi ni configuré. Il n’est donc jamais retourné ni journalisé. L’envoi réel du lien nécessite la sélection d’un fournisseur et d’un domaine expéditeur ; cette décision ne doit pas être supposée dans le code.
