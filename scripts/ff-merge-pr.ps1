#!/usr/bin/env pwsh
# Fast-forward merge a GitHub PR, preserving commit signatures: verifies CI is
# green and the head is a strict fast-forward of base, then pushes head onto base.
#   ./scripts/ff-merge-pr.ps1 3
#   ./scripts/ff-merge-pr.ps1 3 -DryRun
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [int]$PullRequest,

    [string]$Remote = 'origin',

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

$repo = gh repo view --json nameWithOwner --jq '.nameWithOwner'
Write-Host "$repo via remote '$Remote'"

$pr = gh pr view "$PullRequest" --repo $repo --json 'number,state,isDraft,headRefOid,baseRefName,title' | ConvertFrom-Json

Write-Host "PR #$($pr.number): $($pr.title)"
Write-Host "  -> $($pr.baseRefName)"

if ($pr.state -ne 'OPEN') { throw "PR state is $($pr.state), expected OPEN." }
if ($pr.isDraft) { throw 'PR is a draft.' }

# Nonzero exit covers failing, pending, and no-checks; gh names the offenders.
gh pr checks "$PullRequest" --repo $repo

$headSha = $pr.headRefOid
$short = $headSha.Substring(0, 8)

# refs/pull/<n>/head also covers PRs from forks. Base goes into its tracking
# ref so the comparison below sees the remote's current base, not stale local.
$baseRef = "$Remote/$($pr.baseRefName)"
git fetch $Remote "refs/pull/$PullRequest/head" "+$($pr.baseRefName):refs/remotes/$baseRef" | Out-Null

& { $PSNativeCommandUseErrorActionPreference = $false; git merge-base --is-ancestor $baseRef $headSha }
if ($LASTEXITCODE -ne 0) { throw "$baseRef is not an ancestor of $short; not a fast-forward. Rebase the branch first." }
Write-Host "  fast-forward: $short is ahead of $baseRef" -ForegroundColor Green

if ($DryRun) {
    Write-Host "dry run: would push $short -> $baseRef" -ForegroundColor Yellow
    exit 0
}

# ponytail: if the contributor pushes between the check above and here, the
# verified commit still lands but the PR stays open; re-push or close by hand.
git push $Remote "${headSha}:refs/heads/$($pr.baseRefName)" | Out-Null
Write-Host "PR #$PullRequest merged: $short -> $baseRef" -ForegroundColor Green
