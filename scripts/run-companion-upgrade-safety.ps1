param(
  [string]$RepositoryRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $RepositoryRoot) {
  $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}
$RepositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
$installerPath = Join-Path $RepositoryRoot 'local-ai\companion\install.ps1'
$starterSourcePath = Join-Path $RepositoryRoot 'local-ai\companion\start-companion.ps1'
$manifestSourcePath = Join-Path $RepositoryRoot 'local-ai\companion\manifest.json'
$expectedHubVersion = '1.5.0-public-lounge-attestation-v5'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  'novel-companion-upgrade-safety-' + [guid]::NewGuid()
)
$originalEnvironment = @{
  LOCALAPPDATA = $env:LOCALAPPDATA
  APPDATA = $env:APPDATA
  Path = $env:Path
  NOVEL_COMPANION_INSTALL_TEST_MODE = $env:NOVEL_COMPANION_INSTALL_TEST_MODE
  NOVEL_COMPANION_INSTALL_TEST_STOP_TIMEOUT_MS = $env:NOVEL_COMPANION_INSTALL_TEST_STOP_TIMEOUT_MS
}
$passCount = 0

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "ASSERTION_FAILED: $Message" }
}

function Assert-Match([string]$Value, [string]$Pattern, [string]$Message) {
  if ($Value -notmatch $Pattern) {
    throw "ASSERTION_FAILED: $Message`nActual: $Value"
  }
}

function Test-PortOpen([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(250)) { return $false }
    $client.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function New-FakeRelease(
  [string]$ReleasePath,
  [int]$BridgeStopExit,
  [int]$HubStopExit,
  [int]$StartExit,
  [string]$StartMarker
) {
  New-Item -ItemType Directory -Path (Join-Path $ReleasePath 'bridge') -Force |
    Out-Null
  New-Item -ItemType Directory -Path (Join-Path $ReleasePath 'private-hub') -Force |
    Out-Null
  Set-Content -LiteralPath (Join-Path $ReleasePath 'bridge\novel-local-ai.ps1') `
    -Encoding utf8 -Value @"
param([string]`$Command = 'status')
if (`$Command -eq 'stop') {
  if ($BridgeStopExit -ne 0) { [Console]::Error.WriteLine('fake native stop stderr') }
  exit $BridgeStopExit
}
exit 0
"@
  Set-Content -LiteralPath (Join-Path $ReleasePath 'private-hub\novel-private-hub.ps1') `
    -Encoding utf8 -Value @"
param([string]`$Command = 'status')
if (`$Command -eq 'stop') { exit $HubStopExit }
exit 0
"@
  $escapedMarker = $StartMarker.Replace("'", "''")
  Set-Content -LiteralPath (Join-Path $ReleasePath 'start-companion.ps1') `
    -Encoding utf8 -Value @"
param([switch]`$Quiet)
Set-Content -LiteralPath '$escapedMarker' -Value 'started' -Encoding utf8
exit $StartExit
"@
}

function New-TestArchive([string]$CaseRoot, [int]$StartExit) {
  $stageParent = Join-Path $CaseRoot 'archive-stage'
  $packageRoot = Join-Path $stageParent 'novel-local-ai-companion-v1.5.0'
  New-FakeRelease `
    $packageRoot `
    0 `
    0 `
    $StartExit `
    (Join-Path $CaseRoot 'new-start.marker')
  Copy-Item -LiteralPath $manifestSourcePath `
    -Destination (Join-Path $packageRoot 'manifest.json')
  $archivePath = Join-Path $CaseRoot 'companion.zip'
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -Force
  return $archivePath
}

function Initialize-Case([string]$Name, [int]$BridgeStopExit = 0) {
  $caseRoot = Join-Path $testRoot $Name
  $localAppData = Join-Path $caseRoot 'LocalAppData'
  $appData = Join-Path $caseRoot 'AppData'
  $installRoot = Join-Path $localAppData 'NovelLocalAICompanion'
  $oldRelease = Join-Path $installRoot 'releases\1.4.7'
  $oldStartMarker = Join-Path $caseRoot 'old-start.marker'
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $appData -Force | Out-Null
  New-FakeRelease $oldRelease $BridgeStopExit 0 0 $oldStartMarker
  Set-Content -LiteralPath (Join-Path $installRoot 'current.txt') `
    -Value $oldRelease -Encoding utf8
  return [pscustomobject]@{
    caseRoot = $caseRoot
    localAppData = $localAppData
    appData = $appData
    installRoot = $installRoot
    oldRelease = $oldRelease
    oldStartMarker = $oldStartMarker
  }
}

function Invoke-InstallerFailure($Case, [string]$ArchivePath, [switch]$KeepAutostart) {
  $env:LOCALAPPDATA = $Case.localAppData
  $env:APPDATA = $Case.appData
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    $installerPath,
    '-ArchivePath',
    $ArchivePath,
    '-InstallRoot',
    $Case.installRoot,
    '-SkipDependencyInstall',
    '-SkipStarterModel'
  )
  if (-not $KeepAutostart) { $arguments += '-SkipAutostart' }
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& powershell.exe @arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  return [pscustomobject]@{
    exitCode = $exitCode
    output = ($output | Out-String)
  }
}

function New-OldShortcut($Case) {
  $shortcutPath = Join-Path $Case.appData `
    'Microsoft\Windows\Start Menu\Programs\Startup\Novel Local AI Companion.lnk'
  New-Item -ItemType Directory -Path (Split-Path -Parent $shortcutPath) -Force |
    Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = 'powershell.exe'
  $shortcut.Arguments = '-File "{0}" -Quiet -OldSentinel' -f (
    Join-Path $Case.oldRelease 'start-companion.ps1'
  )
  $shortcut.WorkingDirectory = $Case.oldRelease
  $shortcut.Description = 'old shortcut sentinel'
  $shortcut.Save()
  return $shortcutPath
}

