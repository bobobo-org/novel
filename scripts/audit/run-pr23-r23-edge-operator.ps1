[CmdletBinding()]
param(
  [string]$OutputDir = "artifacts/pr23-r23-edge-operator",
  [string]$PreviewUrl = "https://novel-brendon-hkoxvsfdx-brendon1006-2299s-projects.vercel.app",
  [string]$ExpectedDeploymentId = "dpl_DQ2SH9UubwyiTDs78KUCgCNS5Li8",
  [string]$ExpectedMergeRef = "bc564667cc110a5d060ff94cf4b342a37690d763"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$expectedBranch = "audit/pr23-r24-edge-regate"
$expectedBase = "94ff70847b449e08d53759bad6d0bf3f1ffa530f"
$expectedOutput = (Join-Path $root "artifacts\pr23-r23-edge-operator")
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path $root $OutputDir))

if ($resolvedOutput -ne $expectedOutput) {
  throw "R23_OUTPUT_DIR_MUST_BE_DEDICATED"
}

$branch = (& git.exe -C $root branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne $expectedBranch) {
  throw "R23_WRONG_BRANCH: expected $expectedBranch, observed $branch"
}

& git.exe -C $root merge-base --is-ancestor $expectedBase HEAD
if ($LASTEXITCODE -ne 0) {
  throw "R23_EXPECTED_BASE_NOT_ANCESTOR"
}

$dirty = (& git.exe -C $root status --porcelain=v1 -uall) -join "`n"
if ($LASTEXITCODE -ne 0 -or $dirty) {
  throw "R23_WORKTREE_MUST_BE_CLEAN`n$dirty"
}

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}
if (-not (Test-Path -LiteralPath $node)) {
  throw "R23_NODE_RUNTIME_NOT_FOUND"
}

Write-Host "Microsoft Edge will open. Click Allow once in the native Local Network Access prompt; do not operate the page."
& $node (Join-Path $PSScriptRoot "run-pr23-r23-edge-operator.mjs") `
  --output-dir $resolvedOutput `
  --preview-url $PreviewUrl `
  --expected-deployment-id $ExpectedDeploymentId `
  --expected-merge-ref $ExpectedMergeRef
$runnerExit = $LASTEXITCODE
if ($runnerExit -ne 0) {
  Write-Host "PR23_R2_3_OPERATOR_RUN_NOT_PASS (exit=$runnerExit)"
  exit $runnerExit
}

$metadataPath = Join-Path $resolvedOutput "edge-run-metadata.json"
$metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($metadata.status -ne "PASS") {
  throw "R23_RUNNER_METADATA_NOT_PASS:$($metadata.status)"
}

& $node (Join-Path $PSScriptRoot "seal-pr23-r23-edge-operator.mjs") `
  --output-dir $resolvedOutput
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& $node (Join-Path $PSScriptRoot "verify-pr23-r23-edge-operator.mjs") `
  --output-dir $resolvedOutput
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$manifestSha = (Get-Content -LiteralPath (Join-Path $resolvedOutput "evidence-manifest.sha256") -Raw -Encoding utf8).Trim()
Write-Host "PR23_R2_3_MANIFEST_SHA256=$manifestSha"
$quote = [char]34
Write-Host ("NEXT_COMMAND=git add artifacts/pr23-r23-edge-operator; git commit -m {0}test(audit): seal PR23 native Edge operator evidence{0}" -f $quote)
