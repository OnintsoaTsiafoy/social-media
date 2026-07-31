[CmdletBinding()]
param(
    [switch]$RequireMeta
)

$ErrorActionPreference = 'Stop'

function Assert-Status {
    param(
        [string]$Url,
        [int[]]$ExpectedStatus
    )

    $response = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.Method = 'GET'
        $response = [System.Net.HttpWebResponse]$request.GetResponse()
    }
    catch [System.Net.WebException] {
        $response = [System.Net.HttpWebResponse]$_.Exception.Response
        if ($null -eq $response) {
            throw "Impossible de joindre $Url : $($_.Exception.Message)"
        }
    }

    try {
        $statusCode = [int]$response.StatusCode
        if ($statusCode -notin $ExpectedStatus) {
            throw "$Url a retourné HTTP $statusCode, attendu : $($ExpectedStatus -join ', ')."
        }

        Write-Host "OK $statusCode $Url"
    }
    finally {
        $response.Dispose()
    }
}

Assert-Status 'http://localhost:3000/health' 200
Assert-Status 'http://localhost:3000/ready' 200
Assert-Status 'http://localhost:3001/health' 200
Assert-Status 'http://localhost:3001/ready' 200
Assert-Status 'http://localhost:8000/health' 200
$metaReadyStatuses = if ($RequireMeta) { @(200) } else { @(200, 503) }
Assert-Status 'http://localhost:8000/ready' $metaReadyStatuses
Assert-Status 'http://localhost:8080/health' 200
Assert-Status 'http://localhost:8080/ready' 200

Write-Host 'Les sondes Sprint 01 sont valides.'
