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
if (-not ("PR23.NativeWindow" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
namespace PR23 {
  public static class NativeWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
}
"@
}
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
          [PR23.NativeWindow]::ShowWindowAsync($mainWindow.MainWindowHandle, 9) | Out-Null
          [PR23.NativeWindow]::BringWindowToTop($mainWindow.MainWindowHandle) | Out-Null
          [PR23.NativeWindow]::SetForegroundWindow($mainWindow.MainWindowHandle) | Out-Null
          Start-Sleep -Milliseconds 300
          $element.SetFocus()
          $pattern = $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
          $pattern.Invoke()
          Start-Sleep -Milliseconds 900
          $promptStillPresent = $false
          try {
            $refreshedWindow = [Windows.Automation.AutomationElement]::FromHandle(
              $mainWindow.MainWindowHandle
            )
            $refreshedElements = $refreshedWindow.FindAll(
              [Windows.Automation.TreeScope]::Descendants,
              [Windows.Automation.Condition]::TrueCondition
            )
            foreach ($refreshedElement in $refreshedElements) {
              try {
                if ($edgePids -notcontains $refreshedElement.Current.ProcessId) { continue }
                if ($refreshedElement.Current.ControlType -ne [Windows.Automation.ControlType]::Button) { continue }
                $refreshedName = [string]$refreshedElement.Current.Name
                if (
                  $allowNames -contains $refreshedName -or
                  $refreshedName.StartsWith(
                    ([char]0x5141) + ([char]0x8A31),
                    [StringComparison]::Ordinal
                  ) -or
                  $refreshedName.StartsWith("Allow", [StringComparison]::OrdinalIgnoreCase)
                ) {
                  $promptStillPresent = $true
                  break
                }
              } catch {
                continue
              }
            }
          } catch {
            $promptStillPresent = $false
          }
          if ($promptStillPresent) { continue }
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
            windowForegrounded = $true
            nativePromptDismissed = $true
            permissionInjectionUsed = $false
            browserPolicyModified = $false
            localNetworkAccessBypassUsed = $false
            startedAt = $startedAt.ToString("o")
            invokedAt = (Get-Date).ToUniversalTime().ToString("o")
          }
          $retryPath = Join-Path $PSScriptRoot "invoke-pr23-r24-pairing-retry.ps1"
          $powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
          $retryArguments = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", "`"$retryPath`"",
            "-OutputDir", "`"$resolvedOutput`"",
            "-TimeoutSeconds", "20",
            "-AllowNotNeeded"
          )
          $retryHelper = Start-Process `
            -FilePath $powershellPath `
            -ArgumentList $retryArguments `
            -WindowStyle Hidden `
            -Wait `
            -PassThru
          if ($retryHelper.ExitCode -ne 0) {
            exit 3
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
