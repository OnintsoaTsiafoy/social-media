[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Ne supprime pas les volumes : les données locales restent récupérables.
docker compose --env-file .env -f compose.yaml down
