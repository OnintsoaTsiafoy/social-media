[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath '.env')) {
    throw 'Créez .env à partir de .env.example, puis remplacez les valeurs d’exemple avant de démarrer.'
}

docker compose --env-file .env -f compose.yaml up --build --detach
docker compose --env-file .env -f compose.yaml ps
