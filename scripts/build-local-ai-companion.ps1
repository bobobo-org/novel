param(
  [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "novel-local-ai-companion-build"
$packageName = "novel-local-ai-companion-v$Version"
$stageRoot = Join-Path $temporaryRoot $packageName
$outputDirectory = Join-Path $repositoryRoot "public\downloads"
$outputPath = Join-Path $outputDirectory "$packageName.zip"

$resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
$systemTemporaryRoot = [System.IO.Path]::GetFullPath(
  [System.IO.Path]::GetTempPath()
)
if (-not $resolvedTemporaryRoot.StartsWith(
  $systemTemporaryRoot,
  [System.StringComparison]::OrdinalIgnoreCase
)) {
  throw "COMPANION_TEMP_PATH_OUTSIDE_SYSTEM_TEMP"
}

if (Test-Path -LiteralPath $temporaryRoot) {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageRoot "bridge") -Force |
  Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageRoot "cache") -Force |
  Out-Null
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$bridgeFiles = @(
  "bridge-core.mjs",
  "launcher.mjs",
  "novel-local-ai.ps1",
  "origin-registry.mjs",
  "README.md",
  "server.mjs"
)
foreach ($name in $bridgeFiles) {
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "local-ai\bridge\$name") `
    -Destination (Join-Path $stageRoot "bridge\$name")
}

$cacheFiles = @(
  "cache-contract.mjs",
  "encrypted-cache-store.mjs",
  "sqlite-cache-store.mjs"
)
foreach ($name in $cacheFiles) {
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "local-ai\cache\$name") `
    -Destination (Join-Path $stageRoot "cache\$name")
}

Copy-Item -LiteralPath (
  Join-Path $repositoryRoot "local-ai\companion\README.md"
) -Destination (Join-Path $stageRoot "README.md")
Copy-Item -LiteralPath (
  Join-Path $repositoryRoot "local-ai\companion\manifest.json"
) -Destination (Join-Path $stageRoot "manifest.json")

if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}
Compress-Archive -LiteralPath $stageRoot -DestinationPath $outputPath `
  -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
[pscustomobject]@{
  version = $Version
  package = $packageName
  outputPath = $outputPath
  sha256 = $hash
  signed = $false
} | ConvertTo-Json -Depth 4
