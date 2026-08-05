param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $releaseRoot 'bridge\novel-local-ai.ps1'
$hubScript = Join-Path $releaseRoot 'private-hub\novel-private-hub.ps1'
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

$bridgeResult = & powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File $bridgeScript start 2>&1 | Out-String
Write-CompanionLog "Local Bridge: $($bridgeResult.Trim())"

$hubResult = & powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File $hubScript start 2>&1 | Out-String
Write-CompanionLog "Private Hub: $($hubResult.Trim())"

if (-not (Test-OllamaReady)) {
  Write-CompanionLog 'Ollama is not ready. Bridge and Hub are running and will recover when Ollama becomes available.'
}

[pscustomobject]@{
  ok = $true
  releaseRoot = $releaseRoot
  bridgeStarted = $true
  privateHubStarted = $true
  ollamaReady = Test-OllamaReady
  autostart = $true
} | ConvertTo-Json -Depth 4
