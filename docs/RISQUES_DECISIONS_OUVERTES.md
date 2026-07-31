# Risques et décisions ouvertes — Sprint 01

## Aucun blocage P0 pour le Sprint 02

Les choix de structure, persistance, worker, stockage média et périmètre MVP sont consignés dans [DECISIONS_ARCHITECTURE.md](DECISIONS_ARCHITECTURE.md). Le contrat d'authentification est figé dans [CONTRATS_API.md](CONTRATS_API.md).

## Risques suivis

| Risque | Niveau | Prévention / sprint propriétaire |
|---|---|---|
| Ancien audit PDF absent | Moyen | Code comme source de vérité ; tests de caractérisation au Sprint 05. |
| Permissions Meta non confirmées | Élevé | Vérification officielle et App Review au Sprint 06/07, sans hypothèse dans le code. |
| Décalage modèle mobile / API cible | Moyen | Matrice écran → endpoint ; adaptateur HTTP explicite avant retrait des mocks au Sprint 13. |
| Double publication ou réponse | Élevé | Idempotency-Key, jobs persistants et tests de concurrence aux Sprints 04 et 08. |
| Secrets présents dans un environnement partagé | Élevé | `.env` ignoré, exemples non sensibles, scan et revue au Sprint 14. |
| Docker absent de la machine de développement | Moyen | Installer Docker Desktop avant la recette Compose ; scripts de vérification fournis. |

## Décisions à revalider avant production

- Version Graph API supportée, permissions, formats, limites et callbacks Meta.
- Fournisseur et méthode d'inférence IA après les résultats reproductibles du Sprint 09.
- Politique finale de conservation des médias, événements webhook et journaux d'audit.
