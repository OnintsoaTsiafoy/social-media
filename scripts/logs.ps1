[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Service
)

$ErrorActionPreference = 'Stop'

docker compose --env-file .env -f compose.yaml logs --follow @Service
