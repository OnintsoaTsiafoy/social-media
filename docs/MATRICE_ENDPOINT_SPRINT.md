# Matrice endpoint → sprint

| Sprint | Routes / contrat livrés |
|---:|---|
| 01 | `GET /health`, `GET /ready`, `GET /openapi.json` sur les services socle ; conventions d'enveloppes et erreurs |
| 02 | `/api/v1/auth/*` et contrat session utilisateur |
| 03 | `/api/v1/profile*`, `/api/v1/brands*`, paramètres IA |
| 04 | `/api/v1/publications*`, `/api/v1/media*`, calendrier et scheduler |
| 05 | `/internal/v1` Social protégé, pagination Facebook, health/readiness social consolidés |
| 06 | `/api/v1/social-accounts/*`, callbacks OAuth et gestion des jetons |
| 07 | publication, commentaires et métriques Instagram via Social |
| 08 | webhooks Meta, `/api/v1/comments*` et réponses sociales contrôlées |
| 09 | `/internal/v1/comments/analyze`, `/internal/v1/models/info`, actions d'analyse |
| 10 | workflows LangGraph, suggestions de réponses et hashtags |
| 11 | Socket.IO, `/api/v1/notifications*` et préférences |
| 12 | `/api/v1/analytics/*` et `/api/v1/dashboard` |
| 13 | branchement effectif de l'ensemble des écrans sur ces contrats |
| 14 | durcissement, documentation finale et endpoints d'exploitation protégés |
