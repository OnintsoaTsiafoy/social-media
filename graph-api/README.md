# Graph API

Service FastAPI qui fait office de passerelle Meta (Facebook aujourd'hui,
Instagram au Sprint 07) pour Hootly. Le mobile ne l'appelle jamais
directement : seuls Express (`services/api`) et le worker (`services/worker`)
y accèdent, via `/internal/v1` (JWT de service) ou en interne au réseau
Compose pour `/health`/`/ready`.

## Prérequis

- Python 3.8 ou supérieur
- pip (gestionnaire de packages Python)

## Installation

### 1. Créer un environnement virtuel Python

#### Sur Windows (PowerShell)
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

#### Sur macOS et Linux
```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. Installer les dépendances

```bash
pip install -r requirements.txt
```

### 3. Configurer l'environnement

Copier `.env.example` vers `.env` et renseigner au minimum `SERVICE_JWT_SECRET`
(même valeur que celle donnée à `services/api`/`services/worker` sous
Compose). `FACEBOOK_APP_ID`/`FACEBOOK_PAGE_ID`/`FACEBOOK_PAGE_ACCESS_TOKEN`
sont optionnels pour démarrer (`/health` ne dépend jamais de Meta) mais
requis pour que `/ready` et les routes Facebook répondent autre chose que
`503 meta_configuration_missing`.

## Lancer l'application

```bash
uvicorn main:app --reload
```

L'application est disponible sur **http://127.0.0.1:8000** ; Swagger UI sur
`/docs`, ReDoc sur `/redoc`, OpenAPI brut sur `/openapi.json`. Le contrat
`/internal/v1` maintenu à la main est dans
[`contracts/openapi/social-internal.yaml`](../contracts/openapi/social-internal.yaml)
à la racine du dépôt.

## Tests

```bash
python -m pytest -q
```

Toutes les requêtes Meta sont interceptées par `respx` (aucun test
n'effectue de vrai appel réseau vers Facebook) — voir `tests/conftest.py`
pour les fixtures (`client`, `configured_settings`, `service_jwt_settings`,
`make_service_jwt`).

## Structure du projet

```
graph-api/
├── main.py                        # App FastAPI : middlewares, gestionnaires d'erreurs, montage des routeurs
├── core/
│   ├── config.py                  # Settings (Meta, JWT de service, timeouts, CORS)
│   ├── exceptions.py               # GraphAPIError + table de codes stables
│   ├── security.py                 # Dépendance require_service_jwt (audience social-service)
│   ├── middleware.py                # RequestIdMiddleware (x-request-id)
│   └── rate_limit.py                 # Limiter slowapi (120/min par défaut)
├── api/routes/
│   ├── health.py                   # /health, /ready
│   ├── facebook_routes.py           # Routes historiques /facebook/* (conservées, durcies)
│   └── internal_routes.py           # /internal/v1/* protégées par JWT de service
├── modules/facebook/
│   ├── clients/facebook_client.py    # Seul point d'appel HTTP vers Meta
│   ├── schemas/                     # Modèles Pydantic (dont pagination.py, internal.py)
│   └── services/                    # Logique métier par ressource, réutilisée par /facebook/* et /internal/v1
├── legacy/                          # Anciens proxies Java, hors runtime — voir legacy/README.md
├── tests/                           # pytest + respx (aucun appel Meta réel)
└── requirements.txt
```

## Sécurité

- `/health` ne dépend jamais de la configuration Meta ; `/ready` reflète
  `settings.meta_configured`.
- `/facebook/*` reste disponible pour compatibilité mais n'est protégé par
  aucun JWT — c'est un legs du Sprint 01-04. Les nouveaux appels
  inter-services doivent passer par `/internal/v1`, qui exige
  `Authorization: Bearer <JWT de service>` avec `aud=social-service` et
  `type=service` (voir `core/security.py`). Un JWT mobile/utilisateur y est
  toujours refusé.
- `access_token` n'est jamais écrit dans un log (`modules/facebook/clients/facebook_client.py::_redact_url`).
- `Idempotency-Key` est obligatoire sur `/internal/v1/publications/publish` et
  `/internal/v1/comments/reply` ; le cache est en mémoire process jusqu'au
  Sprint 06 (table `service_idempotency_keys` en base), donc non partagé
  entre replicas et non résilient à un redémarrage — limite documentée, pas
  un oubli.
