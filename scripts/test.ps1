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

npm --prefix services/api test
npm --prefix social-media run typecheck
npm --prefix social-media run lint
