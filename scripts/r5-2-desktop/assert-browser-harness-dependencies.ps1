[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryRoot,
  [Parameter(Mandatory = $true)]
  [string]$NodePath,
  [Parameter(Mandatory = $true)]
  [string]$ChromePath,
  [Parameter(Mandatory = $true)]
  [string]$EdgePath
)

$ErrorActionPreference = "Stop"

function Assert-Path([string]$Path, [string]$Code) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "${Code}: $Path" }
}

$packagePath = Join-Path $RepositoryRoot "package.json"
$lockPath = Join-Path $RepositoryRoot "pnpm-lock.yaml"
$playwrightPackagePath = Join-Path $RepositoryRoot "node_modules\@playwright\test\package.json"
$adapterPath = Join-Path $RepositoryRoot "scripts\r5-2-desktop\local-cdp-adapter.mjs"

Assert-Path $NodePath "HARNESS_NODE_RUNTIME_MISSING"
Assert-Path $ChromePath "HARNESS_CHROME_BINARY_MISSING"
Assert-Path $EdgePath "HARNESS_EDGE_BINARY_MISSING"
Assert-Path $packagePath "HARNESS_PACKAGE_MANIFEST_MISSING"
Assert-Path $lockPath "HARNESS_LOCKFILE_MISSING"
Assert-Path (Join-Path $RepositoryRoot "node_modules") "HARNESS_DEPENDENCY_MISSING"
Assert-Path $playwrightPackagePath "HARNESS_PLAYWRIGHT_DEPENDENCY_MISSING"
Assert-Path $adapterPath "HARNESS_ADAPTER_MISSING"

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$declaredVersion = $package.devDependencies.'@playwright/test'
if (-not $declaredVersion) { throw "HARNESS_PLAYWRIGHT_DECLARATION_MISSING" }

$installedPackage = Get-Content -LiteralPath $playwrightPackagePath -Raw | ConvertFrom-Json
$lockText = Get-Content -LiteralPath $lockPath -Raw
if ($lockText -notmatch [regex]::Escape("@playwright/test")) {
  throw "HARNESS_LOCKFILE_PLAYWRIGHT_ENTRY_MISSING"
}

Push-Location $RepositoryRoot
try {
  $moduleSmoke = & $NodePath --input-type=module -e `
    "import('@playwright/test').then(m=>{if(!m.chromium)throw new Error('CHROMIUM_EXPORT_MISSING');console.log('PLAYWRIGHT_TEST_IMPORT_PASS')}).catch(e=>{console.error(e);process.exit(1)})" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "HARNESS_PLAYWRIGHT_IMPORT_FAILED: $($moduleSmoke | Out-String)" }

  $adapterUri = ([Uri]$adapterPath).AbsoluteUri
  $adapterSmoke = & $NodePath --input-type=module -e `
    "import(process.argv[1]).then(()=>console.log('LOCAL_CDP_ADAPTER_IMPORT_PASS')).catch(e=>{console.error(e);process.exit(1)})" `
    $adapterUri 2>&1
  if ($LASTEXITCODE -ne 0) { throw "HARNESS_ADAPTER_IMPORT_FAILED: $($adapterSmoke | Out-String)" }
} finally {
  Pop-Location
}

[pscustomobject]@{
  status = "PASS"
  declaredPlaywrightVersion = $declaredVersion
  installedPlaywrightVersion = $installedPackage.version
  lockfilePresent = $true
  playwrightImport = "PASS"
  adapterImport = "PASS"
  chromeBinary = $ChromePath
  edgeBinary = $EdgePath
}
