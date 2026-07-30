# Graph API

Application FastAPI pour la publication sur Facebook et Instagram.

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

#### Sur Windows (CMD)
```cmd
python -m venv venv
venv\Scripts\activate.bat
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

## Lancer l'application

### Avec rechargement automatique (développement)
```bash
uvicorn main:app --reload
```

### Sans rechargement automatique (production)
```bash
uvicorn main:app
```

L'application sera disponible à : **http://127.0.0.1:8000**

## Documentation interactive

Accédez à la documentation Swagger UI : **http://127.0.0.1:8000/docs**

Accédez à la documentation ReDoc : **http://127.0.0.1:8000/redoc**

## Structure du projet

```
graph-api/
├── main.py              # Application FastAPI
├── requirements.txt     # Dépendances Python
├── README.md           # Ce fichier
└── venv/               # Environnement virtuel
``` 

