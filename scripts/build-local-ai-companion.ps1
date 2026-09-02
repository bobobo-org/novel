param(
  [string]$Version = "1.4.6"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "novel-local-ai-companion-build"
$packageName = "novel-local-ai-companion-v$Version"
$stageRoot = Join-Path $temporaryRoot $packageName
$outputDirectory = Join-Path $repositoryRoot "public\downloads"
$outputPath = Join-Path $outputDirectory "$packageName.zip"
$checksumPath = Join-Path $outputDirectory "$packageName.sha256"
$installerName = "novel-local-ai-companion-setup-v$Version"
$installerOutputPath = Join-Path $outputDirectory "$installerName.cmd"
$installerChecksumPath = Join-Path $outputDirectory "$installerName.sha256"
$installScriptName = "novel-local-ai-companion-install-v$Version.ps1"
$installScriptOutputPath = Join-Path $outputDirectory $installScriptName
$installScriptChecksumPath = Join-Path $outputDirectory (
  "novel-local-ai-companion-install-v$Version.sha256"
)

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
New-Item -ItemType Directory -Path (Join-Path $stageRoot "private-hub") -Force |
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

$privateHubFiles = @(
  "launcher.mjs",
  "novel-private-hub.ps1",
  "preference-model.mjs",
  "learning-experience-ledger.mjs",
  "continuous-learning-coordinator.mjs",
  "README.md",
  "server.mjs"
)
foreach ($name in $privateHubFiles) {
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "local-ai\private-hub\$name") `
    -Destination (Join-Path $stageRoot "private-hub\$name")
}

Copy-Item -LiteralPath (
  Join-Path $repositoryRoot "local-ai\companion\README.md"
) -Destination (Join-Path $stageRoot "README.md")
Copy-Item -LiteralPath (
  Join-Path $repositoryRoot "local-ai\companion\manifest.json"
) -Destination (Join-Path $stageRoot "manifest.json")
Copy-Item -LiteralPath (
  Join-Path $repositoryRoot "local-ai\companion\start-companion.ps1"
) -Destination (Join-Path $stageRoot "start-companion.ps1")
Copy-Item -LiteralPath (
  Join-Path $repositoryRoot "local-ai\companion\uninstall.ps1"
) -Destination (Join-Path $stageRoot "uninstall.ps1")

if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}
Compress-Archive -LiteralPath $stageRoot -DestinationPath $outputPath `
  -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
  $checksumPath,
  "$hash  $packageName.zip`n",
  $utf8WithoutBom
)

if (Test-Path -LiteralPath $installerOutputPath) {
  Remove-Item -LiteralPath $installerOutputPath -Force
}
$installScriptSource = Get-Content -LiteralPath (
  Join-Path $repositoryRoot "local-ai\companion\install.ps1"
) -Raw -Encoding utf8
$utf8WithBom = [System.Text.UTF8Encoding]::new($true)
[System.IO.File]::WriteAllText(
  $installScriptOutputPath,
  $installScriptSource,
  $utf8WithBom
)
$installScriptHash = (
  Get-FileHash -LiteralPath $installScriptOutputPath -Algorithm SHA256
).Hash
[System.IO.File]::WriteAllText(
  $installScriptChecksumPath,
  "$installScriptHash  $installScriptName`n",
  $utf8WithoutBom
)

$installScriptUrl = "https://novel-orcin.vercel.app/downloads/$installScriptName"
$archiveUrl = "https://novel-orcin.vercel.app/downloads/$packageName.zip"
$installerTemplate = @'
@echo off
chcp 65001 >nul
title Novel Local AI Companion Installer
echo This installer downloads two checksum-pinned files from novel-orcin.vercel.app.
echo Windows may ask before installing Node.js or Ollama for the current user.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $d=Join-Path $env:TEMP ('NovelLocalAICompanion-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $d -Force ^| Out-Null; try { $s=Join-Path $d 'install.ps1'; $z=Join-Path $d 'companion.zip'; Invoke-WebRequest -UseBasicParsing -Uri '__SCRIPT_URL__' -OutFile $s; Invoke-WebRequest -UseBasicParsing -Uri '__ARCHIVE_URL__' -OutFile $z; if((Get-FileHash -LiteralPath $s -Algorithm SHA256).Hash -ne '__SCRIPT_HASH__'){throw 'INSTALL_SCRIPT_DIGEST_MISMATCH'}; if((Get-FileHash -LiteralPath $z -Algorithm SHA256).Hash -ne '__ARCHIVE_HASH__'){throw 'COMPANION_ARCHIVE_DIGEST_MISMATCH'}; ^& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $s -ArchivePath $z; exit $LASTEXITCODE } finally { if(Test-Path -LiteralPath $d){Remove-Item -LiteralPath $d -Recurse -Force} }"
set "NOVEL_INSTALL_EXIT=%ERRORLEVEL%"
if not "%NOVEL_INSTALL_EXIT%"=="0" (
  echo.
  echo Installation did not complete. Keep the error above and retry.
  pause
)
exit /b %NOVEL_INSTALL_EXIT%
'@
$installerContent = $installerTemplate.Replace(
  "__SCRIPT_URL__",
  $installScriptUrl
).Replace(
  "__ARCHIVE_URL__",
  $archiveUrl
).Replace(
  "__SCRIPT_HASH__",
  $installScriptHash
).Replace(
  "__ARCHIVE_HASH__",
  $hash
)
[System.IO.File]::WriteAllText(
  $installerOutputPath,
  $installerContent,
  $utf8WithoutBom
)
$installerHash = (
  Get-FileHash -LiteralPath $installerOutputPath -Algorithm SHA256
).Hash
[System.IO.File]::WriteAllText(
  $installerChecksumPath,
  "$installerHash  $installerName.cmd`n",
  $utf8WithoutBom
)

[pscustomobject]@{
  version = $Version
  package = $packageName
  outputPath = $outputPath
  checksumPath = $checksumPath
  sha256 = $hash
  installer = $installerName
  installerOutputPath = $installerOutputPath
  installerChecksumPath = $installerChecksumPath
  installerSha256 = $installerHash
  installScriptOutputPath = $installScriptOutputPath
  installScriptSha256 = $installScriptHash
  signed = $false
} | ConvertTo-Json -Depth 4
