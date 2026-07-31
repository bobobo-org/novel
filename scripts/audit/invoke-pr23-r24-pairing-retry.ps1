[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
$resolvedOutput = [IO.Path]::GetFullPath($OutputDir)
$startedAt = (Get-Date).ToUniversalTime()
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$profileMarker = "novel-pr23-r23-r23-edge-"
$pairingName =
  ([char]0x958B) + ([char]0x59CB) + ([char]0x5B89) +
  ([char]0x5168) + ([char]0x914D) + ([char]0x5C0D)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ("PR23.PairingWindow" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
namespace PR23 {
  public static class PairingWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
}
"@
}
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

function Write-RetryEvidence([hashtable]$Evidence) {
  $target = Join-Path $resolvedOutput "native-pairing-retry.json"
  $json = $Evidence | ConvertTo-Json -Depth 12
  [IO.File]::WriteAllText($target, "$json`n", [Text.UTF8Encoding]::new($false))
}

while ((Get-Date) -lt $deadline) {
  $edgeProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "msedge.exe" -and
    $_.CommandLine -and
    $_.CommandLine.IndexOf($profileMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  $edgePids = @($edgeProcesses | Select-Object -ExpandProperty ProcessId)
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
        if ([string]$element.Current.Name -ne $pairingName) { continue }
        [PR23.PairingWindow]::ShowWindowAsync($mainWindow.MainWindowHandle, 9) | Out-Null
        [PR23.PairingWindow]::BringWindowToTop($mainWindow.MainWindowHandle) | Out-Null
        [PR23.PairingWindow]::SetForegroundWindow($mainWindow.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 300
        $element.SetFocus()
        $pattern = $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        Write-RetryEvidence @{
          schemaVersion = "pr23-r2-4-native-pairing-retry-v1"
          status = "INVOKED"
          reason = "NATIVE_PERMISSION_DECISION_INTERRUPTED_INITIAL_PAIRING_FETCH"
          delegatedActor = "codex"
          decisionMethod = "WINDOWS_UI_AUTOMATION"
          decisionTarget = "PRODUCT_START_SECURE_PAIRING"
          semanticControlName = $pairingName
          automationRole = "Button"
          processName = "msedge.exe"
          processIdMatchedFreshAuditProfile = $true
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
  Start-Sleep -Milliseconds 200
}

Write-RetryEvidence @{
  schemaVersion = "pr23-r2-4-native-pairing-retry-v1"
  status = "PAIRING_CONTROL_NOT_FOUND"
  reason = "NATIVE_PERMISSION_DECISION_INTERRUPTED_INITIAL_PAIRING_FETCH"
  delegatedActor = "codex"
  decisionMethod = "WINDOWS_UI_AUTOMATION"
  fixedScreenCoordinatesUsed = $false
  permissionInjectionUsed = $false
  browserPolicyModified = $false
  localNetworkAccessBypassUsed = $false
  startedAt = $startedAt.ToString("o")
  completedAt = (Get-Date).ToUniversalTime().ToString("o")
}
exit 2
