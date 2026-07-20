[CmdletBinding()]
param(
  [string]$TargetUrl = "https://novel-gw062wjeh-lqtechs-projects.vercel.app/studio/settings/ai",
  [string]$ProductCommit = "ddaa86e998c7492bf36f8b3ab51a360be6d8b3b7",
  [switch]$FullMatrix,
  [string]$ArtifactDirectory = "artifacts/closed-ai-phase1-1r5-2r1a",
  [string]$NodePath = "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path $repositoryRoot $ArtifactDirectory
$profileRoot = Join-Path $artifactRoot "browser-profiles"
$launcher = Join-Path $repositoryRoot "local-ai\bridge\launcher.mjs"
$browserEntry = Join-Path $repositoryRoot "scripts\r5-2-desktop\start-real-browser.ps1"
$runtimeRoot = Join-Path $env:LOCALAPPDATA "NovelLocalBridge"
$accessLog = Join-Path $runtimeRoot "access.jsonl"
$origin = ([Uri]$TargetUrl).GetLeftPart([UriPartial]::Authority)
$harnessCommit = (git -C $repositoryRoot rev-parse HEAD).Trim()
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$chromeVersion = (Get-Item $chromePath).VersionInfo.ProductVersion
$edgeVersion = (Get-Item $edgePath).VersionInfo.ProductVersion

function Write-Json {
  param([string]$Name, [object]$Value)
  $path = Join-Path $artifactRoot $Name
  New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
  $Value | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $path -Encoding utf8
}

function Invoke-Launcher {
  param([string[]]$Arguments)
  $raw = & $NodePath $launcher @Arguments 2>&1 | Out-String
  $code = $LASTEXITCODE
  $json = $null
  try { $json = $raw | ConvertFrom-Json } catch { }
  return [ordered]@{ arguments = @($Arguments); exitCode = $code; output = $json; rawParseFailed = -not [bool]$json }
}

function New-RunId {
  param([string]$Browser, [string]$Flow)
  return "$Browser-$Flow-$([guid]::NewGuid().ToString('N'))"
}

function Read-BridgeRows {
  param([int]$Skip)
  if (-not (Test-Path -LiteralPath $accessLog)) { return @() }
  return @(Get-Content -LiteralPath $accessLog | Select-Object -Skip $Skip | ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { [ordered]@{ parseError = $true } }
  })
}

