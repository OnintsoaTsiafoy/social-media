[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ContainerRuntime.ps1')

Invoke-Compose -Arguments @('--env-file', '.env', 'exec', 'api', 'npm', 'run', 'prisma:seed')
