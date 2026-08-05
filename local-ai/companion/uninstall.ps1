param(
  [switch]$RemoveAllReleases
)

$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'NovelLocalAICompanion'
$startupShortcut = Join-Path $env:APPDATA `
  'Microsoft\Windows\Start Menu\Programs\Startup\Novel Local AI Companion.lnk'
$currentPath = Join-Path $installRoot 'current.txt'

if (Test-Path -LiteralPath $currentPath -PathType Leaf) {
  $releaseRoot = (Get-Content -LiteralPath $currentPath -Raw).Trim()
  $bridge = Join-Path $releaseRoot 'bridge\novel-local-ai.ps1'
  $hub = Join-Path $releaseRoot 'private-hub\novel-private-hub.ps1'
  if (Test-Path -LiteralPath $bridge -PathType Leaf) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bridge stop | Out-Null
  }
  if (Test-Path -LiteralPath $hub -PathType Leaf) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hub stop | Out-Null
  }
}

if (Test-Path -LiteralPath $startupShortcut -PathType Leaf) {
  Remove-Item -LiteralPath $startupShortcut -Force
}

if ($RemoveAllReleases -and (Test-Path -LiteralPath $installRoot -PathType Container)) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($installRoot)
  $localAppData = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
  if (-not $resolvedRoot.StartsWith($localAppData, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'COMPANION_UNINSTALL_PATH_OUTSIDE_LOCALAPPDATA'
  }
  Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}

[pscustomobject]@{
  ok = $true
  autostartRemoved = $true
  releasesRemoved = [bool]$RemoveAllReleases
} | ConvertTo-Json
