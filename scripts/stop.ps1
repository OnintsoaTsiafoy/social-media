[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ContainerRuntime.ps1')

# Ne supprime pas les volumes : les données locales restent récupérables.
Invoke-Compose -Arguments @('--env-file', '.env', '-f', 'compose.yaml', 'down')
