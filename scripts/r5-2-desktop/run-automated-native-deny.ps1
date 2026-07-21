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

function Capture-Screen([string]$Path) {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = [Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
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
    $chromePids = @(Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq "chrome.exe" -and $_.CommandLine -and
      $_.CommandLine.IndexOf($ProfilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -ExpandProperty ProcessId)
    if ($chromePids.Count) {
      $elements = [Windows.Automation.AutomationElement]::RootElement.FindAll(
        [Windows.Automation.TreeScope]::Descendants,
        [Windows.Automation.Condition]::TrueCondition
      )
      foreach ($element in $elements) {
        try {
          if ($chromePids -notcontains $element.Current.ProcessId) { continue }
          if ($element.Current.ControlType -ne [Windows.Automation.ControlType]::Button) { continue }
          if ($denyNames -notcontains $element.Current.Name) { continue }
          Capture-Screen (Join-Path $RunDirectory "native-lna-before-deny.png")
          $pattern = $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
          $pattern.Invoke()
          Start-Sleep -Milliseconds 700
          Capture-Screen (Join-Path $RunDirectory "native-lna-after-deny.png")
          return [ordered]@{
            status = "INVOKED"
            automation = "Windows UI Automation"
            elementName = $element.Current.Name
            processId = $element.Current.ProcessId
            invokedAt = (Get-Date).ToUniversalTime().ToString("o")
          }
        } catch { }
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

$arguments = @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $harnessPath,
  "-TargetUrl", $TargetUrl,
  "-ProductCommit", $ProductCommit,
  "-Browser", "chrome",
  "-Flow", "deny",
  "-ArtifactDirectory", $ArtifactDirectory,
  "-NodePath", $NodePath
)
$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = "powershell.exe"
$startInfo.Arguments = ($arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join " "
$startInfo.WorkingDirectory = $repositoryRoot
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.CreateNoWindow = $true
$startInfo.EnvironmentVariables["R1K_AUTOMATED_NATIVE_UI"] = "1"
$startInfo.EnvironmentVariables["R1K_AUTOMATED_NATIVE_UI"] = "1"
$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo
if (-not $process.Start()) { throw "HARNESS_START_FAILED" }

$lines = [Collections.Generic.List[string]]::new()
$decisionChallenge = $null
$operatorChallenge = $null
$runId = $null
$profilePath = $null
$nativeDecision = $null
while (-not $process.HasExited) {
  $line = $process.StandardOutput.ReadLine()
  if ($null -eq $line) { Start-Sleep -Milliseconds 50; continue }
  $lines.Add($line)
  if ($line -match "run_id:\s*(\S+)") { $runId = $Matches[1] }
  if ($line -match "chrome deny profile:\s*(.+?)\s*\|\s*run_id:\s*(\S+)") {
    $profilePath = $Matches[1].Trim()
    $runId = $Matches[2]
  }
  if ($line -match "Decision challenge:\s*([A-Fa-f0-9]+)") {
    $decisionChallenge = $Matches[1]
    $runDirectory = Join-Path $artifactRoot "runs\$runId"
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
        if ($operatorChallenge) {
          $process.StandardInput.WriteLine("ABORT $operatorChallenge")
          $process.StandardInput.Flush()
        } else { $process.Kill() }
      }
    } else {
      if ($operatorChallenge) {
        $process.StandardInput.WriteLine("ABORT $operatorChallenge")
        $process.StandardInput.Flush()
      } else { $process.Kill() }
    }
  }
  if ($line -match "Operator challenge:\s*([A-Fa-f0-9]+)") { $operatorChallenge = $Matches[1] }
}
$process.WaitForExit()
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
