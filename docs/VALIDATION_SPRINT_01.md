# Validation manuelle — Sprint 01

## Prérequis

- Docker Desktop installé et démarré.
- Node.js 20.19.4 ou supérieur pour le mobile.
- Une copie locale de `.env.example` vers `.env` ; ne pas committer ce fichier.

## Scénario

1. Exécuter `./scripts/start.ps1` à la racine.
2. Exécuter `./scripts/verify-readiness.ps1`.
3. Vérifier que `http://localhost:3000/openapi.json`, `http://localhost:8000/openapi.json` et `http://localhost:8080/openapi.json` répondent.
4. Vérifier que `GET http://localhost:8000/ready` retourne `503` et `meta_configuration_missing` sans variables Meta. C'est le résultat attendu, pas une panne.
5. Vérifier qu'une requête à `GET /facebook/posts` sans configuration retourne `503` sans tenter d'appeler Meta.
6. Lancer `npm --prefix social-media start` et contrôler l'ouverture du mobile sans régression visuelle.
7. Exécuter `./scripts/test.ps1`.

## Résultat attendu

- Tous les conteneurs sont démarrés ; chaque `/health` retourne `200`.
- API, worker et IA retournent `200` sur `/ready` avec la configuration Compose.
- Social retourne `503` tant qu'aucun compte Meta n'est paramétré, puis `200` lorsqu'il l'est.
- Aucun écran mobile n'est modifié ou recréé.
