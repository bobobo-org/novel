param(
  [string]$PreviewUrl = "https://novel-15gi72tr4-lqtechs-projects.vercel.app",
  [string]$ExpectedDeploymentId = "dpl_5G2ggFhtgvLJxB8Q29X94RMoXFxY",
  [string]$ExpectedMergeRef = "169328016111d69e0adab784d817a5653113a852",
  [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "run-pr23-r22-edge-evidence.mjs"
$arguments = @(
  $scriptPath,
  "--preview-url", $PreviewUrl,
  "--expected-deployment-id", $ExpectedDeploymentId,
  "--expected-merge-ref", $ExpectedMergeRef
)
if ($PreflightOnly) {
  $arguments += "--preflight-only"
}

& node @arguments
exit $LASTEXITCODE
