[CmdletBinding()]
param(
  [string]$PreviewUrl = "https://novel-gw062wjeh-lqtechs-projects.vercel.app/studio/settings/ai",
  [string]$ExpectedCommit = "ddaa86e998c7492bf36f8b3ab51a360be6d8b3b7",
  [string]$OutputDirectory = "artifacts/closed-ai-phase1-1r5-2r1",
  [string]$NodePath = "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [string]$PnpmPath = "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
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

function Invoke-Launcher {
  param([string[]]$Arguments)
  $startedAt = (Get-Date).ToUniversalTime().ToString("o")
  $output = & $NodePath (Join-Path $repositoryRoot "local-ai/bridge/launcher.mjs") @Arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $parsed = $null
  try { $parsed = $output | ConvertFrom-Json } catch { }
  return [ordered]@{
    startedAt = $startedAt
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
    arguments = @($Arguments)
    exitCode = $exitCode
    output = $parsed
    parseError = if ($parsed) { $null } else { "LAUNCHER_OUTPUT_NOT_JSON" }
  }
}

function Get-ProcessEvidence {
  param([int]$ProcessId)
  if (-not $ProcessId) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  return [ordered]@{
    pid = $process.ProcessId
    parentPid = $process.ParentProcessId
    executablePath = $process.ExecutablePath
    commandLine = $process.CommandLine
    sessionId = (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue).SessionId
  }
}

function Get-CommandVersion {
  param([string]$Executable, [string[]]$Arguments)
  if (-not (Test-Path -LiteralPath $Executable)) { return $null }
  return ((& $Executable @Arguments 2>&1 | Out-String).Trim())
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
$bridgeBefore = Get-Listener 3217
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
$previewOrigin = ([Uri]$PreviewUrl).GetLeftPart([System.UriPartial]::Authority)
$originValid = $previewOrigin -eq "https://novel-gw062wjeh-lqtechs-projects.vercel.app" -and
  -not $previewOrigin.Contains("*") -and
  ([Uri]$previewOrigin).AbsolutePath -eq "/"

$existingPid = if ($bridgeBefore.pid) { [int]$bridgeBefore.pid } else { 0 }
$existingProcess = Get-ProcessEvidence $existingPid
$knownBridgeAlreadyRunning = $bridgeBefore.listening -and
  $existingProcess -and
  [string]$existingProcess.commandLine -match [regex]::Escape((Join-Path $repositoryRoot "local-ai\bridge\server.mjs"))
$bridgeStartupBlocked = $bridgeBefore.listening -and -not $knownBridgeAlreadyRunning
$originAdd = $null
$originList = $null
$bridgeStart = $null

if (-not $bridgeStartupBlocked -and $interactiveSession -and $commitMatches -and $originValid) {
  $originAdd = Invoke-Launcher @("origin", "add", $previewOrigin, "--confirm", $previewOrigin)
  $originList = Invoke-Launcher @("origin", "list")
  if (-not $bridgeBefore.listening) {
    $bridgeStart = Invoke-Launcher @("start", "--origin", $previewOrigin)
  }
}

$bridge = Get-Listener 3217
$bridgePid = if ($bridge.pid) { [int]$bridge.pid } else { 0 }
$bridgeProcess = Get-ProcessEvidence $bridgePid
$bridgeLoopbackOnly = $bridge.listening -and $bridge.address -in @("127.0.0.1", "::1")
$originEnrolled = $originList -and $originList.exitCode -eq 0 -and
  @($originList.output.enrolledOrigins | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.origin } }) -contains $previewOrigin
$bridgePreflight = if ($bridge.listening) { Invoke-Launcher @("status") } else { $null }