function Write-GlobalHashManifest {
  $manifestPath = Join-Path $artifactRoot "sha256-manifest.json"
  $files = Get-ChildItem -LiteralPath $artifactRoot -File -Recurse |
    Where-Object { $_.FullName -ne $manifestPath } |
    Sort-Object FullName
  $rows = foreach ($file in $files) {
    [ordered]@{
      file = $file.FullName.Substring($artifactRoot.Length + 1).Replace("\", "/")
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  Write-Json "sha256-manifest.json" ([ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString("o"); files = @($rows) })
}

function Write-RunHashManifest {
  param([string]$RunDirectory, [string]$RunId)
  $manifestPath = Join-Path $RunDirectory "sha256-manifest.json"
  $files = Get-ChildItem -LiteralPath $RunDirectory -File -Recurse |
    Where-Object { $_.FullName -ne $manifestPath } |
    Sort-Object FullName
  $rows = foreach ($file in $files) {
    [ordered]@{
      run_id = $RunId
      file = $file.FullName.Substring($RunDirectory.Length + 1).Replace("\", "/")
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $value = [ordered]@{ run_id = $RunId; createdAt = (Get-Date).ToUniversalTime().ToString("o"); files = @($rows) }
  $value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
}

$flows = if ($FullMatrix) {
  @(
    @{ browser = "chrome"; flow = "grant"; version = $chromeVersion },
    @{ browser = "chrome"; flow = "deny"; version = $chromeVersion },
    @{ browser = "edge"; flow = "grant"; version = $edgeVersion },
    @{ browser = "edge"; flow = "deny"; version = $edgeVersion }
  )
} else {
  @(@{ browser = "chrome"; flow = "grant"; version = $chromeVersion })
}

$runPlan = foreach ($flow in $flows) {
  $runId = New-RunId $flow.browser $flow.flow
  [ordered]@{
    browser = $flow.browser
    flow = $flow.flow
    version = $flow.version
    run_id = $runId
    profile = Join-Path $profileRoot "$($flow.browser)-$($flow.flow)"
  }
}

Write-Host "Closed AI R5.2R1A local operator run" -ForegroundColor Cyan
Write-Host "Product Preview URL: $TargetUrl"
Write-Host "Product commit: $ProductCommit"
Write-Host "Harness commit: $harnessCommit"
Write-Host "Chrome binary: $chromePath"
Write-Host "Edge binary: $edgePath"
Write-Host "Bridge bind: 127.0.0.1:3217"
Write-Host "Exact origin to authorize: $origin"
foreach ($run in $runPlan) { Write-Host "$($run.browser) $($run.flow) profile: $($run.profile) | run_id: $($run.run_id)" }
Write-Host "Only operate the native LNA prompt, then type CONTINUE in PowerShell. Do not change URLs, storage, Bridge settings, or evidence." -ForegroundColor Yellow

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
$notTested = [ordered]@{ status = "NOT_TESTED"; reason = "Local operator flow has not completed." }
foreach ($name in @(
  "chrome-channel-result.json", "edge-channel-result.json", "chrome-cdp-launch.json", "edge-cdp-launch.json",
  "chrome-cdp-version.json", "edge-cdp-version.json", "chrome-browser-identity.json", "edge-browser-identity.json",
  "chrome-grant-smoke.json", "chrome-deny.json", "edge-grant.json", "edge-deny.json", "browser-bridge-correlation.json"
)) { Write-Json $name $notTested }

Write-Json "environment.json" ([ordered]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  productPreview = $TargetUrl
  productCommit = $ProductCommit
  harnessCommit = $harnessCommit
  origin = $origin
  chrome = [ordered]@{ path = $chromePath; version = $chromeVersion }
  edge = [ordered]@{ path = $edgePath; version = $edgeVersion }
  bridge = [ordered]@{ bind = "127.0.0.1"; port = 3217 }
  runPlan = @($runPlan)
})
Write-Json "operator-run-manifest.json" ([ordered]@{
  status = "PLANNED"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  runPlan = @($runPlan)
  allowedHumanActions = @("native LNA prompt decision", "type CONTINUE in PowerShell")
  manualConfigurationChangesAllowed = $false
})

$bridgeStarted = $false
$originEnrolled = $false
$runResults = @()
try {
  $existing = Get-NetTCPConnection -State Listen -LocalPort 3217 -ErrorAction SilentlyContinue
  if ($existing) { throw "BRIDGE_PORT_OCCUPIED_BEFORE_RUN" }
  $originAdd = Invoke-Launcher @("origin", "add", $origin, "--confirm", $origin)
  if ($originAdd.exitCode -ne 0) { throw "ORIGIN_ENROLLMENT_FAILED" }
  $originEnrolled = $true
  $start = Invoke-Launcher @("start", "--origin", $origin)
  if ($start.exitCode -ne 0) { throw "BRIDGE_START_FAILED" }
  $bridgeStarted = $true
  $listener = Get-NetTCPConnection -State Listen -LocalPort 3217 -ErrorAction Stop
  if (@($listener | Where-Object { $_.LocalAddress -ne "127.0.0.1" }).Count) { throw "BRIDGE_NON_LOOPBACK_BIND" }

  foreach ($run in $runPlan) {
    Write-Host "`nrun_id: $($run.run_id) | $($run.browser) $($run.flow)" -ForegroundColor Cyan
    $beforeCount = if (Test-Path -LiteralPath $accessLog) { @(Get-Content -LiteralPath $accessLog).Count } else { 0 }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $browserEntry `
      -Browser $run.browser -Flow $run.flow -TargetUrl $TargetUrl -ProfilePath $run.profile `
      -ArtifactDirectory $artifactRoot -RunId $run.run_id -BrowserVersion $run.version -NodePath $NodePath
    $adapterExit = $LASTEXITCODE
    $bridgeRows = Read-BridgeRows $beforeCount
    $runDirectory = Join-Path $artifactRoot "runs\$($run.run_id)"
    Write-Json "runs/$($run.run_id)/bridge-access.json" ([ordered]@{ run_id = $run.run_id; rows = @($bridgeRows) })
    $finalPath = Join-Path $runDirectory "final-result.json"
    $final = if (Test-Path $finalPath) { Get-Content $finalPath -Raw | ConvertFrom-Json } else { [ordered]@{ status = "FAILED"; error = "FINAL_RESULT_MISSING" } }
    $runResults += [ordered]@{ run_id = $run.run_id; browser = $run.browser; flow = $run.flow; adapterExit = $adapterExit; finalStatus = $final.status }
    Write-RunHashManifest $runDirectory $run.run_id
    if ($adapterExit -ne 0 -or $final.status -ne "COMPLETED_FOR_REVIEW") { break }
  }
}
finally {
  $stop = if ($bridgeStarted) { Invoke-Launcher @("stop") } else { $null }
  $revoke = if ($originEnrolled) { Invoke-Launcher @("origin", "revoke", $origin, "--confirm", $origin) } else { $null }
  $portReleased = -not [bool](Get-NetTCPConnection -State Listen -LocalPort 3217 -ErrorAction SilentlyContinue)
  Write-Json "origin-revoke.json" ([ordered]@{ status = if ($revoke -and $revoke.exitCode -eq 0) { "PASS" } else { "NOT_RUN" }; result = $revoke })
  Write-Json "bridge-cleanup.json" ([ordered]@{ status = if ($portReleased) { "PASS" } else { "FAIL" }; stop = $stop; portReleased = $portReleased })
  Write-Json "operator-run-manifest.json" ([ordered]@{
    status = if (@($runResults | Where-Object { $_.finalStatus -ne "COMPLETED_FOR_REVIEW" }).Count) { "INCOMPLETE" } else { "COMPLETED_FOR_REVIEW" }
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
    runPlan = @($runPlan)
    results = @($runResults)
    manualConfigurationChanges = $false
    browserSecurityBypass = $false
  })
  Write-GlobalHashManifest
}

$runResults | Format-Table -AutoSize
