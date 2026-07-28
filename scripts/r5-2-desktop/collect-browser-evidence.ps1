[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProfilePath,
  [Parameter(Mandatory)][string]$RunId,
  [Parameter(Mandatory)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$resolvedProfile = [IO.Path]::GetFullPath($ProfilePath)
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @("chrome.exe", "msedge.exe") -and
  $_.CommandLine -and
  $_.CommandLine.IndexOf($resolvedProfile, [StringComparison]::OrdinalIgnoreCase) -ge 0
} | ForEach-Object {
  [ordered]@{
    pid = $_.ProcessId
    parentPid = $_.ParentProcessId
    executablePath = $_.ExecutablePath
    commandLine = $_.CommandLine
    sessionId = (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).SessionId
  }
}

$evidence = [ordered]@{
  run_id = $RunId
  capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  profilePath = $resolvedProfile
  processes = @($processes)
  visibleDesktopSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
}
New-Item -ItemType Directory -Force -Path (Split-Path $OutputPath -Parent) | Out-Null
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
$evidence | ConvertTo-Json -Depth 8
