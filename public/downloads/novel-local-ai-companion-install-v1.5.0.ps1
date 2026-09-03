param(
  [string]$ArchivePath = '',
  [string]$InstallRoot = '',
  [switch]$SkipDependencyInstall,
  [switch]$SkipStarterModel,
  [switch]$SkipAutostart,
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$expectedPrivateHubVersion = '1.5.0-public-lounge-attestation-v5'
$serviceStopTimeoutMs = 12000
if (
  $env:NOVEL_COMPANION_INSTALL_TEST_MODE -eq '1' -and
  $env:NOVEL_COMPANION_INSTALL_TEST_STOP_TIMEOUT_MS
) {
  $serviceStopTimeoutMs = [Math]::Max(
    250,
    [int]$env:NOVEL_COMPANION_INSTALL_TEST_STOP_TIMEOUT_MS
  )
}

if (-not $InstallRoot) {
  $InstallRoot = Join-Path $env:LOCALAPPDATA 'NovelLocalAICompanion'
}
$resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$resolvedLocalAppData = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
if (
  $resolvedInstallRoot -eq $resolvedLocalAppData -or
  -not $resolvedInstallRoot.StartsWith(
    $resolvedLocalAppData,
    [System.StringComparison]::OrdinalIgnoreCase
  )
) {
  throw 'COMPANION_INSTALL_PATH_OUTSIDE_LOCALAPPDATA'
}

function Resolve-NodeExecutable {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
  )
  return $candidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
}

function Resolve-OllamaExecutable {
  $command = Get-Command ollama.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
  )
  return $candidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
}

function Install-WingetPackage([string]$Id, [string]$Label) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "$Label is missing and winget is unavailable. Install Microsoft App Installer first."
  }
  Write-Host "Installing $Label..."
  & $winget.Source install --id $Id --exact --source winget `
    --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "$Label installation failed (winget exit $LASTEXITCODE)."
  }
}

function Invoke-CompanionPowerShell(
  [string]$ScriptPath,
  [string[]]$Arguments,
  [string]$FailureCode
) {
  # Windows PowerShell can promote a native stderr line to a terminating
  # NativeCommandError when the caller uses ErrorActionPreference=Stop. Keep
  # that from bypassing the explicit native exit-code check below.
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $commandOutput = @(
      & powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File $ScriptPath @Arguments 2>&1
    )
    $nativeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($nativeExitCode -ne 0) {
    throw ('{0}: exit {1}' -f $FailureCode, $nativeExitCode)
  }
  return ($commandOutput | Out-String)
}

function Test-LoopbackPortOpen([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  $asyncResult = $null
  try {
    $asyncResult = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne(250)) { return $false }
    $client.EndConnect($asyncResult)
    return $true
  } catch {
    return $false
  } finally {
    if ($asyncResult -and $asyncResult.AsyncWaitHandle) {
      $asyncResult.AsyncWaitHandle.Close()
    }
    $client.Dispose()
  }
}

function Get-CompanionRuntimeProcessIdentifier([string]$StatePath) {
  try {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return 0 }
    $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    return [int]$state.pid
  } catch {
    return 0
  }
}

function Wait-CompanionServiceReleased(
  [string]$Label,
  [int]$Port,
  [int]$ProcessIdentifier
) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($serviceStopTimeoutMs)
  do {
    $processAlive = $false
    if ($ProcessIdentifier -gt 0) {
      $processAlive = [bool](
        Get-Process -Id $ProcessIdentifier -ErrorAction SilentlyContinue
      )
    }
    $portOpen = Test-LoopbackPortOpen $Port
    if (-not $processAlive -and -not $portOpen) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)

  throw (
    'COMPANION_OLD_SERVICE_NOT_RELEASED: {0}; pid={1}; port={2}' -f
      $Label,
      $ProcessIdentifier,
      $Port
  )
}

function Stop-CompanionRelease([string]$ReleasePath, [string]$FailurePrefix) {
  $services = @(
    [pscustomobject]@{
      label = 'Local Bridge'
      relativeScript = 'bridge\novel-local-ai.ps1'
      statePath = Join-Path $env:LOCALAPPDATA 'NovelLocalBridge\runtime.json'
      port = 3217
    },
    [pscustomobject]@{
      label = 'Private Hub'
      relativeScript = 'private-hub\novel-private-hub.ps1'
      statePath = Join-Path $env:LOCALAPPDATA 'NovelPrivateHub\runtime.json'
      port = 3227
    }
  )

  foreach ($service in $services) {
    $processIdentifier = Get-CompanionRuntimeProcessIdentifier $service.statePath
    $stopScript = Join-Path $ReleasePath $service.relativeScript
    if (Test-Path -LiteralPath $stopScript -PathType Leaf) {
      [void](Invoke-CompanionPowerShell `
        $stopScript `
        @('stop') `
        ($FailurePrefix + '_' + ($service.label -replace ' ', '_').ToUpperInvariant())
      )
    } elseif (Test-LoopbackPortOpen $service.port) {
      throw (
        '{0}_ENTRYPOINT_MISSING: {1}' -f
          $FailurePrefix,
          $stopScript
      )
    }
    Wait-CompanionServiceReleased `
      $service.label `
      $service.port `
      $processIdentifier
  }
}

function Get-PrivateHubHealth {
  try {
    return Invoke-RestMethod -Uri 'http://127.0.0.1:3227/health' `
      -Method Get `
      -Headers @{
        Origin = 'https://novel-orcin.vercel.app'
        'X-Private-Hub-Protocol' = 'novel-private-hub/v1'
      } `
      -TimeoutSec 3
  } catch {
    return $null
  }
}

