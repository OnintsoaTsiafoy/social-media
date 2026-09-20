[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

Push-Location graph-api
try {
    python -m pytest -q
}
finally {
    Pop-Location
}

# Sprint 09/10. Comme graph-api, ce service a besoin de son propre
# environnement virtuel (scikit-learn, langgraph) : `python -m venv venv`,
# activation, puis `pip install -r requirements.txt`.
Push-Location services/ai-service
try {
    python -m pytest -q
}
finally {
    Pop-Location
}

npm --prefix services/api test
npm --prefix services/worker test
npm --prefix social-media run typecheck
npm --prefix social-media run lint

# Console d'administration web : `cd admin-web; npm install` au préalable.
npm --prefix admin-web run typecheck
npm --prefix admin-web run lint
npm --prefix admin-web test
