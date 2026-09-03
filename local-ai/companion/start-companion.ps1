param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $releaseRoot 'bridge\novel-local-ai.ps1'
$hubScript = Join-Path $releaseRoot 'private-hub\novel-private-hub.ps1'
$expectedPrivateHubVersion = '1.5.0-public-lounge-attestation-v5'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'NovelLocalAICompanion'
$logDirectory = Join-Path $runtimeRoot 'logs'
$logPath = Join-Path $logDirectory 'startup.log'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-CompanionLog([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date).ToString('o'), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
  if (-not $Quiet) { Write-Host $Message }
}

function Find-OllamaExecutable {
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

function Test-OllamaReady {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' `
      -Method Get -TimeoutSec 2
    return [bool]$response.version
  } catch {
    return $false
  }
}

function Start-CompanionService([string]$ScriptPath) {
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    ('"{0}"' -f $ScriptPath),
    'start'
  )
  return Start-Process -FilePath 'powershell.exe' `
    -ArgumentList $arguments -WindowStyle Hidden -PassThru
}

function Get-CompanionServiceHealth(
  [string]$Uri,
  [string]$ProtocolHeader,
  [string]$ProtocolValue
) {
  try {
    $headers = @{ Origin = 'https://novel-orcin.vercel.app' }
    $headers[$ProtocolHeader] = $ProtocolValue
    $response = Invoke-RestMethod -Uri $Uri -Method Get -Headers $headers `
      -TimeoutSec 2
    return $response
  } catch {
    return $null
  }
}

function Stop-StarterProcess([System.Diagnostics.Process]$Starter) {
  if ($Starter -and -not $Starter.HasExited) {
    Stop-Process -Id $Starter.Id -Force -ErrorAction SilentlyContinue
  }
}

function Wait-CompanionService(
  [string]$Name,
  [string]$Uri,
  [string]$ProtocolHeader,
  [string]$ProtocolValue,
  [System.Diagnostics.Process]$Starter,
  [string]$ExpectedVersionProperty = '',
  [string]$ExpectedVersion = ''
) {
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $health = Get-CompanionServiceHealth $Uri $ProtocolHeader $ProtocolValue
    if ($health) {
      if ($ExpectedVersionProperty) {
        $actualVersion = [string]$health.$ExpectedVersionProperty
        if ($actualVersion -ne $ExpectedVersion) {
          Stop-StarterProcess $Starter
          throw (
            'COMPANION_HUB_VERSION_MISMATCH: expected {0}, received {1}' -f
              $ExpectedVersion,
              $(if ($actualVersion) { $actualVersion } else { '<missing>' })
          )
        }
      }
      # Pairing is established by the trusted browser origin after startup.
      # A healthy loopback process is therefore the startup success condition;
      # runtimeReady may legitimately remain false until that first page visit.
      if (-not ($health.bridgeProcessAlive -or $health.hubProcessAlive)) {
        Start-Sleep -Milliseconds 250
        continue
      }
      if ($Starter -and -not $Starter.HasExited) {
        [void]$Starter.WaitForExit(3000)
      }
      Stop-StarterProcess $Starter
      Write-CompanionLog "$Name is ready."
      return $health
    }
    Start-Sleep -Milliseconds 250
  }
  Stop-StarterProcess $Starter
  Write-CompanionLog "$Name did not become ready within 20 seconds."
  return $null
}

if (-not (Test-Path -LiteralPath $bridgeScript -PathType Leaf)) {
  throw "COMPANION_BRIDGE_ENTRYPOINT_MISSING: $bridgeScript"
}
if (-not (Test-Path -LiteralPath $hubScript -PathType Leaf)) {
  throw "COMPANION_HUB_ENTRYPOINT_MISSING: $hubScript"
}

$ollama = Find-OllamaExecutable
if ($ollama -and -not (Test-OllamaReady)) {
  Write-CompanionLog 'Starting the local Ollama model service...'
  Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and -not (Test-OllamaReady)) {
    Start-Sleep -Milliseconds 400
  }
}

$bridgeStarter = Start-CompanionService $bridgeScript
$hubStarter = Start-CompanionService $hubScript
Write-CompanionLog "Starting Local Bridge (launcher PID $($bridgeStarter.Id)) and Private Hub (launcher PID $($hubStarter.Id))..."

$bridgeHealth = Wait-CompanionService `
  'Local Bridge' `
  'http://127.0.0.1:3217/health' `
  'X-Bridge-Protocol' `
  'novel-local-bridge/v1' `
  $bridgeStarter
$hubHealth = Wait-CompanionService `
  'Private Hub' `
  'http://127.0.0.1:3227/health' `
  'X-Private-Hub-Protocol' `
  'novel-private-hub/v1' `
  $hubStarter `
  'hubVersion' `
  $expectedPrivateHubVersion

if (-not $bridgeHealth -or -not $hubHealth) {
  $failed = @()
  if (-not $bridgeHealth) { $failed += 'Local Bridge' }
  if (-not $hubHealth) { $failed += 'Private Hub' }
  throw ('COMPANION_SERVICE_START_FAILED: ' + ($failed -join ', '))
}

if (-not (Test-OllamaReady)) {
  Write-CompanionLog 'Ollama is not ready. Bridge and Hub are running and will recover when Ollama becomes available.'
}

[pscustomobject]@{
  ok = $true
  releaseRoot = $releaseRoot
  bridgeStarted = [bool]$bridgeHealth.bridgeProcessAlive
  privateHubStarted = [bool]$hubHealth.hubProcessAlive
  hubVersion = [string]$hubHealth.hubVersion
  ollamaReady = Test-OllamaReady
  autostart = $true
} | ConvertTo-Json -Depth 4
