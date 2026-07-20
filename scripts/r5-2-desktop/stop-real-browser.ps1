[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProfilePath
)

$ErrorActionPreference = "Stop"
$resolvedProfile = [IO.Path]::GetFullPath($ProfilePath)
$matches = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @("chrome.exe", "msedge.exe") -and
  $_.CommandLine -and
  $_.CommandLine.IndexOf($resolvedProfile, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

foreach ($process in $matches) {
  $commandLine = [string]$process.CommandLine
  if ($commandLine -notmatch '--remote-debugging-port=' -and $commandLine -notmatch '--user-data-dir=') {
    throw "REFUSING_TO_STOP_NON_TEST_BROWSER: $($process.ProcessId)"
  }
  Stop-Process -Id $process.ProcessId -Force
}

[ordered]@{
  status = "stopped"
  profilePath = $resolvedProfile
  stoppedPids = @($matches.ProcessId)
  dailyProfileTouched = $false
} | ConvertTo-Json -Depth 4
