[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ContainerRuntime.ps1')

if (-not (Test-Path -LiteralPath '.env')) {
    throw 'Créez .env à partir de .env.example, puis remplacez les valeurs d’exemple avant de démarrer.'
}

Invoke-Compose -Arguments @('--env-file', '.env', '-f', 'compose.yaml', 'up', '--build', '--detach')
Invoke-Compose -Arguments @('--env-file', '.env', '-f', 'compose.yaml', 'ps')
