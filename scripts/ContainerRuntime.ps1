function Get-ComposeCommand {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($docker) {
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) {
            return @('docker', 'compose')
        }
    }

    $podman = Get-Command podman -ErrorAction SilentlyContinue
    if ($podman) {
        & podman info *> $null
        if ($LASTEXITCODE -eq 0) {
            & podman compose version *> $null
            if ($LASTEXITCODE -eq 0) {
                return @('podman', 'compose')
            }
            throw 'Podman est actif, mais la commande « podman compose » n’est pas disponible. Installez un fournisseur Compose compatible (podman-compose ou docker-compose).'
        }
    }

    throw 'Aucun moteur de conteneurs actif. Démarrez Docker Desktop ou exécutez « podman machine start ».'
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $compose = Get-ComposeCommand
    & $compose[0] $compose[1] @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "La commande $($compose -join ' ') a échoué (code $LASTEXITCODE)."
    }
}
