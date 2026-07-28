[CmdletBinding()]
param(
  [string]$ArtifactDirectory = "artifacts/closed-ai-phase1-1r5-2r1"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$artifactRoot = Join-Path $repositoryRoot $ArtifactDirectory
$results = [System.Collections.Generic.List[object]]::new()

function Read-Artifact {
  param([string]$Name)
  $path = Join-Path $artifactRoot $Name
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing artifact: $Name" }
  return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Assert-Result {
  param([string]$Name, [bool]$Passed, [string]$Detail)
  $results.Add([ordered]@{ name = $Name; passed = $Passed; detail = $Detail })
}

$environment = Read-Artifact "environment.json"
$bridge = Read-Artifact "bridge-startup.json"
$origin = Read-Artifact "origin-enrollment.json"
$forbidden = Read-Artifact "forbidden-arguments-audit.json"
$cleanup = Read-Artifact "cleanup.json"
$summary = Read-Artifact "full-regression-results.json"
$chromeLaunch = Read-Artifact "chrome-launch.json"
$edgeLaunch = Read-Artifact "edge-launch.json"

Assert-Result "interactive session detection" ($environment.session.interactive -eq $true -and $environment.session.currentProcessInInteractiveSession -eq $true) "Current process and Explorer share the interactive session."
Assert-Result "browser binary discovery" ($summary.chromeInstalled -eq $true -and $summary.edgeInstalled -eq $true) "Installed Chrome and Edge were discovered."
Assert-Result "Bridge startup ordering" ($bridge.status -eq "PASS" -and $bridge.launcherStart.exitCode -eq 0) "The harness started the formal Bridge before the browser gate."
Assert-Result "Bridge not-running fail-closed" ($summary.bridgePreflightPassed -eq $true) "Browser eligibility requires a passing Bridge preflight."
Assert-Result "Bridge loopback binding" ($bridge.listener.address -eq "127.0.0.1" -and $bridge.lanBind -eq $false) "Bridge listened only on IPv4 loopback."
Assert-Result "exact origin enrollment" ($origin.status -eq "PASS" -and $origin.wildcardAbsent -eq $true -and $origin.pathExcluded -eq $true -and $origin.queryExcluded -eq $true -and $origin.fragmentExcluded -eq $true) "Only the parsed Preview origin was enrolled."
Assert-Result "fresh profile isolation contract" ($summary.isolatedProfiles.shared -eq $false -and @($summary.isolatedProfiles.chromeGrant, $summary.isolatedProfiles.chromeDeny, $summary.isolatedProfiles.edgeGrant, $summary.isolatedProfiles.edgeDeny | Select-Object -Unique).Count -eq 4) "Four distinct profile paths are reserved."
Assert-Result "forbidden browser arguments" (@($forbidden.forbiddenArgumentsUsed).Count -eq 0 -and $forbidden.grantPermissionsUsed -eq $false -and $forbidden.cdpPermissionMutationUsed -eq $false) "No browser security or permission bypass was used."
Assert-Result "manual LNA pause remains required" ($summary.chromeLnaGrantFlow -eq "NOT_TESTED" -and $summary.edgeLnaGrantFlow -eq "NOT_TESTED") "No permission decision was injected or fabricated."
Assert-Result "browser channel launch truth" ($chromeLaunch.status -eq "NOT_TESTED" -and $edgeLaunch.status -eq "NOT_TESTED" -and $summary.verdict -eq "PHASE1_1R5_2R1_BLOCKED_BROWSER_CONTROL") "Unavailable browser control remains blocked, not passed."
Assert-Result "browser Bridge correlation truth" ($summary.previewRequestReachedBridge -eq "NO") "No preflight request was relabeled as Preview UI traffic."
Assert-Result "cleanup" ($cleanup.status -eq "PASS" -and $cleanup.portReleased -eq $true -and $cleanup.previewOriginRevoked -eq $true) "Bridge stopped and Preview origin was revoked."

$failed = @($results | Where-Object { -not $_.passed })
$report = [ordered]@{
  suite = "closed-ai-phase1-1r5-2r1-harness"
  executedAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = $results.Count - $failed.Count
  fail = $failed.Count
  results = $results
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $artifactRoot "harness-test-results.json") -Encoding utf8
$report | ConvertTo-Json -Depth 8
if ($failed.Count -gt 0) { exit 1 }
