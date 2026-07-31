[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = "Stop"
$resolvedOutput = [IO.Path]::GetFullPath($OutputDir)
$startedAt = (Get-Date).ToUniversalTime()
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$profileMarker = "novel-pr23-r23-r23-edge-"
$allowNames = @(
  (([char]0x5141) + ([char]0x8A31)),
  (([char]0x5141) + ([char]0x8A31) + ([char]0x5B58) + ([char]0x53D6)),
  "Allow"
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

function Write-DelegationEvidence([hashtable]$Evidence) {
  $target = Join-Path $resolvedOutput "native-allow-delegation.json"
  $json = $Evidence | ConvertTo-Json -Depth 12
  [IO.File]::WriteAllText($target, "$json`n", [Text.UTF8Encoding]::new($false))
}

function Get-Sha256([string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash($bytes)
  } finally {
    $algorithm.Dispose()
  }
  return ([BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
}

while ((Get-Date) -lt $deadline) {
  $edgeProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "msedge.exe" -and
    $_.CommandLine -and
    $_.CommandLine.IndexOf($profileMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  $edgePids = @($edgeProcesses | Select-Object -ExpandProperty ProcessId)
  if ($edgePids.Count -gt 0) {
    $mainWindows = @($edgeProcesses | ForEach-Object {
      Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    } | Where-Object { $_.MainWindowHandle -ne 0 })
    foreach ($mainWindow in $mainWindows) {
      try {
        $windowElement = [Windows.Automation.AutomationElement]::FromHandle(
          $mainWindow.MainWindowHandle
        )
        $elements = $windowElement.FindAll(
          [Windows.Automation.TreeScope]::Descendants,
          [Windows.Automation.Condition]::TrueCondition
        )
      } catch {
        continue
      }
      foreach ($element in $elements) {
        try {
          if ($edgePids -notcontains $element.Current.ProcessId) { continue }
          if ($element.Current.ControlType -ne [Windows.Automation.ControlType]::Button) { continue }
          $name = [string]$element.Current.Name
          $semanticMatch = $allowNames -contains $name -or
            $name.StartsWith(([char]0x5141) + ([char]0x8A31), [StringComparison]::Ordinal) -or
            $name.StartsWith("Allow", [StringComparison]::OrdinalIgnoreCase)
          if (-not $semanticMatch) { continue }
          $process = $edgeProcesses |
            Where-Object { $_.ProcessId -eq $element.Current.ProcessId } |
            Select-Object -First 1
          if (-not $process) { continue }
          $pattern = $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
          $pattern.Invoke()
          Write-DelegationEvidence @{
            schemaVersion = "pr23-r2-4-native-allow-delegation-v1"
            status = "INVOKED"
            explicitUserDelegation = $true
            delegatedActor = "codex"
            decisionMethod = "WINDOWS_UI_AUTOMATION"
            decisionTarget = "MICROSOFT_EDGE_NATIVE_LOCAL_NETWORK_ACCESS_ALLOW"
            humanOperatorClicked = $false
            semanticControlName = $name
            automationRole = "Button"
            processName = $process.Name
            processIdMatchedFreshAuditProfile = $true
            profileCommandLineDigest = Get-Sha256 ([string]$process.CommandLine)
            fixedScreenCoordinatesUsed = $false
            permissionInjectionUsed = $false
            browserPolicyModified = $false
            localNetworkAccessBypassUsed = $false
            startedAt = $startedAt.ToString("o")
            invokedAt = (Get-Date).ToUniversalTime().ToString("o")
          }
          exit 0
        } catch {
          continue
        }
      }
    }
  }
  Start-Sleep -Milliseconds 200
}

Write-DelegationEvidence @{
  schemaVersion = "pr23-r2-4-native-allow-delegation-v1"
  status = "PROMPT_NOT_FOUND"
  explicitUserDelegation = $true
  delegatedActor = "codex"
  decisionMethod = "WINDOWS_UI_AUTOMATION"
  humanOperatorClicked = $false
  fixedScreenCoordinatesUsed = $false
  permissionInjectionUsed = $false
  browserPolicyModified = $false
  localNetworkAccessBypassUsed = $false
  startedAt = $startedAt.ToString("o")
  completedAt = (Get-Date).ToUniversalTime().ToString("o")
  timeoutSeconds = $TimeoutSeconds
}
exit 2