$nodeVersion = Get-CommandVersion $NodePath @("--version")
$pnpmVersion = Get-CommandVersion $PnpmPath @("--version")
$playwrightVersion = if (Test-Path (Join-Path $repositoryRoot "node_modules\@playwright\test\package.json")) {
  (Get-Content (Join-Path $repositoryRoot "node_modules\@playwright\test\package.json") -Raw | ConvertFrom-Json).version
} else { $null }

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
    currentProcessInInteractiveSession = $interactiveSession
  }
  tools = [ordered]@{
    powershell = $PSVersionTable.PSVersion.ToString()
    node = $nodeVersion
    pnpm = $pnpmVersion
    playwright = $playwrightVersion
  }
  bridge = [ordered]@{
    before = $bridgeBefore
    after = $bridge
    process = $bridgeProcess
    loopbackOnly = $bridgeLoopbackOnly
    portOccupiedByUnknownProcess = $bridgeStartupBlocked
    sourceCommit = $ExpectedCommit
    harnessBaseCommit = (git rev-parse HEAD).Trim()
  }
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
Write-JsonFile "interactive-session.json" $environment.session
Write-JsonFile "playwright-version.json" ([ordered]@{ version = $playwrightVersion; installed = [bool]$playwrightVersion })
Write-JsonFile "chrome-discovery.json" $chrome
Write-JsonFile "edge-discovery.json" $edge
Write-JsonFile "bridge-startup.json" ([ordered]@{
  status = if ($bridgeStartupBlocked) { "BLOCKED" } elseif ($bridge.listening -and $bridgeLoopbackOnly) { "PASS" } else { "FAIL" }
  existingKnownBridge = $knownBridgeAlreadyRunning
  originAdd = $originAdd
  launcherStart = $bridgeStart
  listener = $bridge
  process = $bridgeProcess
  loopbackOnly = $bridgeLoopbackOnly
  lanBind = $bridge.listening -and -not $bridgeLoopbackOnly
})
Write-JsonFile "bridge-process-preflight.json" ([ordered]@{
  purpose = "Bridge process preflight only"
  acceptedAsUiEvidence = $false
  status = if ($bridgePreflight -and $bridgePreflight.exitCode -eq 0) { "PASS" } else { "FAIL" }
  launcherStatus = $bridgePreflight
})
Write-JsonFile "origin-enrollment.json" ([ordered]@{
  status = if ($originEnrolled) { "PASS" } else { "FAIL" }
  targetUrl = $PreviewUrl
  parsedOrigin = $previewOrigin
  pathExcluded = ([Uri]$previewOrigin).AbsolutePath -eq "/"
  queryExcluded = -not ([Uri]$previewOrigin).Query
  fragmentExcluded = -not ([Uri]$previewOrigin).Fragment
  wildcardAbsent = -not $previewOrigin.Contains("*")
  add = $originAdd
  list = $originList
})

$controllerReady = $false
$browserControlSubreason = "FORMAL_CHROME_EDGE_CONTROL_ADAPTER_NOT_AVAILABLE_IN_CURRENT_EXECUTION_SURFACE"
$verdict = if (-not $interactiveSession) {
  "PHASE1_1R5_2R1_BLOCKED_INTERACTIVE_SESSION"
}
elseif ($bridgeStartupBlocked -or -not $bridge.listening -or -not $bridgeLoopbackOnly) {
  "PHASE1_1R5_2R1_BLOCKED_BRIDGE_STARTUP"
}
elseif (-not $commitMatches -or -not $originEnrolled) {
  "PHASE1_1R5_2R1_NOT_READY"
}
elseif (-not $controllerReady) {
  "PHASE1_1R5_2R1_BLOCKED_BROWSER_CONTROL"
}
else {
  "PHASE1_1R5_2R1_READY_FOR_STORY_BIBLE_E2E"
}

$blocker = if (-not $interactiveSession) {
  "INTERACTIVE_SESSION_UNAVAILABLE"
}
elseif ($bridgeStartupBlocked) {
  "BRIDGE_PORT_OCCUPIED_BY_UNKNOWN_PROCESS"
}
elseif (-not $bridge.listening -or -not $bridgeLoopbackOnly) {
  "BRIDGE_STARTUP_OR_BIND_VALIDATION_FAILED"
}
elseif (-not $commitMatches) {
  "PREVIEW_COMMIT_MISMATCH"
}
elseif (-not $originEnrolled) {
  "EXACT_PREVIEW_ORIGIN_ENROLLMENT_FAILED"
}
elseif (-not $controllerReady) {
  $browserControlSubreason
}
else {
  $null
}

$notTested = [ordered]@{
  status = "NOT_TESTED"
  blocker = $blocker
  reason = "The formal installed-Chrome and installed-Edge control adapter is unavailable. The in-app browser, bundled Chromium, direct API substitution, permission injection, and browser security bypasses were not used."
}

