$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$preflight = Join-Path $root "scripts\r5-2-desktop\assert-browser-harness-dependencies.ps1"
$nodePath = "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$results = @()

$positive = & $preflight -RepositoryRoot $root -NodePath $nodePath -ChromePath $chromePath -EdgePath $edgePath
if ($positive.status -ne "PASS") { throw "REAL_WORKTREE_DEPENDENCY_PREFLIGHT_FAILED" }
$results += [ordered]@{ name = "installed worktree passes"; status = "PASS" }

$fixture = Join-Path ([IO.Path]::GetTempPath()) "r1k-dependency-$([guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force -Path $fixture | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $fixture "scripts\r5-2-desktop") | Out-Null
  [IO.File]::WriteAllText((Join-Path $fixture "package.json"), '{"devDependencies":{"@playwright/test":"^1.61.1"}}')
  [IO.File]::WriteAllText((Join-Path $fixture "pnpm-lock.yaml"), "lockfileVersion: '9.0'`n")
  [IO.File]::WriteAllText((Join-Path $fixture "scripts\r5-2-desktop\local-cdp-adapter.mjs"), "export const fixture = true;`n")
  $failedClosed = $false
  try {
    & $preflight -RepositoryRoot $fixture -NodePath $nodePath -ChromePath $chromePath -EdgePath $edgePath | Out-Null
  } catch {
    $failedClosed = $_.Exception.Message -like "HARNESS_DEPENDENCY_MISSING:*"
  }
  if (-not $failedClosed) { throw "MISSING_NODE_MODULES_DID_NOT_FAIL_CLOSED" }
  $results += [ordered]@{ name = "missing node_modules fails before operator gate"; status = "PASS" }
} finally {
  Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

[ordered]@{ status = "PASS"; pass = $results.Count; fail = 0; results = $results } | ConvertTo-Json -Depth 5
