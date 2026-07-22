#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

try {
    $repositoryRoot = $PSScriptRoot
    $sourceRoot = Join-Path $repositoryRoot 'skills'

    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
        throw "Canonical skill directory not found: $sourceRoot"
    }

    $canonicalSkills = @(
        Get-ChildItem -LiteralPath $sourceRoot -Directory |
            Where-Object { $_.Name -like 'planlet-*' } |
            Sort-Object Name
    )

    if ($canonicalSkills.Count -eq 0) {
        throw "No canonical planlet-* skill directories found in: $sourceRoot"
    }

    $destinationRoots = @(
        (Join-Path $repositoryRoot '.agents/skills'),
        (Join-Path $repositoryRoot '.claude/skills')
    )

    foreach ($destinationRoot in $destinationRoots) {
        New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null

        Get-ChildItem -LiteralPath $destinationRoot -Force |
            Where-Object { $_.Name -like 'planlet-*' } |
            Remove-Item -Recurse -Force

        foreach ($canonicalSkill in $canonicalSkills) {
            Copy-Item -LiteralPath $canonicalSkill.FullName -Destination $destinationRoot -Recurse
        }
    }

    $relativeDestinations = $destinationRoots | ForEach-Object {
        [System.IO.Path]::GetRelativePath($repositoryRoot, $_)
    }
    Write-Output "Synchronized $($canonicalSkills.Count) Planlet skills to $($relativeDestinations -join ', ')."
}
catch {
    Write-Error "Skill synchronization failed: $($_.Exception.Message)"
    exit 1
}
