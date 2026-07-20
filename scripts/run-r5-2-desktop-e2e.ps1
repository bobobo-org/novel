[CmdletBinding()]
param(
  [string]$PreviewUrl = "https://novel-gw062wjeh-lqtechs-projects.vercel.app/studio/settings/ai",
  [string]$ExpectedCommit = "ddaa86e998c7492bf36f8b3ab51a360be6d8b3b7",
  [string]$OutputDirectory = "artifacts/closed-ai-phase1-1r5-2",
  [switch]$RealChromeControllerAvailable,
  [switch]$RealEdgeControllerAvailable
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $repositoryRoot $OutputDirectory
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

function Write-JsonFile {
  param([string]$Name, [object]$Value)
  $path = Join-Path $outputPath $Name
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding utf8
}

function Get-ExecutableVersion {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{ path = $Path; installed = $false; version = $null }
  }
  $item = Get-Item -LiteralPath $Path
  return [ordered]@{
    path = $item.FullName
    installed = $true
    version = $item.VersionInfo.ProductVersion
  }
}

function Get-Listener {
  param([int]$Port)
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) {
    return [ordered]@{ listening = $false; address = $null; port = $Port; pid = $null }
  }
  return [ordered]@{
    listening = $true
    address = $listener.LocalAddress
    port = $listener.LocalPort
    pid = $listener.OwningProcess
  }
}

function Invoke-JsonGet {
  param([string]$Uri)
  try {
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 30 -Headers @{ "Cache-Control" = "no-cache" }
    $stopwatch.Stop()
    return [ordered]@{
      ok = $true
      status = [int]$response.StatusCode
      elapsedMs = $stopwatch.ElapsedMilliseconds
      body = $response.Content | ConvertFrom-Json
      error = $null
    }
  }
  catch {
    return [ordered]@{
      ok = $false
      status = $null
      elapsedMs = $null
      body = $null
      error = $_.Exception.Message
    }
  }
}

function Invoke-HealthIdentityGet {
  param([string]$Uri)
  try {
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 30 -Headers @{ "Cache-Control" = "no-cache" }
    $stopwatch.Stop()
    $commitMatch = [regex]::Match($response.Content, '"appCommit"\s*:\s*"([^"]+)"')
    $deploymentMatch = [regex]::Match($response.Content, '"deploymentId"\s*:\s*"([^"]+)"')
    return [ordered]@{
      ok = $commitMatch.Success
      status = [int]$response.StatusCode
      elapsedMs = $stopwatch.ElapsedMilliseconds
      appCommit = if ($commitMatch.Success) { $commitMatch.Groups[1].Value } else { $null }
      deploymentId = if ($deploymentMatch.Success) { $deploymentMatch.Groups[1].Value } else { $null }
      error = if ($commitMatch.Success) { $null } else { "HEALTH_APP_COMMIT_MISSING" }
      parserNote = "Raw field extraction avoids Windows PowerShell case-insensitive duplicate-key rejection."
    }
  }
  catch {
    return [ordered]@{
      ok = $false
      status = $null
      elapsedMs = $null
      appCommit = $null
      deploymentId = $null
      error = $_.Exception.Message
      parserNote = $null
    }
  }
}

$chrome = Get-ExecutableVersion "C:\Program Files\Google\Chrome\Application\chrome.exe"
$edge = Get-ExecutableVersion "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$bridge = Get-Listener 3217
$ollama = Get-Listener 11434
$explorer = Get-Process explorer -ErrorAction SilentlyContinue |
  Where-Object { $_.SessionId -eq [System.Diagnostics.Process]::GetCurrentProcess().SessionId } |
  Select-Object -First 1
$interactiveSession = [bool]$explorer

$ollamaVersion = Invoke-JsonGet "http://127.0.0.1:11434/api/version"
$ollamaModels = Invoke-JsonGet "http://127.0.0.1:11434/api/tags"
$healthBase = ([Uri]$PreviewUrl).GetLeftPart([System.UriPartial]::Authority)
$previewHealth = Invoke-HealthIdentityGet "$healthBase/api/ai/health?verify=r5-2-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$reportedCommit = if ($previewHealth.ok) { [string]$previewHealth.appCommit } else { $null }
$commitMatches = $reportedCommit -eq $ExpectedCommit

$environment = [ordered]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  previewUrl = $PreviewUrl
  expectedCommit = $ExpectedCommit
  reportedCommit = $reportedCommit
  commitMatches = $commitMatches
  previewHealth = [ordered]@{
    ok = $previewHealth.ok
    status = $previewHealth.status
    elapsedMs = $previewHealth.elapsedMs
    error = $previewHealth.error
    deploymentId = $previewHealth.deploymentId
    parserNote = $previewHealth.parserNote
  }
  windows = [ordered]@{
    caption = (Get-CimInstance Win32_OperatingSystem).Caption
    version = (Get-CimInstance Win32_OperatingSystem).Version
    build = (Get-CimInstance Win32_OperatingSystem).BuildNumber
  }
  session = [ordered]@{
    id = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    interactive = $interactiveSession
    explorerPid = if ($explorer) { $explorer.Id } else { $null }
  }
  bridge = $bridge
  ollama = [ordered]@{
    listener = $ollama
    version = if ($ollamaVersion.ok) { $ollamaVersion.body.version } else { $null }
    models = if ($ollamaModels.ok) { @($ollamaModels.body.models | ForEach-Object { $_.name }) } else { @() }
  }
  constraints = [ordered]@{
    inAppBrowserUsed = $false
    browserSecurityFlagsUsed = $false
    permissionInjected = $false
    directBridgeApiUsedForUiAcceptance = $false
    externalAiCalled = $false
  }
}

