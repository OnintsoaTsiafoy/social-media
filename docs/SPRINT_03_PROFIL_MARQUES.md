# Sprint 03 — profil, marques et paramètres IA

Cette livraison applique la tranche Sprint 03 de la [spécification PostgreSQL/Prisma](../sprint_listing/APIS/07_POSTGRESQL_PRISMA.md), sans anticiper les comptes sociaux, publications ou commentaires.

## Persistance

La migration `20260804000000_profile_brands` ajoute `phone`, `preferences` et la référence d'avatar à `users`, puis crée :

| Table | Rôle |
|---|---|
| `brands` | Identité de marque, propriétaire, statut et archivage logique. |
| `brand_members` | Appartenance et rôle `OWNER`, `ADMIN`, `COMMUNITY_MANAGER` ou `VIEWER`. Une seule marque active par utilisateur est garantie par un index partiel. |
| `brand_ai_settings` | Versions immuables des règles IA ; la version la plus récente est la configuration courante. |
| `media` | Métadonnées privées d'un avatar ou d'un média métier. |

Le seed crée aussi la marque active **Studio Vega** pour `lea@studio-vega.fr`.

## API livrée

- `GET/PATCH /api/v1/profile`
- `POST/DELETE /api/v1/profile/avatar`
- `GET/PATCH /api/v1/profile/preferences`
- `GET/POST /api/v1/brands`
- `GET/PATCH/DELETE /api/v1/brands/{brandId}`
- `POST /api/v1/brands/{brandId}/activate`
- `GET/PATCH /api/v1/brands/{brandId}/ai-settings`

Toutes ces routes exigent une session. Une marque étrangère retourne `404`, afin de ne pas révéler son existence. La modification de marque et des paramètres IA exige `OWNER` ou `ADMIN`; l'archivage exige `OWNER`.

Une mise à jour IA exige `expectedVersion`. Elle crée une nouvelle version, sans modifier l'historique. Une double soumission ou une sauvegarde à partir d'une version périmée retourne `409 version_conflict`; l'écran bloque aussi le second appui pendant la première requête.

## Mobile

Les écrans existants `/profile` et `/settings/brand` utilisent désormais l'API Express. La session recharge la marque active au démarrage. L'écran de marque gère l'état sans marque et permet d'en créer une, sans créer de nouvel écran. Il expose le ton, la formalité, les termes interdits et recommandés, et les consignes plainte, urgence et support.

## Règles de suppression et avatar

Supprimer une marque l'archive : elle n'est plus accessible ni active, tandis que les données restent disponibles pour l'audit et les futurs sprints. Il n'y a pas de suppression physique.

`POST /profile/avatar` enregistre uniquement les métadonnées d'un objet déjà déposé sous `avatars/{userId}/…` dans le bucket privé. Le dépôt binaire direct et les URL signées MinIO ne sont pas introduits ici, car le flux média complet est prévu avec le Sprint 04. L'écran mobile ne prétend donc pas encore téléverser un fichier.

## Vérification locale

Après avoir installé un provider Compose pour Podman :

```powershell
.\scripts\start.ps1
.\scripts\seed.ps1
.\scripts\verify-readiness.ps1
```

Scénario manuel : se connecter avec `lea@studio-vega.fr` / `ChangeMe123!`, modifier le profil, ouvrir **Marque & ton IA**, modifier un terme et enregistrer. Recharger l'écran : la nouvelle version et les données doivent être conservées. Créer une seconde marque, l'activer, puis vérifier que les paramètres de la première ne sont plus affichés dans le contexte actif.

Les tests unitaires API, la validation Prisma, le contrôle TypeScript et le lint mobile sont exécutés avant la clôture. La migration et ce scénario E2E restent à exécuter dès que `podman compose` est disponible sur le poste local.
