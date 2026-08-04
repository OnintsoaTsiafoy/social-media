# Hootly — socle d'intégration

Ce dépôt regroupe l'application mobile Expo, la passerelle sociale FastAPI et les services préparés au Sprint 01.

## Démarrage local

1. Copiez `.env.example` vers `.env` et remplacez les valeurs d'exemple pour tout environnement partagé.
2. Copiez `social-media/.env.example` vers `social-media/.env`, puis définissez `EXPO_PUBLIC_API_URL` pour votre émulateur ou appareil.
3. Installez les dépendances du mobile : `npm --prefix social-media install`.
4. Installez les dépendances de l'API : `npm --prefix services/api install`.
5. Démarrez l'infrastructure : `./scripts/start.ps1`.
6. Lancez le mobile séparément : `npm --prefix social-media start`.

Les sondes sont disponibles sur `http://localhost:3000/health` (API), `:3001/health` (worker), `:8000/health` (Social) et `:8080/health` (IA). Le `ready` de Social retourne volontairement `503` tant qu'aucun compte Meta local n'est configuré.

Pour la vérification : `./scripts/verify-readiness.ps1`, puis `./scripts/test.ps1`.

Les scripts détectent automatiquement Docker ou Podman. Le conteneur API applique les migrations au démarrage. Créez ensuite le compte de démonstration :

```powershell
.\scripts\seed.ps1
```

## Documentation

- [Inventaire réel](docs/INVENTAIRE_ETAT_REEL.md)
- [Décisions d'architecture](docs/DECISIONS_ARCHITECTURE.md)
- [Contrats API](docs/CONTRATS_API.md)
- [Matrice écran → endpoint](docs/MATRICE_ECRAN_ENDPOINT.md)
- [Matrice endpoint → sprint](docs/MATRICE_ENDPOINT_SPRINT.md)
- [Risques et décisions ouvertes](docs/RISQUES_DECISIONS_OUVERTES.md)
- [Validation manuelle du Sprint 01](docs/VALIDATION_SPRINT_01.md)
- [Authentification du Sprint 02](docs/SPRINT_02_AUTHENTIFICATION.md)
