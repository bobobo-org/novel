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
  $packageRoot = Split-Path -Parent $manifestPath
  $releaseRoot = Join-Path $resolvedInstallRoot ('releases\' + $manifest.version)
  New-Item -ItemType Directory -Path (Split-Path -Parent $releaseRoot) -Force | Out-Null

  $currentPath = Join-Path $resolvedInstallRoot 'current.txt'
  if (Test-Path -LiteralPath $currentPath -PathType Leaf) {
    $oldRelease = (Get-Content -LiteralPath $currentPath -Raw).Trim()
    foreach ($relativeScript in @(
      'bridge\novel-local-ai.ps1',
      'private-hub\novel-private-hub.ps1'
    )) {
      $stopScript = Join-Path $oldRelease $relativeScript
      if (Test-Path -LiteralPath $stopScript -PathType Leaf) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass `
          -File $stopScript stop | Out-Null
      }
    }
  }

  if (Test-Path -LiteralPath $releaseRoot -PathType Container) {
    $resolvedRelease = [System.IO.Path]::GetFullPath($releaseRoot)
    if (-not $resolvedRelease.StartsWith($resolvedInstallRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'COMPANION_RELEASE_PATH_OUTSIDE_INSTALL_ROOT'
    }
    Remove-Item -LiteralPath $resolvedRelease -Recurse -Force
  }
  Move-Item -LiteralPath $packageRoot -Destination $releaseRoot
  Set-Content -LiteralPath $currentPath -Value $releaseRoot -Encoding utf8

  if (-not $SkipAutostart) {
    $startupDirectory = Join-Path $env:APPDATA `
      'Microsoft\Windows\Start Menu\Programs\Startup'
    New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null
    $startupShortcut = Join-Path $startupDirectory 'Novel Local AI Companion.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startupShortcut)
    $shortcut.TargetPath = 'powershell.exe'
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Quiet' -f `
      (Join-Path $releaseRoot 'start-companion.ps1')
    $shortcut.WorkingDirectory = $releaseRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Automatically starts Novel Local AI Bridge and Private Hub.'
    $shortcut.Save()
  }

  if (-not $SkipLaunch) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass `
      -File (Join-Path $releaseRoot 'start-companion.ps1')
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
    starterModelRequested = -not $SkipStarterModel
  } | ConvertTo-Json -Depth 4
} finally {
  if (Test-Path -LiteralPath $temporaryRoot -PathType Container) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
