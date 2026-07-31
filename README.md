# Hootly — socle d'intégration

Ce dépôt regroupe l'application mobile Expo, la passerelle sociale FastAPI et les services préparés au Sprint 01.

## Démarrage local

1. Copiez `.env.example` vers `.env` et remplacez les valeurs d'exemple pour tout environnement partagé.
2. Installez les dépendances du mobile : `npm --prefix social-media install`.
3. Installez les dépendances de l'API : `npm --prefix services/api install`.
4. Démarrez l'infrastructure : `./scripts/start.ps1`.
5. Lancez le mobile séparément : `npm --prefix social-media start`.

Les sondes sont disponibles sur `http://localhost:3000/health` (API), `:3001/health` (worker), `:8000/health` (Social) et `:8080/health` (IA). Le `ready` de Social retourne volontairement `503` tant qu'aucun compte Meta local n'est configuré.

Pour la vérification : `./scripts/verify-readiness.ps1`, puis `./scripts/test.ps1`.

## Documentation

- [Inventaire réel](docs/INVENTAIRE_ETAT_REEL.md)
- [Décisions d'architecture](docs/DECISIONS_ARCHITECTURE.md)
- [Contrats API](docs/CONTRATS_API.md)
- [Matrice écran → endpoint](docs/MATRICE_ECRAN_ENDPOINT.md)
- [Matrice endpoint → sprint](docs/MATRICE_ENDPOINT_SPRINT.md)
- [Risques et décisions ouvertes](docs/RISQUES_DECISIONS_OUVERTES.md)
- [Validation manuelle du Sprint 01](docs/VALIDATION_SPRINT_01.md)