function Read-Shortcut([string]$ShortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  return $shell.CreateShortcut($ShortcutPath)
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
  $fakeBin = Join-Path $testRoot 'bin'
  New-Item -ItemType Directory -Path $fakeBin -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\cmd.exe') `
    -Destination (Join-Path $fakeBin 'ollama.exe')
  $env:Path = $fakeBin + [System.IO.Path]::PathSeparator + $originalEnvironment.Path
  $env:NOVEL_COMPANION_INSTALL_TEST_MODE = '1'
  $env:NOVEL_COMPANION_INSTALL_TEST_STOP_TIMEOUT_MS = '350'

  # A non-zero native stop exit must abort before the other old service is
  # touched. The old current pointer remains authoritative and is restarted.
  $stopFailure = Initialize-Case 'native-stop-failure' 23
  $stopFailureArchive = New-TestArchive $stopFailure.caseRoot 0
  $stopFailureResult = Invoke-InstallerFailure $stopFailure $stopFailureArchive
  Assert-True ($stopFailureResult.exitCode -ne 0) 'native stop failure must fail install'
  Assert-Match `
    $stopFailureResult.output `
    'COMPANION_OLD_SERVICE_STOP_FAILED_LOCAL_BRIDGE: exit 23' `
    'native exit code must be preserved'
  Assert-True `
    ((Get-Content -LiteralPath (Join-Path $stopFailure.installRoot 'current.txt') -Raw).Trim() -eq $stopFailure.oldRelease) `
    'current.txt must still select the old release'
  Assert-True `
    (Test-Path -LiteralPath $stopFailure.oldStartMarker -PathType Leaf) `
    'partial stop failure must attempt to restart the old release'
  $passCount += 1

  # A stop command reporting success is insufficient while its loopback port
  # remains owned. Use a short test-only deadline so this proof stays fast.
  $portFailure = Initialize-Case 'port-not-released'
  $portFailureArchive = New-TestArchive $portFailure.caseRoot 0
  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    3217
  )
  try {
    $listener.Start()
    $portFailureResult = Invoke-InstallerFailure $portFailure $portFailureArchive
  } finally {
    $listener.Stop()
  }
  Assert-True ($portFailureResult.exitCode -ne 0) 'owned port must fail install'
  Assert-Match `
    $portFailureResult.output `
    'COMPANION_OLD_SERVICE_NOT_RELEASED: Local Bridge' `
    'successful stop must still prove port release'
  $passCount += 1

  # Once the pointer and shortcut have switched, a failed new launcher must
  # restore both exactly and restart the prior release.
  $launchFailure = Initialize-Case 'new-launch-failure'
  $launchFailureArchive = New-TestArchive $launchFailure.caseRoot 31
  $oldShortcutPath = New-OldShortcut $launchFailure
  $oldShortcut = Read-Shortcut $oldShortcutPath
  $oldArguments = $oldShortcut.Arguments
  $oldWorkingDirectory = $oldShortcut.WorkingDirectory
  $oldDescription = $oldShortcut.Description
  $launchFailureResult = Invoke-InstallerFailure `
    $launchFailure `
    $launchFailureArchive `
    -KeepAutostart
  Assert-True ($launchFailureResult.exitCode -ne 0) 'new launcher failure must fail install'
  Assert-Match `
    $launchFailureResult.output `
    'COMPANION_START_FAILED: exit 31' `
    'new launcher native exit must be reported'
  Assert-Match `
    $launchFailureResult.output `
    'COMPANION_ROLLBACK_SUCCEEDED' `
    'successful rollback must be explicit'
  Assert-True `
    ((Get-Content -LiteralPath (Join-Path $launchFailure.installRoot 'current.txt') -Raw).Trim() -eq $launchFailure.oldRelease) `
    'rollback must restore current.txt'
  $restoredShortcut = Read-Shortcut $oldShortcutPath
  Assert-True ($restoredShortcut.Arguments -eq $oldArguments) 'rollback must restore shortcut arguments'
  Assert-True `
    ($restoredShortcut.WorkingDirectory -eq $oldWorkingDirectory) `
    'rollback must restore shortcut working directory'
  Assert-True `
    ($restoredShortcut.Description -eq $oldDescription) `
    'rollback must restore shortcut description'
  Assert-True `
    (Test-Path -LiteralPath $launchFailure.oldStartMarker -PathType Leaf) `
    'rollback must attempt to restart the old release'
  $passCount += 1

  # start-companion itself must reject a healthy-looking stale Hub and expose
  # the exact verified 1.5.0 identity on success.
  Assert-True (-not (Test-PortOpen 3217)) 'port 3217 must be free for starter test'
  Assert-True (-not (Test-PortOpen 3227)) 'port 3227 must be free for starter test'
  $starterCase = Join-Path $testRoot 'starter-version'
  $starterRelease = Join-Path $starterCase 'release'
  New-Item -ItemType Directory -Path (Join-Path $starterRelease 'bridge') -Force |
    Out-Null
  New-Item -ItemType Directory -Path (Join-Path $starterRelease 'private-hub') -Force |
    Out-Null
  Copy-Item -LiteralPath $starterSourcePath `
    -Destination (Join-Path $starterRelease 'start-companion.ps1')
  foreach ($scriptPath in @(
    (Join-Path $starterRelease 'bridge\novel-local-ai.ps1'),
    (Join-Path $starterRelease 'private-hub\novel-private-hub.ps1')
  )) {
    Set-Content -LiteralPath $scriptPath -Encoding utf8 -Value @'
param([string]$Command = 'status')
exit 0
'@
  }
  $versionPath = Join-Path $starterCase 'hub-version.txt'
  Set-Content -LiteralPath $versionPath -Value $expectedHubVersion -Encoding ascii
  $serverPath = Join-Path $starterCase 'health-server.mjs'
  Set-Content -LiteralPath $serverPath -Encoding utf8 -Value @'
import fs from "node:fs";
import http from "node:http";
const versionPath = process.argv[2];
const servers = [
  http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ bridgeProcessAlive: true }));
  }).listen(3217, "127.0.0.1"),
  http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      hubProcessAlive: true,
      hubVersion: fs.readFileSync(versionPath, "utf8").trim(),
    }));
  }).listen(3227, "127.0.0.1"),
];
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => Promise.all(servers.map((server) => new Promise(
    (resolve) => server.close(resolve),
  ))).finally(() => process.exit(0)));
}
'@
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  $healthServer = Start-Process -FilePath $nodePath `
    -ArgumentList @(
      ('"{0}"' -f $serverPath),
      ('"{0}"' -f $versionPath)
    ) `
    -WindowStyle Hidden `
    -PassThru
  try {
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (
      [DateTime]::UtcNow -lt $deadline -and
      (-not (Test-PortOpen 3217) -or -not (Test-PortOpen 3227))
    ) {
      Start-Sleep -Milliseconds 100
    }
    Assert-True (Test-PortOpen 3217) 'fake Bridge did not start'
    Assert-True (Test-PortOpen 3227) 'fake Hub did not start'
    $env:LOCALAPPDATA = Join-Path $starterCase 'LocalAppData'
    New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null

    $readyOutput = @(
      & powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File (Join-Path $starterRelease 'start-companion.ps1') -Quiet 2>&1
    )
    $readyExit = $LASTEXITCODE
    Assert-True ($readyExit -eq 0) 'exact Hub version must start successfully'
    Assert-Match `
      ($readyOutput | Out-String) `
      ([regex]::Escape($expectedHubVersion)) `
      'successful starter output must include exact Hub version'

    Set-Content -LiteralPath $versionPath -Value '1.4.7-stale-hub' -Encoding ascii
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $staleOutput = @(
        & powershell.exe -NoProfile -ExecutionPolicy Bypass `
          -File (Join-Path $starterRelease 'start-companion.ps1') -Quiet 2>&1
      )
      $staleExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    Assert-True ($staleExit -ne 0) 'stale Hub version must fail startup'
    Assert-Match `
      ($staleOutput | Out-String) `
      'COMPANION_HUB_VERSION_MISMATCH' `
      'stale Hub must fail with an explicit version mismatch'
  } finally {
    if ($healthServer -and -not $healthServer.HasExited) {
      Stop-Process -Id $healthServer.Id -Force -ErrorAction SilentlyContinue
      [void]$healthServer.WaitForExit(3000)
    }
  }
  $passCount += 1

  [pscustomobject]@{
    suite = 'companion-upgrade-safety-powershell'
    status = 'PASS'
    pass = $passCount
    nativeStopExitFailFast = $true
    pidAndPortReleaseRequired = $true
    exactHubVersionRequired = $expectedHubVersion
    currentAndShortcutRollback = $true
    oldReleaseRestartAttempted = $true
  } | ConvertTo-Json -Depth 4
} finally {
  foreach ($name in $originalEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
  }
  if (Test-Path -LiteralPath $testRoot -PathType Container) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
