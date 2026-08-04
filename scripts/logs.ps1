[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Service
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ContainerRuntime.ps1')

$composeArguments = @('--env-file', '.env', '-f', 'compose.yaml', 'logs', '--follow')
$composeArguments += $Service
Invoke-Compose -Arguments $composeArguments
