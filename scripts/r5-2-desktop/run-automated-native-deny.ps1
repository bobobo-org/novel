[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$TargetUrl,
  [Parameter(Mandatory)][string]$ProductCommit,
  [Parameter(Mandatory)][string]$ArtifactDirectory,
  [string]$NodePath = "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [int]$PromptTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$harnessPath = Join-Path $repositoryRoot "scripts\run-r5-2r1a-real-browser.ps1"
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot $ArtifactDirectory))
$origin = ([Uri]$TargetUrl).GetLeftPart([UriPartial]::Authority)
$runtimeRoot = Join-Path $env:LOCALAPPDATA "NovelLocalBridge"
$launcherPath = Join-Path $repositoryRoot "local-ai\bridge\launcher.mjs"
$expectedProfilePath = Join-Path $artifactRoot "browser-profiles\chrome-deny"
$defaultChromeProfile = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

function Write-Utf8Json([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Capture-Rectangle([string]$Path, $Rectangle) {
  Add-Type -AssemblyName System.Drawing
  $width = [Math]::Max(1, [int][Math]::Ceiling($Rectangle.Width))
  $height = [Math]::Max(1, [int][Math]::Ceiling($Rectangle.Height))
  $left = [int][Math]::Floor($Rectangle.Left)
  $top = [int][Math]::Floor($Rectangle.Top)
  $bitmap = [Drawing.Bitmap]::new($width, $height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Show-TestWindow([IntPtr]$WindowHandle) {
  if (-not ("R1K.NativeWindow" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
namespace R1K {
  public static class NativeWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
  }
}
"@
  }
  [R1K.NativeWindow]::ShowWindowAsync($WindowHandle, 9) | Out-Null
  [R1K.NativeWindow]::BringWindowToTop($WindowHandle) | Out-Null
  [R1K.NativeWindow]::SetForegroundWindow($WindowHandle) | Out-Null
  [R1K.NativeWindow]::SetWindowPos($WindowHandle, [IntPtr](-1), 0, 0, 0, 0, 0x43) | Out-Null
  Start-Sleep -Milliseconds 500
}

function Clear-TestWindowTopmost([IntPtr]$WindowHandle) {
  [R1K.NativeWindow]::SetWindowPos($WindowHandle, [IntPtr](-2), 0, 0, 0, 0, 0x43) | Out-Null
}

function Capture-Window([string]$Path, [IntPtr]$WindowHandle, $Rectangle) {
  Add-Type -AssemblyName System.Drawing
  if (-not ("R1K.WindowCapture" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
namespace R1K {
  public static class WindowCapture {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  }
}
"@
  }
  $width = [Math]::Max(1, [int][Math]::Ceiling($Rectangle.Width))
  $height = [Math]::Max(1, [int][Math]::Ceiling($Rectangle.Height))
  $bitmap = [Drawing.Bitmap]::new($width, $height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  try {
    if (-not [R1K.WindowCapture]::PrintWindow($WindowHandle, $hdc, 2)) {
      throw "PrintWindow failed for the verified test browser window."
    }
  } finally {
    $graphics.ReleaseHdc($hdc)
    $graphics.Dispose()
  }
  try { $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png) }
  finally { $bitmap.Dispose() }
}

function Get-LoopbackPermission([string]$ProfilePath) {
  $preferencesPath = Join-Path $ProfilePath "Default\Preferences"
  if (-not (Test-Path -LiteralPath $preferencesPath)) { return $null }
  try {
    $preferences = [IO.File]::ReadAllText($preferencesPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    $row = $preferences.profile.content_settings.exceptions.loopback_network.PSObject.Properties |
      Where-Object { $_.Name.StartsWith("$origin`:443,", [StringComparison]::OrdinalIgnoreCase) } |
      Select-Object -First 1
    if ($row) { return [int]$row.Value.setting }
  } catch { return $null }
  return $null
}

function Invoke-NativeDeny([string]$ProfilePath, [string]$RunDirectory) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $deadline = (Get-Date).AddSeconds($PromptTimeoutSeconds)
  $denyNames = @(
    (([char]0x4E0D) + ([char]0x5141) + ([char]0x8A31)),
    (([char]0x5C01) + ([char]0x9396)),
    "Don't allow",
    "Block"
  )
  while ((Get-Date) -lt $deadline) {
    $chromeProcesses = @(Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq "chrome.exe" -and $_.CommandLine -and
      $_.CommandLine.IndexOf($ProfilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    $chromePids = @($chromeProcesses | Select-Object -ExpandProperty ProcessId)
    if ($chromePids.Count) {
      $mainChrome = $chromeProcesses | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if (-not $mainChrome) { Start-Sleep -Milliseconds 250; continue }
      $windowElement = [Windows.Automation.AutomationElement]::FromHandle($mainChrome.MainWindowHandle)
      $windowBounds = $windowElement.Current.BoundingRectangle
      $elements = [Windows.Automation.AutomationElement]::RootElement.FindAll(
        [Windows.Automation.TreeScope]::Descendants,
        [Windows.Automation.Condition]::TrueCondition
      )
      foreach ($element in $elements) {
        try {
          if ($chromePids -notcontains $element.Current.ProcessId) { continue }
          if ($element.Current.ControlType -ne [Windows.Automation.ControlType]::Button) { continue }
          if ($denyNames -notcontains $element.Current.Name) { continue }
          $elementName = $element.Current.Name
          $elementProcessId = $element.Current.ProcessId
          $elementBounds = $element.Current.BoundingRectangle
          if ($windowBounds.Width -lt 300 -or $windowBounds.Height -lt 200) { continue }
          $windowTitle = $windowElement.Current.Name
          Show-TestWindow $mainChrome.MainWindowHandle
          Capture-Rectangle (Join-Path $RunDirectory "native-lna-before-deny.png") $windowBounds
          $pattern = $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
          $pattern.Invoke()
          Start-Sleep -Milliseconds 700
          Capture-Rectangle (Join-Path $RunDirectory "native-lna-after-deny.png") $windowBounds
          Clear-TestWindowTopmost $mainChrome.MainWindowHandle
          return [ordered]@{
            status = "INVOKED"
            automation = "Windows UI Automation"
            elementName = $elementName
            processId = $elementProcessId
            processMatchedProfile = $chromePids -contains $elementProcessId
            mainBrowserProcessId = $mainChrome.Id
            mainWindowHandle = $mainChrome.MainWindowHandle
            mainWindowTitle = $windowTitle
            screenshotMethod = "verified-window-topmost-screen-rectangle"
            elementBounds = [ordered]@{ left = $elementBounds.Left; top = $elementBounds.Top; width = $elementBounds.Width; height = $elementBounds.Height }
            windowBounds = [ordered]@{ left = $windowBounds.Left; top = $windowBounds.Top; width = $windowBounds.Width; height = $windowBounds.Height }
            invokedAt = (Get-Date).ToUniversalTime().ToString("o")
          }
        } catch {
          if ($mainChrome -and $mainChrome.MainWindowHandle) {
            try { Clear-TestWindowTopmost $mainChrome.MainWindowHandle } catch { }
          }
        }
      }
    }
    Start-Sleep -Milliseconds 250
  }
  return [ordered]@{ status = "PROMPT_NOT_TRIGGERED"; waitedSeconds = $PromptTimeoutSeconds }
}

$preflight = [ordered]@{
  schemaVersion = "r1k-automated-deny-preflight-v1"
  capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  targetUrl = $TargetUrl
  origin = $origin
  harnessCommit = (git -C $repositoryRoot rev-parse HEAD).Trim()
  productCommit = $ProductCommit
  bridgeListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3217 -ErrorAction SilentlyContinue).Count
  enrolledOrigin = $false
  expectedProfilePath = $expectedProfilePath
  profileDidNotExist = -not (Test-Path -LiteralPath $expectedProfilePath)
  existingTestBrowsers = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @("chrome.exe", "msedge.exe") -and $_.CommandLine -and
    $_.CommandLine.IndexOf($expectedProfilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }).Count
  existingPairingFile = Test-Path -LiteralPath (Join-Path $runtimeRoot "pairing.json")
  existingRuntimeFile = Test-Path -LiteralPath (Join-Path $runtimeRoot "runtime.json")
  defaultChromeProfileUsed = $expectedProfilePath.StartsWith($defaultChromeProfile, [StringComparison]::OrdinalIgnoreCase)
  existingLnaPermission = $false
}
$originList = & $NodePath $launcherPath origin list | Out-String | ConvertFrom-Json
$preflight.enrolledOrigin = @($originList.enrolledOrigins | Where-Object { $_.origin -eq $origin }).Count -gt 0
$preflight.result = if (
  $preflight.bridgeListeners -eq 0 -and
  -not $preflight.enrolledOrigin -and
  $preflight.profileDidNotExist -and
  $preflight.existingTestBrowsers -eq 0 -and
  -not $preflight.existingPairingFile -and
  -not $preflight.existingRuntimeFile -and
  -not $preflight.defaultChromeProfileUsed -and
  -not $preflight.existingLnaPermission
) { "PASS" } else { "FAIL" }
Write-Utf8Json (Join-Path $artifactRoot "automated-deny-preflight.json") $preflight
if ($preflight.result -ne "PASS") { throw "AUTOMATED_DENY_PREFLIGHT_FAILED" }

$adapterPath = Join-Path $repositoryRoot "scripts\r5-2-desktop\local-cdp-adapter.mjs"
$runId = "chrome-deny-" + [guid]::NewGuid().ToString("N")
$profilePath = $expectedProfilePath
$runDirectory = Join-Path $artifactRoot "runs\$runId"
$chromeVersion = (Get-Item "C:\Program Files\Google\Chrome\Application\chrome.exe").VersionInfo.ProductVersion
$arguments = @(
  $adapterPath,
  "--browser", "chrome",
  "--flow", "deny",
  "--target-url", $TargetUrl,
  "--profile", $profilePath,
  "--artifacts", $artifactRoot,
  "--run-id", $runId,
  "--browser-version", $chromeVersion,
  "--harness-pid", $PID,
  "--automated-native-ui", "windows-ui-automation"
)
$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $NodePath
$startInfo.Arguments = ($arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join " "
$startInfo.WorkingDirectory = $repositoryRoot
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.CreateNoWindow = $true
$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo

$lines = [Collections.Generic.List[string]]::new()
$decisionChallenge = $null
$operatorChallenge = $null
$nativeDecision = $null
$originAdded = $false
$bridgeStarted = $false
$processStarted = $false
try {
  $originAdd = & $NodePath $launcherPath origin add $origin --confirm $origin | Out-String | ConvertFrom-Json
  if (-not $originAdd.ok) { throw "ORIGIN_ENROLLMENT_FAILED" }
  $originAdded = $true
  $bridgeStart = & $NodePath $launcherPath start --origin $origin | Out-String | ConvertFrom-Json
  if (-not $bridgeStart.ok) { throw "BRIDGE_START_FAILED" }
  $bridgeStarted = $true
  if (-not $process.Start()) { throw "HARNESS_START_FAILED" }
  $processStarted = $true
  while (-not $process.HasExited) {
    $line = $process.StandardOutput.ReadLine()
    if ($null -eq $line) { Start-Sleep -Milliseconds 50; continue }
    $lines.Add($line)
    if ($line -match "Operator challenge:\s*([A-Fa-f0-9]+)") { $operatorChallenge = $Matches[1] }
    if ($line -match "Decision challenge:\s*([A-Fa-f0-9]+)") {
      $decisionChallenge = $Matches[1]
      $nativeDecision = Invoke-NativeDeny -ProfilePath $profilePath -RunDirectory $runDirectory
      Write-Utf8Json (Join-Path $runDirectory "automated-native-decision.json") $nativeDecision
      if ($nativeDecision.status -eq "INVOKED") {
        $permissionDeadline = (Get-Date).AddSeconds(10)
        do {
          $permission = Get-LoopbackPermission -ProfilePath $profilePath
          if ($permission -eq 2) { break }
          Start-Sleep -Milliseconds 250
        } while ((Get-Date) -lt $permissionDeadline)
        if ($permission -eq 2) {
          $process.StandardInput.WriteLine("CONTINUE $decisionChallenge")
          $process.StandardInput.Flush()
        } else {
          $nativeDecision.status = "DENY_NOT_PERSISTED"
          Write-Utf8Json (Join-Path $runDirectory "automated-native-decision.json") $nativeDecision
          $process.StandardInput.WriteLine("ABORT $operatorChallenge")
          $process.StandardInput.Flush()
        }
      } else {
        $process.StandardInput.WriteLine("ABORT $operatorChallenge")
        $process.StandardInput.Flush()
      }
    }
  }
  $process.WaitForExit()
} finally {
  if ($processStarted -and -not $process.HasExited) { $process.Kill() }
  if ($bridgeStarted) { & $NodePath $launcherPath stop | Out-Null }
  if ($originAdded) { & $NodePath $launcherPath origin revoke $origin --confirm $origin | Out-Null }
}
$stderr = $process.StandardError.ReadToEnd()
[IO.File]::WriteAllLines((Join-Path $artifactRoot "automated-harness.stdout.log"), $lines, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $artifactRoot "automated-harness.stderr.log"), $stderr, [Text.UTF8Encoding]::new($false))

$summary = [ordered]@{
  schemaVersion = "r1k-automated-deny-summary-v1"
  completedAt = (Get-Date).ToUniversalTime().ToString("o")
  run_id = $runId
  profilePath = $profilePath
  harnessExitCode = $process.ExitCode
  nativeDecision = $nativeDecision
  permissionSetting = if ($profilePath) { Get-LoopbackPermission -ProfilePath $profilePath } else { $null }
  humanDecision = "NOT_USED"
  decisionMode = "AUTOMATED_NATIVE_UI"
}
Write-Utf8Json (Join-Path $artifactRoot "automated-deny-summary.json") $summary
$summary | ConvertTo-Json -Depth 12