Write-JsonFile "environment.json" $environment
Write-JsonFile "chrome-version.json" $chrome
Write-JsonFile "edge-version.json" $edge

$controllerReady = $RealChromeControllerAvailable -and $RealEdgeControllerAvailable
$verdict = if (-not $interactiveSession) {
  "PHASE1_1R5_2_BLOCKED_INTERACTIVE_DESKTOP"
}
elseif (-not $controllerReady) {
  "PHASE1_1R5_2_NOT_READY"
}
elseif (-not $commitMatches) {
  "PHASE1_1R5_2_NOT_READY"
}
else {
  "R5_2_DESKTOP_CONTROLLER_PREREQUISITES_READY"
}

$blocker = if (-not $interactiveSession) {
  "INTERACTIVE_DESKTOP_UNAVAILABLE"
}
elseif (-not $controllerReady) {
  "COMPLIANT_CHROME_EDGE_CONTROL_CHANNEL_UNAVAILABLE"
}
elseif (-not $commitMatches) {
  "PREVIEW_COMMIT_MISMATCH"
}
else {
  $null
}

$notTested = [ordered]@{
  status = "NOT_TESTED"
  blocker = $blocker
  reason = "A compliant headed Chrome and Edge UI control channel is required. No in-app browser, direct API substitute, permission injection, or browser security bypass is permitted."
}

foreach ($name in @(
  "dynamic-origin-chrome.json",
  "dynamic-origin-edge.json",
  "clipboard-chrome.json",
  "clipboard-edge.json",
  "lna-permission-chrome.json",
  "lna-permission-edge.json",
  "bridge-access-chrome.json",
  "bridge-access-edge.json",
  "chrome-preview-runtime.json",
  "edge-preview-runtime.json",
  "chrome-storage-audit.json",
  "edge-storage-audit.json",
  "network-destinations.json",
  "story-bible-preview-candidate.json",
  "approval-matrix.json",
  "origin-revoke.json",
  "cleanup.json"
)) {
  Write-JsonFile $name $notTested
}

$summary = [ordered]@{
  verdict = $verdict
  blocker = $blocker
  interactiveDesktop = $interactiveSession
  chromeInstalled = $chrome.installed
  edgeInstalled = $edge.installed
  chromeControllerAvailable = [bool]$RealChromeControllerAvailable
  edgeControllerAvailable = [bool]$RealEdgeControllerAvailable
  bridgeListening = $bridge.listening
  ollamaListening = $ollama.listening
  targetModelInstalled = @($environment.ollama.models) -contains "qwen2.5:3b"
  previewCommitVerified = $commitMatches
  uiE2eExecuted = $false
  screenshotsCaptured = $false
  formalStoryBibleWrites = 0
  incorrectCommittedFacts = 0
  externalAiCalls = 0
  chromeLnaGrantFlow = "NOT_TESTED"
  chromeLnaDenyFlow = "NOT_TESTED"
  edgeLnaGrantFlow = "NOT_TESTED"
  edgeLnaDenyFlow = "NOT_TESTED"
  previewRequestReachedBridge = "NO"
  browserPolicyOverride = "NO"
  firewallOrProxyModification = "NO"
  directApiSubstitution = "NO"
  evidenceFromOneExactCommitOnly = if ($commitMatches) { "YES" } else { "NO" }
  isolatedProfiles = [ordered]@{
    chrome = (Join-Path $outputPath "browser-profiles/chrome")
    edge = (Join-Path $outputPath "browser-profiles/edge")
    shared = $false
  }
}
Write-JsonFile "full-regression-results.json" $summary

$markdown = @"
# Closed AI Phase 1.1R5.2

Verdict: ``$verdict``

Blocker: ``$blocker``

The Windows interactive session, installed browser binaries, Preview identity, Bridge listener, Ollama runtime, and installed models were inspected. The required visible Chrome and Edge UI flows were not executed because this run has no compliant control channel for the installed browsers. The in-app browser and direct Bridge/API calls were intentionally not used as substitutes.

- Preview commit verified: $commitMatches
- Interactive desktop detected: $interactiveSession
- Chrome installed: $($chrome.installed) ($($chrome.version))
- Edge installed: $($edge.installed) ($($edge.version))
- Bridge listening: $($bridge.listening)
- Ollama listening: $($ollama.listening)
- qwen2.5:3b installed: $(@($environment.ollama.models) -contains "qwen2.5:3b")
- UI E2E executed: NO
- LNA permission tested: NO
- Pairing tested: NO
- Story Bible approval matrix tested: NO
- External AI calls: 0
- Chrome LNA grant flow: NOT_TESTED
- Chrome LNA deny flow: NOT_TESTED
- Edge LNA grant flow: NOT_TESTED
- Edge LNA deny flow: NOT_TESTED
- Preview request reached Bridge: NO
- Any browser policy override: NO
- Any firewall or proxy modification: NO
- Any direct API substitution: NO
- Evidence from one exact commit only: $(if ($commitMatches) { "YES" } else { "NO" })

No PNG prompt evidence was created because no real browser permission prompt was observed. Missing screenshots are evidence of an unexecuted test, not a pass.
"@
$markdown | Set-Content -LiteralPath (Join-Path $outputPath "final-summary.md") -Encoding utf8

$summary | ConvertTo-Json -Depth 8
if ($verdict -ne "R5_2_DESKTOP_CONTROLLER_PREREQUISITES_READY") {
  exit 2
}