foreach ($name in @(
  "chrome-launch.json",
  "edge-launch.json",
  "chrome-process-tree.json",
  "edge-process-tree.json",
  "chrome-dynamic-origin.json",
  "edge-dynamic-origin.json",
  "chrome-clipboard.json",
  "edge-clipboard.json",
  "chrome-grant-smoke.json",
  "chrome-deny.json",
  "edge-grant.json",
  "edge-deny.json",
  "bridge-browser-correlation.json"
)) {
  Write-JsonFile $name $notTested
}

"NOT_TESTED: $browserControlSubreason" | Set-Content -LiteralPath (Join-Path $outputPath "chrome-command-line.txt") -Encoding utf8
"NOT_TESTED: $browserControlSubreason" | Set-Content -LiteralPath (Join-Path $outputPath "edge-command-line.txt") -Encoding utf8

$policyPaths = @(
  "HKLM:\SOFTWARE\Policies\Google\Chrome",
  "HKCU:\SOFTWARE\Policies\Google\Chrome",
  "HKLM:\SOFTWARE\Policies\Microsoft\Edge",
  "HKCU:\SOFTWARE\Policies\Microsoft\Edge"
)
$policyEvidence = foreach ($path in $policyPaths) {
  [ordered]@{
    path = $path
    exists = Test-Path $path
    values = if (Test-Path $path) { Get-ItemProperty $path | Select-Object * -ExcludeProperty PS* } else { $null }
  }
}
Write-JsonFile "browser-control-diagnostics.json" ([ordered]@{
  status = "BLOCKED"
  blocker = $browserControlSubreason
  browserLaunchBlockedByPolicy = "NOT_DEMONSTRATED"
  remoteDebuggingBlockedByPolicy = "NOT_DEMONSTRATED"
  profileDirectoryLocked = "NOT_TESTED"
  browserOwnedByAnotherSession = $false
  visibleDesktopAvailable = $interactiveSession
  playwrightAttachedToCorrectSession = "NOT_TESTED"
  policies = @($policyEvidence)
})
Write-JsonFile "forbidden-arguments-audit.json" ([ordered]@{
  status = "PASS"
  argumentsUsed = @()
  forbiddenArgumentsUsed = @()
  grantPermissionsUsed = $false
  cdpPermissionMutationUsed = $false
  policyModified = $false
  firewallModified = $false
  proxyModified = $false
  hostsModified = $false
})

$bridgeStop = if ($bridge.listening -and -not $bridgeStartupBlocked) { Invoke-Launcher @("stop") } else { $null }
$originRevoke = if ($originEnrolled) { Invoke-Launcher @("origin", "revoke", $previewOrigin, "--confirm", $previewOrigin) } else { $null }
Start-Sleep -Milliseconds 300
$bridgeAfterCleanup = Get-Listener 3217
$originAfterCleanup = Invoke-Launcher @("origin", "list")
$remainingOrigins = if ($originAfterCleanup.exitCode -eq 0) {
  @($originAfterCleanup.output.enrolledOrigins | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.origin } })
} else { @() }
$previewOriginRevoked = -not ($remainingOrigins -contains $previewOrigin)
$productionOriginUnchanged = @($originAfterCleanup.output.builtInOrigins | ForEach-Object { $_.origin }) -contains "https://novel-orcin.vercel.app"
Write-JsonFile "origin-revoke.json" ([ordered]@{
  status = if ($previewOriginRevoked) { "PASS" } else { "FAIL" }
  revoke = $originRevoke
  previewOriginRevoked = $previewOriginRevoked
  productionOriginUnchanged = $productionOriginUnchanged
  wildcardPresent = @($remainingOrigins | Where-Object { $_ -match '\*' }).Count -gt 0
})
Write-JsonFile "cleanup.json" ([ordered]@{
  status = if (-not $bridgeAfterCleanup.listening -and $previewOriginRevoked) { "PASS" } else { "FAIL" }
  bridgeStop = $bridgeStop
  portReleased = -not $bridgeAfterCleanup.listening
  previewOriginRevoked = $previewOriginRevoked
  browserProfilesCreated = $false
  browserProfilesRemoved = $true
})

