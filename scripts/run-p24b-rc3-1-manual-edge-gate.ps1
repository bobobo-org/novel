[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ProductCommit,
  [string]$ArtifactDirectory = "artifacts/p24b-rc3-1-consumer-activation",
  [string]$NodePath = "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $repositoryRoot "scripts\run-p24b-rc3-1-manual-edge-gate.mjs"

Write-Host "Microsoft Edge即將開啟。當網站要求本機網路存取時，請操作者親自按『允許』；其餘流程不得手動操作。" -ForegroundColor Yellow
Write-Host "不要輸入配對碼、不要修改網址、不要開啟開發人員工具；程式會自動完成其餘流程。" -ForegroundColor Cyan

& $NodePath $runner `
  --base-url $BaseUrl `
  --product-commit $ProductCommit `
  --artifacts $ArtifactDirectory

exit $LASTEXITCODE
