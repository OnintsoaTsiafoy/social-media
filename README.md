# Hootly — socle d'intégration

Ce dépôt regroupe l'application mobile Expo, la passerelle sociale FastAPI et les services préparés au Sprint 01.

## Démarrage local

1. Copiez `.env.example` vers `.env` et remplacez les valeurs d'exemple pour tout environnement partagé.
2. Copiez `social-media/.env.example` vers `social-media/.env`, puis définissez `EXPO_PUBLIC_API_URL` pour votre émulateur ou appareil.
3. Installez les dépendances du mobile : `npm --prefix social-media install`.
4. Installez les dépendances de l'API : `npm --prefix services/api install`.
5. Démarrez l'infrastructure : `./scripts/start.ps1`.
6. Lancez le mobile séparément : `npm --prefix social-media start`.

Les sondes sont disponibles sur `http://localhost:3000/health` (API), `:3001/health` (worker), `:8000/health` (Social) et `:8080/health` (IA). Le `ready` de Social retourne volontairement `503` tant qu'aucun compte Meta local n'est configuré. Depuis le Sprint 04, le `ready` de l'API exige aussi la configuration du stockage média (`S3_ENDPOINT`, `MEDIA_BUCKET`), et l'état des files de travaux est visible sur `http://localhost:3001/internal/v1/jobs/health`.

Les médias sont stockés dans un bucket MinIO privé, créé au démarrage de l'API. Sur un téléphone ou un émulateur, adaptez `S3_PUBLIC_ENDPOINT` dans `.env` : c'est l'hôte utilisé pour signer les URL d'aperçu (`10.0.2.2` sur l'émulateur Android, l'IP LAN de la machine sur un appareil physique).

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
- [Profil et marques du Sprint 03](docs/SPRINT_03_PROFIL_MARQUES.md)
- [Publications, médias et scheduler du Sprint 04](docs/SPRINT_04_PUBLICATIONS_MEDIAS_SCHEDULER.md)
- [Collection Postman de l'API](contracts/hootly-api.postman_collection.json)
