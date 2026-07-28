param(
  [ValidateSet('start','status','stop','restart','pair','revoke','diagnose','origin')]
  [string]$Command = 'status',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArguments
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $scriptRoot 'launcher.mjs'

function Write-LauncherError([string]$Code, [string]$Message, [string]$NextStep) {
  [pscustomobject]@{ ok = $false; errorCode = $Code; message = $Message; nextStep = $NextStep } |
    ConvertTo-Json -Depth 4
}

$nodeCandidates = @()
if ($env:NOVEL_NODE_PATH) { $nodeCandidates += $env:NOVEL_NODE_PATH }
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
$nodeCandidates += @(
  (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
)
$nodePath = $nodeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1

if (-not $nodePath) {
  Write-LauncherError 'LAUNCHER_NODE_NOT_FOUND' 'Node.js was not found.' 'Install Node.js 22 LTS or set NOVEL_NODE_PATH to node.exe, then run diagnose again.'
  exit 1
}

try {
  $version = (& $nodePath --version).TrimStart('v')
  $major = [int]($version.Split('.')[0])
  if ($major -lt 22) {
    Write-LauncherError 'LAUNCHER_NODE_UNSUPPORTED' "Node.js $version is unsupported." 'Install Node.js 22 LTS. You may set NOVEL_NODE_PATH without changing the system PATH.'
    exit 1
  }
  & $nodePath $launcher $Command @RemainingArguments
  exit $LASTEXITCODE
} catch {
  Write-LauncherError 'LAUNCHER_WRAPPER_FAILED' $_.Exception.Message 'Run diagnose again and verify that PowerShell can read the project and local runtime directory.'
  exit 1
}