function Get-ShortcutSnapshot([string]$ShortcutPath) {
  if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) {
    return [pscustomobject]@{ exists = $false }
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  return [pscustomobject]@{
    exists = $true
    targetPath = $shortcut.TargetPath
    arguments = $shortcut.Arguments
    workingDirectory = $shortcut.WorkingDirectory
    windowStyle = $shortcut.WindowStyle
    description = $shortcut.Description
    iconLocation = $shortcut.IconLocation
    hotkey = $shortcut.Hotkey
  }
}

function Set-CompanionShortcut([string]$ShortcutPath, [string]$ReleasePath) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $ShortcutPath) `
    -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = 'powershell.exe'
  $shortcut.Arguments = (
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Quiet' -f
      (Join-Path $ReleasePath 'start-companion.ps1')
  )
  $shortcut.WorkingDirectory = $ReleasePath
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Automatically starts Novel Local AI Bridge and Private Hub.'
  $shortcut.Save()
}

function Restore-ShortcutSnapshot([string]$ShortcutPath, $Snapshot) {
  if (-not $Snapshot.exists) {
    Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue
    return
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $ShortcutPath) `
    -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $Snapshot.targetPath
  $shortcut.Arguments = $Snapshot.arguments
  $shortcut.WorkingDirectory = $Snapshot.workingDirectory
  $shortcut.WindowStyle = $Snapshot.windowStyle
  $shortcut.Description = $Snapshot.description
  $shortcut.IconLocation = $Snapshot.iconLocation
  $shortcut.Hotkey = $Snapshot.hotkey
  $shortcut.Save()
}

$node = Resolve-NodeExecutable
if (-not $node -and -not $SkipDependencyInstall) {
  Install-WingetPackage 'OpenJS.NodeJS.LTS' 'Node.js LTS'
  $node = Resolve-NodeExecutable
}
if (-not $node) { throw 'COMPANION_NODE_NOT_FOUND' }
$nodeMajor = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "COMPANION_NODE_UNSUPPORTED: $nodeMajor" }

$ollama = Resolve-OllamaExecutable
if (-not $ollama -and -not $SkipDependencyInstall) {
  Install-WingetPackage 'Ollama.Ollama' 'Ollama'
  $ollama = Resolve-OllamaExecutable
}
if (-not $ollama) { throw 'COMPANION_OLLAMA_NOT_FOUND' }

