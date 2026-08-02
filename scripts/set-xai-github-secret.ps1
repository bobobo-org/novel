$ErrorActionPreference = "Stop"
$taskGh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $taskGh) {
  $taskGh = "C:\Program Files\GitHub CLI\gh.exe"
}

Write-Host "xAI API key secure setup for bobobo-org/novel" -ForegroundColor Cyan
Write-Host "Paste the key only at the hidden prompt below. It is sent directly to GitHub Secret storage." -ForegroundColor Yellow
& $taskGh secret set XAI_API_KEY --repo bobobo-org/novel
if ($LASTEXITCODE -ne 0) {
  Write-Host "XAI SECRET FAILED - keep this window open." -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Host "XAI SECRET COMPLETE - you may close this window." -ForegroundColor Green