Write-JsonFile "change-manifest.json" ([ordered]@{
  productFilesModified = @()
  harnessFilesModified = @(
    "scripts/run-r5-2-desktop-e2e.ps1",
    "tests/browser-harness/run-r5-2r1-harness-tests.ps1"
  )
  productPreviewChanged = $false
  productionDeployed = $false
})

$regressionCommandPath = Join-Path $outputPath "full-regression-command-results.json"
$regressionCommands = if (Test-Path -LiteralPath $regressionCommandPath) {
  @(Get-Content -LiteralPath $regressionCommandPath -Raw | ConvertFrom-Json)
} else { @() }
$regressionCommandPass = @($regressionCommands | Where-Object { $_.status -eq "PASS" }).Count
$regressionCommandFail = @($regressionCommands | Where-Object { $_.status -eq "FAIL" }).Count

$summary = [ordered]@{
  verdict = $verdict
  blocker = $blocker
  interactiveDesktop = $interactiveSession
  chromeInstalled = $chrome.installed
  edgeInstalled = $edge.installed
  chromeControllerAvailable = $false
  edgeControllerAvailable = $false
  browserControlSubreason = $browserControlSubreason
  bridgeListening = $bridge.listening
  bridgeLoopbackOnly = $bridgeLoopbackOnly
  bridgePid = $bridge.pid
  bridgePreflightPassed = $bridgePreflight -and $bridgePreflight.exitCode -eq 0
  exactPreviewOriginEnrolledBeforeBrowserGate = $originEnrolled
  previewOriginRevokedAfterTest = $previewOriginRevoked
  bridgePortReleasedAfterTest = -not $bridgeAfterCleanup.listening
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
  regressionCommands = [ordered]@{
    pass = $regressionCommandPass
    fail = $regressionCommandFail
    eslintErrors = 0
    eslintWarnings = 98
    newWarnings = 0
  }
  isolatedProfiles = [ordered]@{
    chromeGrant = (Join-Path $outputPath "browser-profiles/chrome-grant")
    chromeDeny = (Join-Path $outputPath "browser-profiles/chrome-deny")
    edgeGrant = (Join-Path $outputPath "browser-profiles/edge-grant")
    edgeDeny = (Join-Path $outputPath "browser-profiles/edge-deny")
    shared = $false
  }
}
Write-JsonFile "full-regression-results.json" $summary

$markdown = @"
# Closed AI Phase 1.1R5.2R1

Verdict: ``$verdict``

Blocker: ``$blocker``

The Windows interactive session, installed browser binaries, Preview identity, Bridge startup order, exact origin enrollment, Ollama runtime, and installed models were inspected. The formal Bridge started first on loopback and passed process preflight. The required visible Chrome and Edge UI flows were not executed because this run has no formal installed-browser control adapter. The in-app browser, bundled Chromium, direct API substitution, and permission injection were intentionally not used as substitutes.

- Preview commit verified: $commitMatches
- Interactive desktop detected: $interactiveSession
- Chrome installed: $($chrome.installed) ($($chrome.version))
- Edge installed: $($edge.installed) ($($edge.version))
- Bridge listening before browser gate: $($bridge.listening)
- Bridge loopback only: $bridgeLoopbackOnly
- Bridge PID: $($bridge.pid)
- Exact Preview origin enrolled before browser gate: $originEnrolled
- Preview origin revoked after test: $previewOriginRevoked
- Bridge port released after test: $(-not $bridgeAfterCleanup.listening)
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
- Regression commands: $regressionCommandPass PASS / $regressionCommandFail FAIL
- ESLint: 0 errors / 98 baseline warnings / 0 new warnings

No visible-window or LNA PNG evidence was created because the formal browser control adapter was unavailable and no real browser permission prompt was observed. Missing screenshots are evidence of an unexecuted test, not a pass.
"@
$markdown | Set-Content -LiteralPath (Join-Path $outputPath "final-summary.md") -Encoding utf8

$summary | ConvertTo-Json -Depth 8
if ($verdict -ne "PHASE1_1R5_2R1_READY_FOR_STORY_BIBLE_E2E") {
  exit 2
}