if (-not $ArchivePath) {
  $ArchivePath = Get-ChildItem -LiteralPath $PSScriptRoot `
    -Filter 'novel-local-ai-companion-v*.zip' -File |
    Sort-Object Name -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ArchivePath -or -not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
  throw 'COMPANION_ARCHIVE_NOT_FOUND'
}

$temporaryRoot = Join-Path $resolvedInstallRoot ('.install-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
try {
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $temporaryRoot -Force
  $manifestPath = Get-ChildItem -LiteralPath $temporaryRoot -Filter manifest.json `
    -File -Recurse | Select-Object -First 1 -ExpandProperty FullName
  if (-not $manifestPath) { throw 'COMPANION_MANIFEST_NOT_FOUND' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 'novel-local-ai-companion-manifest-v1') {
    throw 'COMPANION_MANIFEST_INVALID'
  }
  if (
    $manifest.version -ne '1.5.0' -or
    $manifest.privateHubVersion -ne $expectedPrivateHubVersion
  ) {
    throw 'COMPANION_RELEASE_IDENTITY_INVALID'
  }
  $packageRoot = Split-Path -Parent $manifestPath
  $releaseRoot = Join-Path $resolvedInstallRoot ('releases\' + $manifest.version)
  New-Item -ItemType Directory -Path (Split-Path -Parent $releaseRoot) -Force | Out-Null

  $currentPath = Join-Path $resolvedInstallRoot 'current.txt'
  $hadCurrent = Test-Path -LiteralPath $currentPath -PathType Leaf
  $oldCurrentBytes = if ($hadCurrent) {
    [System.IO.File]::ReadAllBytes($currentPath)
  } else {
    $null
  }
  $oldRelease = if ($hadCurrent) {
    (Get-Content -LiteralPath $currentPath -Raw).Trim()
  } else {
    ''
  }
  $startupDirectory = Join-Path $env:APPDATA `
    'Microsoft\Windows\Start Menu\Programs\Startup'
  $startupShortcut = Join-Path $startupDirectory 'Novel Local AI Companion.lnk'
  $oldShortcut = if (-not $SkipAutostart) {
    Get-ShortcutSnapshot $startupShortcut
  } else {
    $null
  }
  $releaseBackupRoot = ''
  $newReleaseInstalled = $false
  $oldRestartRequired = $false

  try {
    if ($oldRelease) {
      $oldRestartRequired = $true
      Stop-CompanionRelease $oldRelease 'COMPANION_OLD_SERVICE_STOP_FAILED'
    } else {
      Wait-CompanionServiceReleased 'Local Bridge' 3217 0
      Wait-CompanionServiceReleased 'Private Hub' 3227 0
    }

    if (Test-Path -LiteralPath $releaseRoot -PathType Container) {
      $resolvedRelease = [System.IO.Path]::GetFullPath($releaseRoot)
      if (-not $resolvedRelease.StartsWith($resolvedInstallRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'COMPANION_RELEASE_PATH_OUTSIDE_INSTALL_ROOT'
      }
      $releaseBackupRoot = Join-Path `
        (Split-Path -Parent $releaseRoot) `
        ('.backup-' + [guid]::NewGuid())
      Move-Item -LiteralPath $resolvedRelease -Destination $releaseBackupRoot
    }
    Move-Item -LiteralPath $packageRoot -Destination $releaseRoot
    $newReleaseInstalled = $true
    Set-Content -LiteralPath $currentPath -Value $releaseRoot -Encoding utf8

    if (-not $SkipAutostart) {
      Set-CompanionShortcut $startupShortcut $releaseRoot
    }

    $verifiedHubVersion = $null
    if (-not $SkipLaunch) {
      [void](Invoke-CompanionPowerShell `
        (Join-Path $releaseRoot 'start-companion.ps1') `
        @('-Quiet') `
        'COMPANION_START_FAILED'
      )
      $hubHealth = Get-PrivateHubHealth
      $verifiedHubVersion = [string]$hubHealth.hubVersion
      if (
        -not $hubHealth -or
        $hubHealth.hubProcessAlive -ne $true -or
        $verifiedHubVersion -ne $expectedPrivateHubVersion
      ) {
        throw (
          'COMPANION_HUB_VERSION_MISMATCH: expected {0}, received {1}' -f
            $expectedPrivateHubVersion,
            $(if ($verifiedHubVersion) { $verifiedHubVersion } else { '<unreachable>' })
        )
      }
    }

    if (-not $SkipStarterModel) {
      $models = & $ollama list 2>$null | Out-String
      if ($models -notmatch 'qwen2\.5:3b') {
        Write-Host 'Installing the qwen2.5:3b starter model. Download time depends on the network...'
        & $ollama pull qwen2.5:3b
        if ($LASTEXITCODE -ne 0) {
          Write-Warning 'Companion is installed, but qwen2.5:3b did not finish downloading. Run ollama pull qwen2.5:3b later.'
        }
      }
    }

    if ($releaseBackupRoot -and (Test-Path -LiteralPath $releaseBackupRoot -PathType Container)) {
      Remove-Item -LiteralPath $releaseBackupRoot -Recurse -Force
    }
    $oldRestartRequired = $false

    Write-Host ''
    Write-Host 'Installation complete. Local Bridge and Private Hub will start at Windows logon.' -ForegroundColor Green
    Write-Host 'Return to Novel Studio and refresh once. Official origins need no password or pairing code.'
    [pscustomobject]@{
      ok = $true
      version = $manifest.version
      installRoot = $resolvedInstallRoot
      releaseRoot = $releaseRoot
      autostart = -not $SkipAutostart
      launched = -not $SkipLaunch
      hubVersion = $verifiedHubVersion
      starterModelRequested = -not $SkipStarterModel
    } | ConvertTo-Json -Depth 4
  } catch {
    $installFailure = $_
    $rollbackErrors = @()

    if ($newReleaseInstalled -and -not $SkipLaunch) {
      try {
        Stop-CompanionRelease $releaseRoot 'COMPANION_NEW_SERVICE_STOP_FAILED'
      } catch {
        $rollbackErrors += $_.Exception.Message
      }
    }
    try {
      if ($newReleaseInstalled -and (Test-Path -LiteralPath $releaseRoot -PathType Container)) {
        Remove-Item -LiteralPath $releaseRoot -Recurse -Force
      }
      if ($releaseBackupRoot -and (Test-Path -LiteralPath $releaseBackupRoot -PathType Container)) {
        Move-Item -LiteralPath $releaseBackupRoot -Destination $releaseRoot
      }
    } catch {
      $rollbackErrors += $_.Exception.Message
    }
    try {
      if ($hadCurrent) {
        [System.IO.File]::WriteAllBytes($currentPath, $oldCurrentBytes)
      } else {
        Remove-Item -LiteralPath $currentPath -Force -ErrorAction SilentlyContinue
      }
      if (-not $SkipAutostart) {
        Restore-ShortcutSnapshot $startupShortcut $oldShortcut
      }
    } catch {
      $rollbackErrors += $_.Exception.Message
    }
    if ($oldRestartRequired -and $oldRelease) {
      $oldStartScript = Join-Path $oldRelease 'start-companion.ps1'
      try {
        if (-not (Test-Path -LiteralPath $oldStartScript -PathType Leaf)) {
          throw "COMPANION_ROLLBACK_START_ENTRYPOINT_MISSING: $oldStartScript"
        }
        [void](Invoke-CompanionPowerShell `
          $oldStartScript `
          @('-Quiet') `
          'COMPANION_ROLLBACK_OLD_START_FAILED'
        )
      } catch {
        $rollbackErrors += $_.Exception.Message
      }
    }

    $rollbackStatus = if ($rollbackErrors.Count -eq 0) {
      'COMPANION_ROLLBACK_SUCCEEDED'
    } else {
      'COMPANION_ROLLBACK_INCOMPLETE: ' + ($rollbackErrors -join ' | ')
    }
    throw ('{0}; {1}' -f $installFailure.Exception.Message, $rollbackStatus)
  }
} finally {
  if (Test-Path -LiteralPath $temporaryRoot -PathType Container) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
