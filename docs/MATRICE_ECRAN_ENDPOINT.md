# Matrice écran → endpoint

Cette matrice décrit la cible. L’authentification est connectée depuis le Sprint 02, les écrans profil/marque depuis le Sprint 03, et les écrans publications, média, planification et calendrier depuis le Sprint 04 ; les autres écrans conservent `src/data/api.ts` jusqu'au sprint indiqué. Aucun écran n'est recréé.

| Écran / route | Endpoint cible principal | Sprint |
|---|---|---:|
| Splash, inscription, connexion, oubli, reset | `/api/v1/auth/*` | 02 |
| Accueil | `/api/v1/dashboard` | 12 |
| Liste, création, détail, modification de publications | `/api/v1/publications` | 04 — connecté |
| Média | `/api/v1/media` | 04 — connecté |
| Planification et calendrier | `/api/v1/publications/{id}/schedule`, `/api/v1/calendar` | 04 — connecté |
| Hashtags | `/api/v1/publications/generate-hashtags` | 10 |
| Profil | `/api/v1/profile`, `/api/v1/profile/preferences` | 03 — connecté |
| Marque et ton IA | `/api/v1/brands`, `/api/v1/brands/{id}/ai-settings` | 03 — connecté |
| Comptes sociaux et callback OAuth | `/api/v1/social-accounts/*`, callback OAuth | 06 |
| Liste et détail des commentaires | `/api/v1/comments`, `/api/v1/comments/{id}` | 08 |
| Historique, statut, escalade | `/api/v1/comments/{id}/history`, `status`, `escalate` | 08 |
| Analyse et réponse IA | `/api/v1/comments/{id}/analyze`, `/api/v1/response-suggestions` | 09–10 |
| Centre et préférences de notifications | `/api/v1/notifications`, `/api/v1/notification-settings` + Socket.IO | 11 |
| Analytics global et détail publication | `/api/v1/analytics/*`, `/api/v1/dashboard` | 12 |
| Sécurité, suppression, mentions légales | endpoints compte au Sprint 02/14 ; contenu local | 02, 14 |

Les états chargement, erreur, vide et succès sont déjà structurés côté interface. Le client HTTP typé, l'intercepteur de refresh et le retrait définitif des mocks sont réservés au Sprint 13 pour éviter une migration fragmentée.
