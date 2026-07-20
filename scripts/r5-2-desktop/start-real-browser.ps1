[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet("chrome", "edge")][string]$Browser,
  [Parameter(Mandatory)][ValidateSet("grant", "deny")][string]$Flow,
  [Parameter(Mandatory)][string]$TargetUrl,
  [Parameter(Mandatory)][string]$ProfilePath,
  [Parameter(Mandatory)][string]$ArtifactDirectory,
  [Parameter(Mandatory)][string]$RunId,
  [Parameter(Mandatory)][string]$BrowserVersion,
  [Parameter(Mandatory)][int]$HarnessPid,
  [string]$NodePath = "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$adapter = Join-Path $PSScriptRoot "local-cdp-adapter.mjs"
if (-not (Test-Path -LiteralPath $NodePath)) { throw "NODE_NOT_FOUND: $NodePath" }
if (-not (Test-Path -LiteralPath $adapter)) { throw "ADAPTER_NOT_FOUND: $adapter" }

& $NodePath $adapter `
  --browser $Browser `
  --flow $Flow `
  --target-url $TargetUrl `
  --profile $ProfilePath `
  --artifacts $ArtifactDirectory `
  --run-id $RunId `
  --browser-version $BrowserVersion `
  --harness-pid $HarnessPid
exit $LASTEXITCODE
