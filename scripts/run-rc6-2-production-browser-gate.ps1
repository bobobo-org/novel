param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{40}$')]
  [string]$ExpectedGateControlCommit,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, [long]::MaxValue)]
  [long]$ExpectedLkgAuditRunId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{64}$')]
  [string]$ExpectedLkgAuditControlProofDigest,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{64}$')]
  [string]$ExpectedLkgSelectionProofDigest,

  [Parameter(Mandatory = $true)]
  [ValidateSet("PreflightDryRun", "FormalBrowserGate")]
  [string]$ExecutionMode,

  [Parameter(Mandatory = $false)]
  [ValidatePattern('^C7-PROD-BROWSER-AUTH-[0-9]{8}T[0-9]{9}Z-[a-f0-9]{32}$')]
  [string]$FormalAuthorizationId
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Fail([string]$Code) { throw $Code }

function SamePath([string]$A, [string]$B) {
  return [StringComparer]::OrdinalIgnoreCase.Equals(
    [IO.Path]::GetFullPath($A),
    [IO.Path]::GetFullPath($B)
  )
}

function Test-ExactOrdinalStringSet([object[]]$Actual, [string[]]$Expected) {
  if ($Actual.Count -ne $Expected.Count) { return $false }
  foreach ($expectedValue in $Expected) {
    $matches = @($Actual | Where-Object {
      [StringComparer]::Ordinal.Equals([string]$_, $expectedValue)
    })
    if ($matches.Count -ne 1) { return $false }
  }
  return $true
}

function Initialize-TaskOwnedEdgePaths {
  $localAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA")
  if (-not $localAppData -or -not [IO.Path]::IsPathRooted($localAppData)) {
    Fail "TASK_OWNED_EDGE_LOCALAPPDATA_INVALID"
  }
  $localRoot = [IO.Path]::GetFullPath($localAppData).TrimEnd('\')
  $toolchainsRoot = [IO.Path]::GetFullPath((Join-Path $localRoot "NovelRC62Toolchains"))
  $edgeFamilyRoot = [IO.Path]::GetFullPath((Join-Path $toolchainsRoot "Edge"))
  $toolchainRoot = [IO.Path]::GetFullPath((Join-Path $edgeFamilyRoot $expectedEdgeVersion))
  $applicationRoot = [IO.Path]::GetFullPath((Join-Path $toolchainRoot "Application"))
  $versionRoot = [IO.Path]::GetFullPath((Join-Path $applicationRoot $expectedEdgeVersion))
  if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($toolchainsRoot), $localRoot) -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($edgeFamilyRoot), $toolchainsRoot) -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($toolchainRoot), $edgeFamilyRoot) -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($applicationRoot), $toolchainRoot) -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($versionRoot), $applicationRoot)
  ) { Fail "TASK_OWNED_EDGE_ROOT_INVALID" }
  foreach ($directory in @(
    $localRoot, $toolchainsRoot, $edgeFamilyRoot, $toolchainRoot, $applicationRoot, $versionRoot
  )) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
      Fail "TASK_OWNED_EDGE_NOT_PROVISIONED"
    }
    $truth = Get-Item -LiteralPath $directory -Force
    if (
      -not $truth.PSIsContainer -or
      ($truth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      $null -ne $truth.LinkType -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals($truth.FullName.TrimEnd('\'), $directory.TrimEnd('\'))
    ) { Fail "TASK_OWNED_EDGE_ROOT_INVALID" }
  }
  $script:edgeToolchainRoot = $toolchainRoot
  $script:edgeApplicationRoot = $applicationRoot
  $script:edgeExe = Join-Path $applicationRoot "msedge.exe"
  $script:edgeVersionRoot = $versionRoot
  $script:edgeDll = Join-Path $versionRoot "msedge.dll"
  $script:edgeToolchainManifestPath = Join-Path $toolchainRoot "toolchain-manifest.json"
  foreach ($requiredFile in @($edgeExe, $edgeDll, $edgeToolchainManifestPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
      Fail "TASK_OWNED_EDGE_NOT_PROVISIONED"
    }
  }
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location -LiteralPath $repoRoot
$gitExe = "C:\Program Files\Git\cmd\git.exe"
$ghExe = "C:\Program Files\GitHub CLI\gh.exe"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$edgeToolchainRoot = $null
$edgeApplicationRoot = $null
$edgeExe = $null
$edgeVersionRoot = $null
$edgeDll = $null
$edgeToolchainManifestPath = $null
$canonicalRepositoryUrl = "https://github.com/bobobo-org/novel.git"
$githubApiRoot = "https://api.github.com/repos/bobobo-org/novel"
$expectedGitSha256 = "22fead8244ef3a7225fb800099a4e43eca8bcec0466774917669599c2f19a05a"
$expectedGhSha256 = "cd79f16203f1fbe56937c4c96e2b6eadd10549418dcb241d91576ac77af0ac8b"
$expectedNodeSha256 = "9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de"
$expectedEdgeSha256 = "af02a342b7e6fa7d1154d9152b5997ff2be300b3a7a678feaae863c9fbea32cb"
$expectedEdgeDllSha256 = "29b191751916dbfe5ed4206022a0d7ab45bd79966d9074ed872112d1865dcec6"
$expectedEdgeDirectorySha256 = "9d79d47dd5fde1d3fcf2fb7e740b85b1f25441d84d5e4240d3a51182f3570f13"
$expectedEdgeApplicationSha256 = "bf2e1fe3a62d67d1c9915191b161c64b99203bbbe03e88c07ab7aa7ab295d273"
$expectedEdgeManifestDigest = "cc7564ed83797ee8ab21a8101ab473592c0b05fc9fd14915e8c5db75ef806f06"
$expectedEdgeManifestFileSha256 = "2e9a981c925362aedc3b7202a2aac0ef165b3b9e774bb44344a255cc3f36c4cd"
$expectedEdgeSourceMsiSha256 = "716b2549eedf4305b92d149186f878394c8d8b7b743db0eaaec773349ed3c273"
$expectedEdgeVisualManifestSha256 = "582a35a65c0362bda88598852ff9e153e1e044bc76d21fb90492b60ee31b6aa7"
$expectedEdgeProxySha256 = "5347986b9305d3b471efafb452416c91f254fef9bc3a8d405a2e03da059e1d02"
$expectedEdgePwaHelperSha256 = "6a6a11189a9830a5248927257bc1c2e5c40c8f263d86879649c7b4ff15c9b332"
$expectedEdgeVersion = "151.0.4129.78"
$expectedEdgeManifestSchema = "p24b-rc6.2-task-owned-edge-toolchain-manifest-v1"
$expectedEdgeSourceMsiUrl = "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/f5e477ef-f201-49dd-866a-8e25850421dd/MicrosoftEdgeEnterpriseX64.msi"
$expectedEdgeSourceMsiPublishedAt = "2026-08-10T15:04:00.000Z"
$expectedEdgeProvisionedAt = "2026-08-13T05:39:37.000Z"
$expectedEdgeVersionDirectoryFileCount = 784L
$expectedEdgeVersionDirectoryByteCount = 902472183L
$expectedEdgeApplicationDirectoryCount = 45L
$expectedEdgeApplicationFileCount = 789L
$expectedEdgeApplicationByteCount = 915721905L
$productCommit = "29fc6e742672bb07187765d34ea818afdadf56ae"
$productionRecoveryControl = "9cd074f239b73dd9b61f6d758fcf97fbd809face"
$failedRecoveryControl = "3b716fc0d974a9d59b49ffca5953776af66c7a07"
$initialBrowserGateControl = "aab0e7bd52c57bc57ecfe8be8b08c1cf63db9824"
$c4BrowserGateControl = "100eea11003c5132ab2b519707c5dee658bc9cbe"
$c5BrowserGateControl = "99695b247c2b1626c38efc8ae4589dd9bd8d30da"
$c6BrowserGateControl = "b326c2fc9925798ffbc750ae37db847f0c8b5625"
$c7BrowserGateControl = "7dea0b8dd488a0f2a24132266944cb95b2f15ca9"
$c8BrowserGateControl = "04e78268cfcfeaeffdc72b603d0700944c7142e7"
$c9BrowserGateControl = "92fe2ff7550ef3aeff9447252714d10d6c771d6b"
$expectedDeployment = "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn"
$releaseTag = "novel-ai-p24b-conversation-first-studio-rc6.2"
$releaseBuild = "rc6.2+$productCommit"
$releaseName = "P2.4B Conversation-First Novel Project GPT RC6.2"
$releasePublishedAt = "2026-08-11T17:32:02Z"
$releaseBody = @"
$releaseName

Product commit: $productCommit
Release revision: rc6.2
Architecture stage: P2.4B RC
Release line: novel-ai-p24b-conversation-first-studio-rc6
Consumer release: p2.4b-conversation-first-studio-rc6.2
Commit signature: unsigned
Legacy tag truth: RC6_LEGACY_TAG_WAS_MISSING
"@
$releaseBody = $releaseBody.Trim()
$releaseTagObject = "b91dc4695293c9b439b6d4cc2508ffba99915b81"
$releaseId = 368738374
$lkgArtifactId = 9114871493
$lkgArtifactDigest = "sha256:b08153dd5ae5b908a1b972799746a1a2621cb2a33bf90025853fa1688f941a5b"
$lkgPublisherRunId = 31524952520
$primaryOrigin = "https://novel-orcin.vercel.app"
$mirrorOrigin = "https://novel-lqtechs-projects.vercel.app"
$deploymentOrigin = "https://novel-eexnlr77y-lqtechs-projects.vercel.app"
$evidenceDirectory = $null
$evidencePath = $null
$failureEvidencePath = $null
$preflightRunId = [Guid]::NewGuid().ToString("N")
$preflightStartedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$preflightPassPath = $null
$preflightFailurePath = $null
$preflightManifestPath = $null
$preflightPassShaPath = $null
$preflightFailureShaPath = $null
$runtimeReceiptPath = $null
$runtimeReceiptShaPath = $null
$rootCauseAnalysisPath = $null
$runtimeReceiptBeforeText = $null
$runtimeReceiptBefore = $null
$runtimeReceiptValidation = $null
$runtimeObservation = $null
$lastNodeContractMetrics = $null
$toolchainReceipt = $null
$toolchainReceiptText = $null
$runnerPath = Join-Path $repoRoot "scripts\run-rc6-2-closed-agent-browser.mjs"
$wrapperPath = Join-Path $repoRoot "scripts\run-rc6-2-production-browser-gate.ps1"
$contractPath = Join-Path $repoRoot "scripts\run-rc6-2-production-browser-gate-contract.mjs"
$formalAttemptStatePath = Join-Path $repoRoot "scripts\rc6-2-formal-attempt-state.mjs"
$terminalEvidencePath = Join-Path $repoRoot "scripts\rc6-2-terminal-evidence.mjs"
$runnerEnvelopeValidatorPath = Join-Path $repoRoot "scripts\run-rc6-2-runner-envelope-tests.mjs"
$formalAttemptPrepared = $false
$formalAttemptId = $null
$formalAttemptDirectory = $null
$formalAttemptRoot = $null
$formalAttemptRegistryRoot = $null
$formalTerminalBundleDirectory = $null
$formalAttemptStartedAt = $null
$formalAuthorizationDigest = $null
$formalWrapperDigest = $null
$formalRunnerDigest = $null
$formalContractDigest = $null
$formalAttemptStateDigest = $null
$terminalEvidenceDigest = $null
$runnerEnvelopeValidatorDigest = $null
$formalRuntimeReceiptDigest = $null
$formalAttemptSummary = $null
$formalTerminalFinalizationAttempted = $false
$formalTerminalFinalized = $false
$formalTerminalSafeResult = $null
$formalTerminalValidation = $null
$formalRunnerResultProjection = $null
$formalRunnerFailureProjection = $null
$formalRunnerEnvelopePath = $null
$formalRunnerEnvelopeShaPath = $null
$formalRunnerEnvelopeValidationPath = $null
$formalRunnerEnvelopeValidation = $null
$formalRunnerEnvelopeDigest = $null
$allowedGatePaths = @(
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/rc6-2-formal-attempt-state.mjs",
  "scripts/rc6-2-terminal-evidence.mjs",
  "scripts/run-rc6-2-formal-attempt-state-tests.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
  "scripts/run-rc6-2-runner-envelope-tests.mjs",
  "scripts/run-rc6-2-network-sentinel-tests.mjs",
  "scripts/run-rc6-2-terminal-evidence-tests.mjs"
)
$initialGatePaths = @(
  ".github/workflows/deploy.yml",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1"
)
$historicalRepairGatePaths = @(
  ".github/workflows/deploy.yml",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1"
)
$c6RepairGatePaths = @(
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1"
)
$c7RepairGatePaths = @(
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/rc6-2-formal-attempt-state.mjs",
  "scripts/rc6-2-terminal-evidence.mjs",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-formal-attempt-state-tests.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
  "scripts/run-rc6-2-terminal-evidence-tests.mjs"
)
$c8RepairGatePaths = @(
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/rc6-2-terminal-evidence.mjs",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
  "scripts/run-rc6-2-runner-envelope-tests.mjs",
  "scripts/run-rc6-2-terminal-evidence-tests.mjs"
)
$c9RepairGatePaths = @(
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/rc6-2-terminal-evidence.mjs",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/run-rc6-2-network-sentinel-tests.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
  "scripts/run-rc6-2-runner-envelope-tests.mjs",
  "scripts/run-rc6-2-terminal-evidence-tests.mjs"
)
$c10RepairGatePaths = @(
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1"
)
$productRuntimePaths = @(
  "lib/novel-ai/character-agent/repository.ts",
  "lib/novel-ai/repository/contracts/index.ts",
  "lib/novel-ai/repository/indexeddb/indexeddb-repository.ts",
  "lib/novel-ai/repository/persistence-recovery.ts",
  "scripts/rc6-2-closed-agent-network-policy.mjs"
)

function Invoke-Git([string[]]$Arguments, [string]$Code) {
  if ($Arguments.Count -eq 0 -or $Arguments.Count -gt 16) { Fail $Code }
  foreach ($argument in $Arguments) {
    if ($argument -notmatch '^[A-Za-z0-9._/:@^{}+=,\-]{1,512}$') { Fail $Code }
  }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $gitExe
  $startInfo.Arguments = [string]::Join(" ", $Arguments)
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.EnvironmentVariables.Clear()
  foreach ($name in @("SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "ProgramData", "COMSPEC")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $startInfo.EnvironmentVariables[$name] = $value }
  }
  $startInfo.EnvironmentVariables["PATH"] = "C:\Windows\System32;C:\Windows"
  $startInfo.EnvironmentVariables["GIT_TERMINAL_PROMPT"] = "0"
  $startInfo.EnvironmentVariables["GIT_CONFIG_NOSYSTEM"] = "1"
  $startInfo.EnvironmentVariables["GIT_CONFIG_GLOBAL"] = "NUL"
  $startInfo.EnvironmentVariables["GIT_NO_REPLACE_OBJECTS"] = "1"
  $startInfo.EnvironmentVariables["GIT_OPTIONAL_LOCKS"] = "0"
  $startInfo.EnvironmentVariables["GIT_CONFIG_COUNT"] = "2"
  $startInfo.EnvironmentVariables["GIT_CONFIG_KEY_0"] = "core.fsmonitor"
  $startInfo.EnvironmentVariables["GIT_CONFIG_VALUE_0"] = "false"
  $startInfo.EnvironmentVariables["GIT_CONFIG_KEY_1"] = "core.untrackedCache"
  $startInfo.EnvironmentVariables["GIT_CONFIG_VALUE_1"] = "false"
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { Fail $Code }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(30000)) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
    Fail $Code
  }
  $process.WaitForExit()
  $stdout = [string]$stdoutTask.Result
  $stderr = [string]$stderrTask.Result
  if ($process.ExitCode -ne 0 -or $stdout.Length -gt 1048576 -or $stderr.Length -gt 65536) { Fail $Code }
  return @($stdout -split "\r?\n" | Where-Object { $_ -ne "" })
}

function Get-SingleTrimmedLine([object[]]$Lines, [string]$Code) {
  if ($Lines.Count -ne 1) { Fail $Code }
  $value = $Lines.GetValue(0)
  if ($null -eq $value) { Fail $Code }
  $text = ([string]$value).Trim()
  if (-not $text) { Fail $Code }
  return $text
}

function Invoke-GitScalar([string[]]$Arguments, [string]$Code) {
  $lines = @(Invoke-Git $Arguments $Code)
  return Get-SingleTrimmedLine $lines $Code
}

function Assert-ControlDiffPaths(
  [string]$BaseCommit,
  [string]$HeadCommit,
  [string[]]$ExpectedPaths,
  [string]$Code
) {
  $statuses = @(Invoke-Git @(
    "diff", "--name-status", "--diff-filter=ACDMRTUXB", $BaseCommit, $HeadCommit
  ) $Code)
  $paths = [Collections.Generic.List[string]]::new()
  foreach ($line in $statuses) {
    $match = [regex]::Match([string]$line, "^([AM])`t([^`0`r`n`t]{1,512})$")
    if (-not $match.Success) { Fail $Code }
    $path = $match.Groups[2].Value.Replace("\", "/")
    $allowedMatches = @($ExpectedPaths | Where-Object { [StringComparer]::Ordinal.Equals($_, $path) })
    if ($allowedMatches.Count -ne 1) { Fail $Code }
    [void]$paths.Add($path)
  }
  $actual = [string[]]$paths.ToArray()
  $expected = [string[]]$ExpectedPaths.Clone()
  [Array]::Sort($actual, [StringComparer]::Ordinal)
  [Array]::Sort($expected, [StringComparer]::Ordinal)
  if ($actual.Count -ne $expected.Count) { Fail $Code }
  for ($index = 0; $index -lt $expected.Count; $index += 1) {
    if (-not [StringComparer]::Ordinal.Equals($actual[$index], $expected[$index])) { Fail $Code }
  }
}

function Invoke-CleanNodeContract(
  [string]$Mode,
  [hashtable]$AdditionalEnvironment,
  [string]$Code,
  [AllowNull()][string]$StandardInput = $null
) {
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $script:lastNodeContractMetrics = [pscustomobject][ordered]@{
    mode = $Mode
    processStarted = $false
    exitCode = $null
    elapsedMs = 0L
    stdoutUtf8ByteLength = 0L
    stderrUtf8ByteLength = 0L
    safeErrorCode = $null
  }
  if ($Mode -notmatch '^[a-z][a-z-]{0,63}$') { Fail $Code }
  $standardInputBytes = $null
  if ($null -ne $StandardInput) {
    if (
      $StandardInput.IndexOf([char]0) -ge 0 -or
      $StandardInput.IndexOf([char]0xFFFD) -ge 0 -or
      ($StandardInput.Length -gt 0 -and $StandardInput[0] -eq [char]0xFEFF)
    ) { Fail $Code }
    $standardInputBytes = [Text.UTF8Encoding]::new($false).GetBytes($StandardInput)
    if (
      $standardInputBytes.Length -gt 1048576 -or
      -not [StringComparer]::Ordinal.Equals(
        [Text.UTF8Encoding]::new($false, $true).GetString($standardInputBytes),
        $StandardInput
      )
    ) { Fail $Code }
  }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $nodeExe
  $startInfo.Arguments = "`"$contractPath`" $Mode"
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardInput = $null -ne $StandardInput
  $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.EnvironmentVariables.Clear()
  foreach ($name in @("SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramData", "COMSPEC")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $startInfo.EnvironmentVariables[$name] = $value }
  }
  $startInfo.EnvironmentVariables["PATH"] = "C:\Windows\System32;C:\Windows;C:\Program Files\nodejs"
  $startInfo.EnvironmentVariables["NO_COLOR"] = "1"
  foreach ($entry in $AdditionalEnvironment.GetEnumerator()) {
    if ([string]$entry.Key -notmatch '^RC6_2_[A-Z0-9_]{1,64}$') { Fail $Code }
    $entryValue = [string]$entry.Value
    if (
      $entryValue.IndexOf([char]0) -ge 0 -or
      $entryValue.Contains("`r") -or
      $entryValue.Contains("`n")
    ) { Fail $Code }
    $startInfo.EnvironmentVariables[[string]$entry.Key] = $entryValue
  }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  $processStarted = $false
  try {
    if (-not $process.Start()) { Fail $Code }
    $processStarted = $true
    $script:lastNodeContractMetrics.processStarted = $true
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if ($null -ne $StandardInput) {
      $process.StandardInput.BaseStream.Write($standardInputBytes, 0, $standardInputBytes.Length)
      $process.StandardInput.BaseStream.Flush()
      $process.StandardInput.BaseStream.Close()
    }
    if (-not $process.WaitForExit(300000)) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
      [void]$process.WaitForExit(30000)
      Fail $Code
    }
    $process.WaitForExit()
    $stdout = [string]$stdoutTask.Result
    $stderr = [string]$stderrTask.Result
    $script:lastNodeContractMetrics.exitCode = [int]$process.ExitCode
    $script:lastNodeContractMetrics.elapsedMs = [long]$stopwatch.ElapsedMilliseconds
    $script:lastNodeContractMetrics.stdoutUtf8ByteLength = [long][Text.UTF8Encoding]::new($false).GetByteCount($stdout)
    $script:lastNodeContractMetrics.stderrUtf8ByteLength = [long][Text.UTF8Encoding]::new($false).GetByteCount($stderr)
    $safeStderr = $stderr.Trim()
    if ($safeStderr -match '^[A-Z][A-Z0-9_]{2,127}$') {
      $script:lastNodeContractMetrics.safeErrorCode = $safeStderr
    }
    if (
      $process.ExitCode -ne 0 -or
      $script:lastNodeContractMetrics.stdoutUtf8ByteLength -gt 1048576 -or
      $script:lastNodeContractMetrics.stderrUtf8ByteLength -gt 65536 -or
      $stderr.Trim().Length -ne 0
    ) {
      Fail $Code
    }
    return $stdout.Trim()
  } finally {
    $stopwatch.Stop()
    $script:lastNodeContractMetrics.elapsedMs = [long]$stopwatch.ElapsedMilliseconds
    if ($processStarted -and -not $process.HasExited) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
      [void]$process.WaitForExit(30000)
    }
    $process.Dispose()
  }
}

function Invoke-CleanFormalNodeCli(
  [string]$ScriptPath,
  [string]$Mode,
  [string]$StandardInput,
  [string]$Code
) {
  $isStateCli = SamePath $ScriptPath $formalAttemptStatePath
  $isTerminalCli = SamePath $ScriptPath $terminalEvidencePath
  $isRunnerEnvelopeCli = SamePath $ScriptPath $runnerEnvelopeValidatorPath
  if (-not $isStateCli -and -not $isTerminalCli -and -not $isRunnerEnvelopeCli) { Fail $Code }
  $allowedModes = if ($isStateCli) {
    @(
      "read-authorization",
      "create-attempt",
      "recover-creation",
      "transition-idempotent",
      "verify",
      "recover",
      "wait-state"
    )
  } elseif ($isTerminalCli) {
    @("bind-projections", "finalize", "validate", "validate-formal")
  } else {
    @("validate-envelope")
  }
  if ($Mode -notin $allowedModes) { Fail $Code }
  if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { Fail $Code }
  if (
    $isRunnerEnvelopeCli -and
    (
      $runnerEnvelopeValidatorDigest -notmatch '^[a-f0-9]{64}$' -or
      (Get-FileHash -LiteralPath $ScriptPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne (
        $runnerEnvelopeValidatorDigest
      )
    )
  ) { Fail $Code }
  $scriptDigest = (Get-FileHash -LiteralPath $ScriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (
    ($isStateCli -and $scriptDigest -ne $formalAttemptStateDigest) -or
    ($isTerminalCli -and $scriptDigest -ne $terminalEvidenceDigest)
  ) { Fail $Code }
  if (
    $null -eq $StandardInput -or
    $StandardInput.IndexOf([char]0) -ge 0 -or
    $StandardInput.IndexOf([char]0xFFFD) -ge 0 -or
    ($StandardInput.Length -gt 0 -and $StandardInput[0] -eq [char]0xFEFF) -or
    $StandardInput.Contains("`r") -or
    $StandardInput.Contains("`n")
  ) { Fail $Code }
  $standardInputBytes = [Text.UTF8Encoding]::new($false).GetBytes($StandardInput)
  if (
    $standardInputBytes.Length -eq 0 -or
    $standardInputBytes.Length -gt 2097152 -or
    -not [StringComparer]::Ordinal.Equals(
      [Text.UTF8Encoding]::new($false, $true).GetString($standardInputBytes),
      $StandardInput
    )
  ) { Fail $Code }

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $nodeExe
  $startInfo.Arguments = "`"$ScriptPath`" $Mode"
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.EnvironmentVariables.Clear()
  foreach ($name in @("SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramData", "COMSPEC")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $startInfo.EnvironmentVariables[$name] = $value }
  }
  $startInfo.EnvironmentVariables["PATH"] = "C:\Windows\System32;C:\Windows;C:\Program Files\nodejs"
  $startInfo.EnvironmentVariables["NO_COLOR"] = "1"

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  $started = $false
  $timedOut = $false
  try {
    if (-not $process.Start()) { Fail $Code }
    $started = $true
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.BaseStream.Write($standardInputBytes, 0, $standardInputBytes.Length)
    $process.StandardInput.BaseStream.Flush()
    $process.StandardInput.BaseStream.Close()
    if (-not $process.WaitForExit(300000)) {
      $timedOut = $true
      & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
      [void]$process.WaitForExit(30000)
    }
    if (-not $process.HasExited) { Fail $Code }
    $process.WaitForExit()
    $stdout = [string]$stdoutTask.Result
    $stderr = [string]$stderrTask.Result
    $stdoutBytes = [Text.UTF8Encoding]::new($false).GetByteCount($stdout)
    $stderrBytes = [Text.UTF8Encoding]::new($false).GetByteCount($stderr)
    if ($stdoutBytes -gt 2097152 -or $stderrBytes -gt 65536) { Fail $Code }
    return [pscustomobject][ordered]@{
      ExitCode = [int]$process.ExitCode
      TimedOut = [bool]$timedOut
      Stdout = $stdout.Trim()
      Stderr = $stderr.Trim()
    }
  } finally {
    if ($started -and -not $process.HasExited) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
      [void]$process.WaitForExit(30000)
    }
    $process.Dispose()
  }
}

function Invoke-FormalNodeJson(
  [string]$ScriptPath,
  [string]$Mode,
  [object]$Payload,
  [string]$Code,
  [switch]$AllowFailure
) {
  $inputJson = $Payload | ConvertTo-Json -Compress -Depth 100
  $result = Invoke-CleanFormalNodeCli $ScriptPath $Mode $inputJson $Code
  $safeStderr = [string]$result.Stderr
  $successful = (
    -not [bool]$result.TimedOut -and
    [int]$result.ExitCode -eq 0 -and
    $safeStderr.Length -eq 0 -and
    [string]$result.Stdout
  )
  if (-not $successful) {
    if (
      [bool]$result.TimedOut -or
      ($safeStderr.Length -ne 0 -and $safeStderr -notmatch '^[A-Z][A-Z0-9_]{2,127}$') -or
      [string]$result.Stdout
    ) { Fail $Code }
    if ($AllowFailure) { return $null }
    Fail $Code
  }
  try {
    $parsed = [string]$result.Stdout | ConvertFrom-Json
  } catch {
    Fail $Code
  }
  if ($null -eq $parsed) { Fail $Code }
  return $parsed
}

function Read-BoundedExactFile(
  [string]$Path,
  [long]$MaximumBytes,
  [string]$Code
) {
  if (-not $Path -or $MaximumBytes -lt 1 -or $MaximumBytes -gt 1048576) { Fail $Code }
  try { $before = Get-Item -LiteralPath $Path -Force }
  catch { Fail $Code }
  if (
    $before.PSIsContainer -or
    ($before.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    $null -ne $before.LinkType -or
    [long]$before.Length -lt 1 -or
    [long]$before.Length -gt $MaximumBytes -or
    -not (SamePath ([string]$before.FullName) $Path)
  ) { Fail $Code }

  $stream = $null
  try {
    $stream = [IO.File]::Open(
      $Path,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::Read
    )
    $expectedLength = [long]$before.Length
    if ($stream.Length -ne $expectedLength -or $stream.Length -gt $MaximumBytes) { Fail $Code }
    $bytes = New-Object byte[] ([int]$expectedLength)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($read -le 0) { Fail $Code }
      $offset += $read
    }
    if ($stream.ReadByte() -ne -1 -or $stream.Length -ne $expectedLength) { Fail $Code }
    $after = Get-Item -LiteralPath $Path -Force
    if (
      $after.PSIsContainer -or
      ($after.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      $null -ne $after.LinkType -or
      [long]$after.Length -ne $expectedLength -or
      [long]$bytes.LongLength -ne $expectedLength -or
      -not (SamePath ([string]$after.FullName) $Path)
    ) { Fail $Code }
    return [pscustomobject][ordered]@{
      Bytes = $bytes
      Length = $expectedLength
    }
  } catch {
    Fail $Code
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

function Resolve-RunnerEnvelopeValidation {
  if (-not $formalAttemptPrepared -or -not $runnerStarted) {
    Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_STATE_INVALID"
  }
  $durableRunnerSummary = Get-VerifiedFormalAttempt "FORMAL_RUNNER_ENVELOPE_STATE_VERIFY_FAILED"
  if (-not [bool]$durableRunnerSummary.runnerStarted) {
    Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_STATE_INVALID"
  }
  if ($null -ne $formalRunnerEnvelopeValidation) { return $formalRunnerEnvelopeValidation }
  $payload = [ordered]@{
    envelopePath = $formalRunnerEnvelopePath
    shaPath = $formalRunnerEnvelopeShaPath
    validationPath = $formalRunnerEnvelopeValidationPath
    expectedAttemptDirectory = $formalAttemptDirectory
    expectedAttemptId = $formalAttemptId
    expectedAuthorizationId = $FormalAuthorizationId
    expectedAuthorizationDigest = $formalAuthorizationDigest
    expectedProductCommit = $productCommit
    expectedControlCommit = $ExpectedGateControlCommit
    expectedDeploymentId = $expectedDeployment
    expectedProductionOrigin = $deploymentOrigin
    expectedReleaseTag = $releaseTag
    expectedReleaseRevision = "rc6.2"
    expectedRuntimeReceiptDigest = $formalRuntimeReceiptDigest
    expectedWrapperDigest = $formalWrapperDigest
    expectedRunnerDigest = $formalRunnerDigest
    expectedContractDigest = $formalContractDigest
    expectedMode = "generation"
    observedExitCode = if ($null -ne $runnerExitCode) { [int]$runnerExitCode } else { $null }
    stdoutBytes = [long]$runnerStdoutUtf8ByteLength
    stderrBytes = [long]$runnerStderrUtf8ByteLength
    progressCount = [int](
      [int]$runnerProgressCounts.setup +
      [int]$runnerProgressCounts.candidateGeneration +
      [int]$runnerProgressCounts.t1Analysis
    )
    unexpectedLineCount = [int]$runnerUnexpectedStderrCount
    safeTerminalCodeCount = [int]$runnerSafeTerminalCodeCount
    validatedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  }
  $result = Invoke-CleanFormalNodeCli $runnerEnvelopeValidatorPath "validate-envelope" (
    $payload | ConvertTo-Json -Compress -Depth 12
  ) "FORMAL_RUNNER_ENVELOPE_VALIDATOR_FAILED"
  if (
    [bool]$result.TimedOut -or
    [int]$result.ExitCode -ne 0 -or
    [string]$result.Stderr -or
    -not [string]$result.Stdout
  ) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATOR_FAILED" }
  try { $validationSummary = [string]$result.Stdout | ConvertFrom-Json }
  catch { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATOR_FAILED" }
  if (-not (Test-ExactOrdinalStringSet @($validationSummary.PSObject.Properties.Name) @(
    "schemaVersion",
    "status",
    "validationStatus",
    "validationDisposition",
    "attemptId",
    "envelopeDigest",
    "statusObserved",
    "validationDigest",
    "validationFileSha256"
  ))) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATOR_FAILED" }
  if (
    [string]$validationSummary.schemaVersion -ne "p24b-rc6.2-formal-runner-envelope-validation-v1" -or
    [string]$validationSummary.status -ne "PASS" -or
    [string]$validationSummary.validationStatus -notin @("PASS", "FAIL") -or
    [string]$validationSummary.validationDisposition -notin @("VALIDATED", "MISSING", "INVALID") -or
    [string]$validationSummary.attemptId -ne $formalAttemptId -or
    [string]$validationSummary.validationDigest -notmatch '^[a-f0-9]{64}$' -or
    [string]$validationSummary.validationFileSha256 -notmatch '^[a-f0-9]{64}$' -or
    -not (Test-Path -LiteralPath $formalRunnerEnvelopeValidationPath -PathType Leaf)
  ) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATOR_FAILED" }
  if (
    [string]$validationSummary.validationStatus -eq "PASS" -and
    [string]$validationSummary.validationDisposition -ne "VALIDATED"
  ) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATOR_FAILED" }
  if (
    [string]$validationSummary.validationDisposition -eq "VALIDATED" -and
    [string]$validationSummary.envelopeDigest -notmatch '^[a-f0-9]{64}$'
  ) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATOR_FAILED" }
  $attemptDirectoryTruth = Get-Item -LiteralPath $formalAttemptDirectory -Force
  if (
    -not $attemptDirectoryTruth.PSIsContainer -or
    ($attemptDirectoryTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    $null -ne $attemptDirectoryTruth.LinkType -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetFullPath($attemptDirectoryTruth.FullName),
      $formalAttemptDirectory
    ) -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetDirectoryName($formalRunnerEnvelopeValidationPath),
      $formalAttemptDirectory
    )
  ) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_PATH_INVALID" }
  $validationSource = Read-BoundedExactFile $formalRunnerEnvelopeValidationPath 65536 (
    "FORMAL_RUNNER_ENVELOPE_VALIDATION_PATH_INVALID"
  )
  $validationBytes = [byte[]]$validationSource.Bytes
  $validationHashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $validationFileDigest = ([BitConverter]::ToString(
      $validationHashAlgorithm.ComputeHash($validationBytes)
    )).Replace("-", "").ToLowerInvariant()
  } finally {
    $validationHashAlgorithm.Dispose()
  }
  $attemptDirectoryReadbackTruth = Get-Item -LiteralPath $formalAttemptDirectory -Force
  $validationReadbackTruth = Get-Item -LiteralPath $formalRunnerEnvelopeValidationPath -Force
  if (
    -not $attemptDirectoryReadbackTruth.PSIsContainer -or
    ($attemptDirectoryReadbackTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    $null -ne $attemptDirectoryReadbackTruth.LinkType -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetFullPath($attemptDirectoryReadbackTruth.FullName),
      $formalAttemptDirectory
    ) -or
    ($validationReadbackTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    $null -ne $validationReadbackTruth.LinkType -or
    [long]$validationReadbackTruth.Length -ne [long]$validationSource.Length -or
    [long]$validationReadbackTruth.Length -gt 65536 -or
    [long]$validationBytes.LongLength -ne [long]$validationSource.Length -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetDirectoryName($validationReadbackTruth.FullName),
      $formalAttemptDirectory
    )
  ) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_PATH_INVALID" }
  if ($validationFileDigest -ne [string]$validationSummary.validationFileSha256) {
    Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_READBACK_INVALID"
  }
  try {
    $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
    $validationText = $strictUtf8.GetString($validationBytes)
    $validation = $validationText | ConvertFrom-Json
  }
  catch { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_INVALID" }
  if (-not (Test-ExactOrdinalStringSet @($validation.PSObject.Properties.Name) @(
    "schemaVersion",
    "attemptId",
    "status",
    "validationDisposition",
    "fileExists",
    "fileBytes",
    "fileSha256",
    "shaSidecarMatches",
    "canonicalJson",
    "schemaValid",
    "identityValid",
    "digestValid",
    "statusObserved",
    "detailedProjectionAvailable",
    "minimalProjectionUsed",
    "validatorErrorCode",
    "validatedAt",
    "envelopeDigest",
    "observedExitCode",
    "stdoutBytes",
    "stderrBytes",
    "progressCount",
    "unexpectedLineCount",
    "safeTerminalCodeCount",
    "validationDigest"
  ))) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_INVALID" }
  if (
    [string]$validation.schemaVersion -ne "p24b-rc6.2-formal-runner-envelope-validation-v1" -or
    [string]$validation.attemptId -ne $formalAttemptId -or
    [string]$validation.status -ne [string]$validationSummary.validationStatus -or
    [string]$validation.validationDisposition -ne [string]$validationSummary.validationDisposition -or
    [string]$validation.validationDigest -ne [string]$validationSummary.validationDigest -or
    [string]$validation.envelopeDigest -ne [string]$validationSummary.envelopeDigest -or
    [string]$validation.statusObserved -ne [string]$validationSummary.statusObserved
  ) { Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_INVALID" }
  if (
    [string]$validation.status -eq "PASS" -and
    [string]$validation.envelopeDigest -notmatch '^[a-f0-9]{64}$'
  ) { Fail "FORMAL_RUNNER_ENVELOPE_READBACK_INVALID" }
  $script:formalRunnerEnvelopeDigest = if (
    [string]$validation.status -eq "PASS" -and
    [string]$validation.validationDisposition -eq "VALIDATED" -and
    [string]$validation.envelopeDigest -match '^[a-f0-9]{64}$'
  ) { [string]$validation.envelopeDigest } else { $null }
  $script:formalRunnerEnvelopeValidation = $validation
  return $validation
}

function Get-FormalAttemptIdentityPayload {
  $identity = [ordered]@{
    expectedAttemptId = $formalAttemptId
    expectedAuthorizationId = $FormalAuthorizationId
    expectedControlCommit = $ExpectedGateControlCommit
    expectedProductCommit = $productCommit
    expectedDeploymentId = $expectedDeployment
    expectedProductionOrigin = $deploymentOrigin
    expectedAuthorizationDigest = $formalAuthorizationDigest
    expectedReleaseTag = $releaseTag
    expectedReleaseRevision = "rc6.2"
    expectedWrapperDigest = $formalWrapperDigest
    expectedRunnerDigest = $formalRunnerDigest
    expectedContractDigest = $formalContractDigest
  }
  if ($formalRuntimeReceiptDigest -and $null -ne $formalAttemptSummary -and [string]$formalAttemptSummary.state -ne "PREPARED") {
    $identity["expectedRuntimeReceiptDigest"] = $formalRuntimeReceiptDigest
  }
  return $identity
}

function Test-FormalAttemptSummary([object]$Summary) {
  return (
    $null -ne $Summary -and
    [string]$Summary.attemptId -eq $formalAttemptId -and
    [int]$Summary.revision -ge 1 -and
    [string]$Summary.lastEventDigest -match '^[a-f0-9]{64}$' -and
    [string]$Summary.leaseDigest -match '^[a-f0-9]{64}$'
  )
}

function Get-VerifiedFormalAttempt([string]$Code) {
  if (-not $formalAttemptPrepared) { Fail $Code }
  $payload = [ordered]@{ attemptDirectory = $formalAttemptDirectory }
  foreach ($entry in (Get-FormalAttemptIdentityPayload).GetEnumerator()) {
    $payload[$entry.Key] = $entry.Value
  }
  $summary = Invoke-FormalNodeJson $formalAttemptStatePath "verify" $payload $Code
  if (-not (Test-FormalAttemptSummary $summary) -or [bool]$summary.valid -ne $true) { Fail $Code }
  $script:formalAttemptSummary = $summary
  return $summary
}

function Invoke-FormalAttemptTransition(
  [string]$EventType,
  [object]$EventBody,
  [string]$ExpectedState,
  [string]$TargetState,
  [string]$Code
) {
  if (-not $formalAttemptPrepared -or $null -eq $formalAttemptSummary) { Fail $Code }
  $expectedRevision = [int]$formalAttemptSummary.revision
  $payload = [ordered]@{
    attemptDirectory = $formalAttemptDirectory
    eventType = $EventType
    eventBody = $EventBody
    expectedRevision = $expectedRevision
    expectedState = $ExpectedState
  }
  foreach ($entry in (Get-FormalAttemptIdentityPayload).GetEnumerator()) {
    $payload[$entry.Key] = $entry.Value
  }
  $transition = Invoke-FormalNodeJson $formalAttemptStatePath "transition-idempotent" $payload $Code
  $expectedNextRevision = $expectedRevision + 1
  if (
    -not (Test-FormalAttemptSummary $transition) -or
    [string]$transition.state -ne $TargetState -or
    [int]$transition.revision -ne $expectedNextRevision -or
    @([bool]$transition.eventAppended, [bool]$transition.exactSuccessorRecovered) -notcontains $true
  ) { Fail $Code }
  $script:formalAttemptSummary = $transition
  return $transition
}

function Initialize-FormalAttempt {
  if ($ExecutionMode -ne "FormalBrowserGate" -or -not $FormalAuthorizationId) {
    Fail "FORMAL_AUTHORIZATION_REQUIRED"
  }
  $localAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA")
  if (-not $localAppData) { Fail "FORMAL_ATTEMPT_LOCALAPPDATA_MISSING" }
  $localRoot = [IO.Path]::GetFullPath($localAppData).TrimEnd('\')
  $script:formalAttemptRegistryRoot = [IO.Path]::GetFullPath((Join-Path $localRoot "NovelRC62FormalAttemptRegistry"))
  $script:formalAttemptRoot = [IO.Path]::GetFullPath((Join-Path $localRoot "NovelRC62FormalAttempts"))
  if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetDirectoryName($formalAttemptRegistryRoot),
      $localRoot
    ) -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetDirectoryName($formalAttemptRoot),
      $localRoot
    )
  ) { Fail "FORMAL_ATTEMPT_ROOT_INVALID" }

  $script:formalAttemptStateDigest = (Get-FileHash -LiteralPath $formalAttemptStatePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $script:terminalEvidenceDigest = (Get-FileHash -LiteralPath $terminalEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $script:runnerEnvelopeValidatorDigest = (
    Get-FileHash -LiteralPath $runnerEnvelopeValidatorPath -Algorithm SHA256
  ).Hash.ToLowerInvariant()
  $authorization = Invoke-FormalNodeJson $formalAttemptStatePath "read-authorization" ([ordered]@{
    registryRoot = $formalAttemptRegistryRoot
    authorizationId = $FormalAuthorizationId
  }) "FORMAL_AUTHORIZATION_INVALID"
  if (
    [string]$authorization.authorizationId -ne $FormalAuthorizationId -or
    [string]$authorization.authorizationDigest -notmatch '^[a-f0-9]{64}$' -or
    [string]$authorization.authorizedControlCommit -ne $ExpectedGateControlCommit -or
    [string]$authorization.authorizedProductCommit -ne $productCommit -or
    [string]$authorization.authorizedDeploymentId -ne $expectedDeployment -or
    [int]$authorization.maxFormalAttempts -ne 1
  ) { Fail "FORMAL_AUTHORIZATION_INVALID" }
  $script:formalAuthorizationDigest = [string]$authorization.authorizationDigest
  $script:formalWrapperDigest = (Get-FileHash -LiteralPath $wrapperPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $script:formalRunnerDigest = (Get-FileHash -LiteralPath $runnerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $script:formalContractDigest = (Get-FileHash -LiteralPath $contractPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $script:formalAttemptStartedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $creationPayload = [ordered]@{
    attemptRoot = $formalAttemptRoot
    registryRoot = $formalAttemptRegistryRoot
    authorizationId = $FormalAuthorizationId
    authorizationDigest = $formalAuthorizationDigest
    productCommit = $productCommit
    controlCommit = $ExpectedGateControlCommit
    deploymentId = $expectedDeployment
    productionOrigin = $deploymentOrigin
    releaseTag = $releaseTag
    releaseRevision = "rc6.2"
    wrapperDigest = $formalWrapperDigest
    runnerDigest = $formalRunnerDigest
    contractDigest = $formalContractDigest
    createdAt = $formalAttemptStartedAt
  }
  $creation = Invoke-FormalNodeJson $formalAttemptStatePath "create-attempt" $creationPayload (
    "FORMAL_ATTEMPT_PREPARE_FAILED"
  ) -AllowFailure
  if ($null -eq $creation) {
    $creation = Invoke-FormalNodeJson $formalAttemptStatePath "recover-creation" ([ordered]@{
      attemptRoot = $formalAttemptRoot
      registryRoot = $formalAttemptRegistryRoot
      authorizationId = $FormalAuthorizationId
      expectedControlCommit = $ExpectedGateControlCommit
      expectedProductCommit = $productCommit
      expectedDeploymentId = $expectedDeployment
      expectedProductionOrigin = $deploymentOrigin
      expectedAuthorizationDigest = $formalAuthorizationDigest
      expectedReleaseTag = $releaseTag
      expectedReleaseRevision = "rc6.2"
      expectedWrapperDigest = $formalWrapperDigest
      expectedRunnerDigest = $formalRunnerDigest
      expectedContractDigest = $formalContractDigest
    }) "FORMAL_ATTEMPT_PREPARE_RECOVERY_FAILED"
  }
  $script:formalAttemptId = [string]$creation.attemptId
  if ($formalAttemptId -notmatch '^C7-PROD-BROWSER-[0-9]{8}T[0-9]{9}Z-[a-f0-9]{32}$') {
    Fail "FORMAL_ATTEMPT_PREPARE_FAILED"
  }
  $script:formalAttemptDirectory = [IO.Path]::GetFullPath((Join-Path $formalAttemptRoot $formalAttemptId))
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
    [IO.Path]::GetDirectoryName($formalAttemptDirectory),
    $formalAttemptRoot
  )) { Fail "FORMAL_ATTEMPT_DIRECTORY_INVALID" }
  $script:formalTerminalBundleDirectory = [IO.Path]::GetFullPath((
    Join-Path $formalAttemptDirectory "terminal-evidence"
  ))
  $script:formalRunnerEnvelopePath = [IO.Path]::GetFullPath((
    Join-Path $formalAttemptDirectory "runner-terminal-envelope.json"
  ))
  $script:formalRunnerEnvelopeShaPath = [IO.Path]::GetFullPath((
    Join-Path $formalAttemptDirectory "runner-terminal-envelope.sha256"
  ))
  $script:formalRunnerEnvelopeValidationPath = [IO.Path]::GetFullPath((
    Join-Path $formalAttemptDirectory "runner-envelope-validation.json"
  ))
  foreach ($path in @(
    $formalRunnerEnvelopePath,
    $formalRunnerEnvelopeShaPath,
    $formalRunnerEnvelopeValidationPath
  )) {
    if (
      -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetDirectoryName($path),
        $formalAttemptDirectory
      ) -or
      (Test-Path -LiteralPath $path)
    ) { Fail "FORMAL_RUNNER_ENVELOPE_PATH_INVALID" }
  }
  $script:formalAttemptPrepared = $true
  $script:formalAttemptSummary = $creation
  if (
    [string]$creation.state -ne "PREPARED" -or
    [int]$creation.revision -ne 1 -or
    [bool]$creation.attemptConsumed -or
    [bool]$creation.runnerStarted -or
    [bool]$creation.browserStarted
  ) { Fail "FORMAL_ATTEMPT_PREPARE_FAILED" }
  [void](Get-VerifiedFormalAttempt "FORMAL_ATTEMPT_PREPARE_VERIFY_FAILED")
}

function Publish-FormalTerminalEmergency([string]$CauseCode) {
  if (-not $formalAttemptPrepared -or -not $formalAttemptDirectory -or -not $formalAttemptId) { return }
  $safeCause = if ($CauseCode -match '^[A-Z][A-Z0-9_]{2,127}$') {
    $CauseCode
  } else {
    "FORMAL_TERMINAL_FINALIZATION_FAILED"
  }
  try {
    if (-not (Test-Path -LiteralPath $formalTerminalBundleDirectory)) {
      [void][IO.Directory]::CreateDirectory($formalTerminalBundleDirectory)
    }
    $bundleTruth = Get-Item -LiteralPath $formalTerminalBundleDirectory -Force
    if (
      -not $bundleTruth.PSIsContainer -or
      ($bundleTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetDirectoryName($formalTerminalBundleDirectory),
        $formalAttemptDirectory
      )
    ) { return }
    $emergencyPath = Join-Path $formalTerminalBundleDirectory "emergency-terminal-failure.json"
    if (Test-Path -LiteralPath $emergencyPath) { return }
    $emergency = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-terminal-evidence-emergency-v1"
      status = "FAIL"
      safeErrorCode = "TERMINAL_EVIDENCE_FINALIZATION_FAILED"
      causeCode = $safeCause
      attemptIdFingerprint = (Sha256Text $formalAttemptId).Substring(0, 16)
      rawCredentialValuesStored = $false
    } | ConvertTo-Json -Compress -Depth 4
    Write-CreateNewFlushedFile $emergencyPath $emergency "FORMAL_TERMINAL_EMERGENCY_WRITE_FAILED"
  } catch {
    [Console]::Error.WriteLine("FORMAL_TERMINAL_EMERGENCY_WRITE_FAILED")
  }
}

function Invoke-FormalTerminalEvidence(
  [ValidateSet("PASS", "FAIL", "ABORTED")]
  [string]$TerminalStatus,
  [string]$ReasonCode,
  [AllowNull()][object]$BrowserEvidence,
  [AllowNull()][object]$ProfileCleanup,
  [AllowNull()][object]$ProcessCleanup
) {
  if (-not $formalAttemptPrepared -or $formalTerminalFinalizationAttempted) {
    Fail "FORMAL_TERMINAL_FINALIZATION_STATE_INVALID"
  }
  $script:formalTerminalFinalizationAttempted = $true
  if ($TerminalStatus -ne "PASS" -and $ReasonCode -notmatch '^[A-Z][A-Z0-9_]{2,127}$') {
    $ReasonCode = "PRODUCTION_BROWSER_WRAPPER_FAILED"
  }
  $completedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $runnerExitForProjection = if ($null -ne $runnerExitCode) { [int]$runnerExitCode } else { 1 }
  $payload = [ordered]@{
    attemptDirectory = $formalAttemptDirectory
    bundleDirectory = $formalTerminalBundleDirectory
    expectedControlCommit = $ExpectedGateControlCommit
    startedAt = $formalAttemptStartedAt
    completedAt = $completedAt
    wrapperResult = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-wrapper-result-v1"
      attemptId = $formalAttemptId
      status = $TerminalStatus
      completedAt = $completedAt
    }
  }
  if ($TerminalStatus -ne "PASS") {
    $payload.wrapperResult | Add-Member -NotePropertyName reasonCode -NotePropertyValue $ReasonCode
  }
  if ($formalRuntimeReceiptDigest) {
    if ($null -eq $runtimeReceiptBefore -or $null -eq $toolchainReceipt) {
      Fail "FORMAL_TERMINAL_RECEIPT_PROJECTION_MISSING"
    }
    $payload["runtimeReceipt"] = $runtimeReceiptBefore
    $payload["toolchainReceipt"] = $toolchainReceipt
  }

  $durableRunnerOutcome = if ([bool]$formalAttemptSummary.runnerCompleted) {
    [string]$formalAttemptSummary.runnerOutcome
  } else {
    $null
  }
  if ($durableRunnerOutcome -eq "PASS") {
    if ($null -eq $formalRunnerResultProjection) {
      Fail "FORMAL_TERMINAL_RUNNER_RESULT_MISSING"
    }
    $payload["runnerResult"] = $formalRunnerResultProjection
  } elseif ([string]$formalAttemptSummary.state -ne "PRECHECK_FAILED") {
    if ($durableRunnerOutcome -eq "FAIL" -and $null -eq $formalRunnerFailureProjection) {
      Fail "FORMAL_TERMINAL_RUNNER_FAILURE_MISSING"
    }
    $payload["runnerFailure"] = if ($null -ne $formalRunnerFailureProjection) {
      $formalRunnerFailureProjection
    } else {
      [pscustomobject][ordered]@{
        schemaVersion = "p24b-rc6.2-formal-runner-failure-v1"
        attemptId = $formalAttemptId
        status = $TerminalStatus
        reasonCode = $ReasonCode
        exitCode = $runnerExitForProjection
      }
    }
  }

  if ($TerminalStatus -eq "PASS") {
    if (
      $durableRunnerOutcome -ne "PASS" -or
      $null -eq $BrowserEvidence -or
      $null -eq $ProfileCleanup -or
      $null -eq $ProcessCleanup
    ) {
      Fail "FORMAL_TERMINAL_PASS_PROJECTION_MISSING"
    }
    $candidate = $BrowserEvidence.regeneratedCandidateBeforeApproval
    $browserReceipt = $BrowserEvidence.browserRuntimeReceipt
    $approval = $BrowserEvidence.approval
    $storyBible = $BrowserEvidence.storyBible
    $browserEvidenceDigest = [string]$browserReceipt.receiptId
    $candidateDigest = [string]$candidate.normalizedContentDigest
    $payload["browserResult"] = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-browser-result-v1"
      attemptId = $formalAttemptId
      status = "PASS"
      backendId = [string]$candidate.backendId
      actualExecutor = [string]$candidate.actualExecutor
      webLlmGenerationObserved = [bool]$browserReceipt.browserGenerationUsed
      browserExecutionReceiptVerified = [bool]$browserReceipt.receiptIntegrityVerified
      browserExecutionReceiptDigest = $browserEvidenceDigest
      externalRequest = [bool]$candidate.externalRequest
      dataLeftDevice = [bool]$candidate.dataLeftDevice
      prohibitedExternalAiRequestCount = [int]$BrowserEvidence.prohibitedExternalAiRequestCount
      candidateGenerated = [bool]([string]$candidate.id)
    }
    $payload["networkReceipt"] = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-network-receipt-v1"
      attemptId = $formalAttemptId
      status = "PASS"
      externalRequest = [bool]$candidate.externalRequest
      dataLeftDevice = [bool]$candidate.dataLeftDevice
      prohibitedExternalAiRequestCount = [int]$BrowserEvidence.prohibitedExternalAiRequestCount
    }
    $payload["modelMetadata"] = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-model-metadata-v1"
      attemptId = $formalAttemptId
      status = "PASS"
      backendId = [string]$candidate.backendId
      actualExecutor = [string]$candidate.actualExecutor
      webLlmGenerationObserved = [bool]$browserReceipt.browserGenerationUsed
      browserExecutionReceiptVerified = [bool]$browserReceipt.receiptIntegrityVerified
    }
    $payload["persistenceTruth"] = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-persistence-truth-v1"
      attemptId = $formalAttemptId
      status = "PASS"
      source = "browser-evidence"
      sourceEvidenceDigest = $browserEvidenceDigest
      persistence = $BrowserEvidence.persistence
    }
    $payload["storyBibleTruth"] = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-story-bible-truth-v1"
      attemptId = $formalAttemptId
      status = "PASS"
      source = "browser-evidence"
      sourceEvidenceDigest = $browserEvidenceDigest
      storyBible = [pscustomobject][ordered]@{
        status = [string]$storyBible.status
        approvedRecordCreated = [bool]$storyBible.approvedRecordCreated
        approvedRecordReloadVerified = [bool]$storyBible.approvedRecordReloadVerified
        modelContextBindingVerified = [bool]$storyBible.modelContextBindingVerified
        crossProjectLeakCount = [int]$storyBible.crossProjectLeakCount
      }
    }
    $payload["candidateLineage"] = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-candidate-lineage-v1"
      attemptId = $formalAttemptId
      status = "PASS"
      candidateId = [string]$candidate.id
      candidateDigest = $candidateDigest
      generatedBy = [string]$candidate.actualExecutor
      persistedBeforeApproval = ([int]$candidate.canonicalMutationCount -ne 0)
      approvalState = if ([string]$candidate.status -eq "awaiting-approval") { "candidate" } else {
        [string]$candidate.status
      }
    }
    $payload["approvalReceipt"] = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-approval-receipt-v1"
      attemptId = $formalAttemptId
      status = "PASS"
      candidateId = [string]$candidate.id
      candidateDigest = $candidateDigest
      approvalTransactionVerified = [bool]$approval.fullReceiptRevalidatedBeforeAndAfterReload
      approvedRecordCreated = [bool]([string]$approval.artifactId -and [string]$approval.status -eq "approved")
      persistedAfterApproval = [bool]$approval.persistedAfterReload
    }
    $payload["profileCleanup"] = $ProfileCleanup
    $payload["processCleanup"] = $ProcessCleanup
  } elseif ([string]$formalAttemptSummary.state -ne "PRECHECK_FAILED") {
    if ($TerminalStatus -eq "FAIL" -and [bool]$formalAttemptSummary.runnerStarted) {
      $payload["browserFailure"] = [pscustomobject][ordered]@{
        schemaVersion = "p24b-rc6.2-formal-browser-failure-v1"
        attemptId = $formalAttemptId
        status = "FAIL"
        reasonCode = $ReasonCode
      }
    }
    if ($null -ne $ProfileCleanup) { $payload["profileCleanup"] = $ProfileCleanup }
    if ($null -ne $ProcessCleanup) { $payload["processCleanup"] = $ProcessCleanup }
  }

  try {
    $finalized = Invoke-FormalNodeJson $terminalEvidencePath "finalize" $payload (
      "FORMAL_TERMINAL_FINALIZATION_FAILED"
    )
    if (
      [string]$finalized.status -ne "PASS" -or
      [string]$finalized.attemptState -ne [string]$formalAttemptSummary.state -or
      [string]$finalized.terminalStatus -ne $TerminalStatus -or
      [bool]$finalized.containsCredentialValues
    ) { Fail "FORMAL_TERMINAL_FINALIZATION_INVALID" }
    $validationMode = if ($TerminalStatus -eq "PASS") { "validate-formal" } else { "validate" }
    $validated = Invoke-FormalNodeJson $terminalEvidencePath $validationMode ([ordered]@{
      bundleDirectory = $formalTerminalBundleDirectory
      expectedControlCommit = $ExpectedGateControlCommit
    }) "FORMAL_TERMINAL_VALIDATION_FAILED"
    if (
      [string]$validated.status -ne "PASS" -or
      [string]$validated.attemptState -ne [string]$formalAttemptSummary.state -or
      [string]$validated.terminalStatus -ne $TerminalStatus -or
      [bool]$validated.containsCredentialValues -or
      ($TerminalStatus -eq "PASS" -and [bool]$validated.formalPass -ne $true)
    ) { Fail "FORMAL_TERMINAL_VALIDATION_INVALID" }
    if (
      $TerminalStatus -eq "PASS" -and
      (-not (Test-Path -LiteralPath (Join-Path $formalTerminalBundleDirectory (
        "terminal-evidence-manifest.json"
      )) -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $formalTerminalBundleDirectory (
        "terminal-evidence-manifest.sha256"
      )) -PathType Leaf))
    ) { Fail "FORMAL_TERMINAL_COMMIT_MARKER_MISSING" }
    $script:formalTerminalSafeResult = $finalized
    $script:formalTerminalValidation = $validated
    $script:formalTerminalFinalized = $true
  } catch {
    Publish-FormalTerminalEmergency "FORMAL_TERMINAL_FINALIZATION_FAILED"
    throw
  }
}

function Close-FormalPostLaunchAttempt(
  [bool]$GateSucceeded,
  [string]$FailureReason,
  [switch]$Terminalize
) {
  if ($formalTerminalFinalizationAttempted) {
    if (-not $formalTerminalFinalized) { Fail "FORMAL_TERMINAL_FINALIZATION_INCOMPLETE" }
    return
  }
  $summary = Get-VerifiedFormalAttempt "FORMAL_TERMINAL_STATE_VERIFY_FAILED"
  if ([string]$summary.state -notin @("LAUNCH_COMMITTED", "RUNNER_STARTED", "BROWSER_STARTED")) {
    Fail "FORMAL_POSTLAUNCH_STATE_INVALID"
  }
  if ($FailureReason -notmatch '^[A-Z][A-Z0-9_]{2,127}$') {
    $FailureReason = "PRODUCTION_BROWSER_WRAPPER_FAILED"
  }
  if ([bool]$summary.runnerStarted -and $null -eq $formalRunnerEnvelopeValidation) {
    [void](Resolve-RunnerEnvelopeValidation)
  }
  $nonPassTerminalStatus = if (
    [bool]$summary.runnerCompleted -and
    [string]$summary.runnerOutcome -eq "FAIL" -and
    $null -ne $formalRunnerFailureProjection
  ) {
    [string]$formalRunnerFailureProjection.status
  } elseif ($runnerStage -in @("runner-timeout", "runner-start")) {
    "ABORTED"
  } else {
    "FAIL"
  }
  $cleanupPassed = (
    $null -ne $formalProfileCleanupProjection -and
    $null -ne $formalProcessCleanupProjection -and
    [string]$formalProfileCleanupProjection.status -eq "PASS" -and
    [string]$formalProcessCleanupProjection.status -eq "PASS"
  )
  if (
    [bool]$summary.runnerStarted -and
    -not [bool]$summary.runnerCompleted -and
    $null -eq $formalRunnerFailureProjection -and
    (
      [string]$formalRunnerEnvelopeValidation.status -ne "PASS" -or
      [string]$formalRunnerEnvelopeValidation.validationDisposition -ne "VALIDATED" -or
      [string]$formalRunnerEnvelopeValidation.statusObserved -ne "PASS"
    )
  ) {
    if ($null -eq $formalRunnerEnvelopeValidation) {
      Fail "FORMAL_RUNNER_ENVELOPE_VALIDATION_MISSING"
    }
    $runnerExit = if ($null -ne $runnerExitCode) { [int]$runnerExitCode } else { 1 }
    $script:formalRunnerFailureProjection = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-formal-runner-failure-v2"
      attemptId = $formalAttemptId
      status = $nonPassTerminalStatus
      reasonCode = $FailureReason
      exitCode = $runnerExit
      runnerEnvelopeDigest = $formalRunnerEnvelopeDigest
      runnerEnvelopeValidationDigest = [string]$formalRunnerEnvelopeValidation.validationDigest
    }
  }
  if ([string]$summary.state -eq "BROWSER_STARTED" -and -not [bool]$summary.runnerCompleted) {
    $runnerOutcome = if (
      $null -ne $formalRunnerEnvelopeValidation -and
      [string]$formalRunnerEnvelopeValidation.status -eq "PASS" -and
      [string]$formalRunnerEnvelopeValidation.validationDisposition -eq "VALIDATED" -and
      [string]$formalRunnerEnvelopeValidation.statusObserved -eq "PASS" -and
      [int]$formalRunnerEnvelopeValidation.observedExitCode -eq 0 -and
      [int]$runnerExitCode -eq 0
    ) {
      "PASS"
    } else {
      "FAIL"
    }
    $runnerExit = if ($null -ne $runnerExitCode) { [int]$runnerExitCode } else { 1 }
    if ($runnerOutcome -eq "PASS") {
      $script:formalRunnerResultProjection = [pscustomobject][ordered]@{
        schemaVersion = "p24b-rc6.2-formal-runner-result-v1"
        attemptId = $formalAttemptId
        status = "PASS"
        exitCode = $runnerExit
      }
      $runnerBinding = Invoke-FormalNodeJson $terminalEvidencePath "bind-projections" ([ordered]@{
        runnerResult = $formalRunnerResultProjection
      }) "FORMAL_RUNNER_BINDING_FAILED"
    } else {
      if ($null -eq $formalRunnerFailureProjection) {
        Fail "FORMAL_RUNNER_FAILURE_PROJECTION_MISSING"
      }
      $runnerBinding = Invoke-FormalNodeJson $terminalEvidencePath "bind-projections" ([ordered]@{
        runnerFailure = $formalRunnerFailureProjection
      }) "FORMAL_RUNNER_BINDING_FAILED"
    }
    $summary = Invoke-FormalAttemptTransition "RUNNER_COMPLETED" ([ordered]@{
      outcome = $runnerOutcome
      exitCode = $runnerExit
      runnerEvidenceDigest = [string]$runnerBinding.runnerEvidenceDigest
    }) "BROWSER_STARTED" "BROWSER_STARTED" "FORMAL_RUNNER_COMPLETE_STATE_FAILED"
  }
  if ($null -ne $formalProfileCleanupProjection -and $null -ne $formalProcessCleanupProjection -and -not [bool]$summary.cleanupCompleted) {
    $cleanupBinding = Invoke-FormalNodeJson $terminalEvidencePath "bind-projections" ([ordered]@{
      profileCleanup = $formalProfileCleanupProjection
      processCleanup = $formalProcessCleanupProjection
    }) "FORMAL_CLEANUP_BINDING_FAILED"
    $summary = Invoke-FormalAttemptTransition "CLEANUP_COMPLETED" ([ordered]@{
      profileCleanupDigest = [string]$cleanupBinding.profileCleanupDigest
      processCleanupDigest = [string]$cleanupBinding.processCleanupDigest
    }) ([string]$summary.state) ([string]$summary.state) "FORMAL_CLEANUP_STATE_FAILED"
  }
  $passEligible = (
    $GateSucceeded -and
    [string]$summary.state -eq "BROWSER_STARTED" -and
    [bool]$summary.runnerCompleted -and
    [string]$summary.runnerOutcome -eq "PASS" -and
    [bool]$summary.cleanupCompleted
  )
  if (-not $Terminalize) {
    if (-not $passEligible) { Fail "FORMAL_PASS_PREPARATION_FAILED" }
    return
  }
  if ($passEligible) {
    $summary = Invoke-FormalAttemptTransition "TERMINAL_PASS" ([ordered]@{}) (
      "BROWSER_STARTED"
    ) "TERMINAL_PASS" "FORMAL_TERMINAL_PASS_STATE_FAILED"
    Invoke-FormalTerminalEvidence "PASS" "" $runnerEvidence (
      $formalProfileCleanupProjection
    ) $formalProcessCleanupProjection
  } else {
    $terminalStatus = $nonPassTerminalStatus
    $eventType = if ($terminalStatus -eq "ABORTED") { "TERMINAL_ABORTED" } else { "TERMINAL_FAIL" }
    $targetState = if ($terminalStatus -eq "ABORTED") { "TERMINAL_ABORTED" } else { "TERMINAL_FAIL" }
    $summary = Invoke-FormalAttemptTransition $eventType ([ordered]@{
      reasonCode = $FailureReason
    }) ([string]$summary.state) $targetState "FORMAL_TERMINAL_FAILURE_STATE_FAILED"
    Invoke-FormalTerminalEvidence $terminalStatus $FailureReason $runnerEvidence (
      $formalProfileCleanupProjection
    ) $formalProcessCleanupProjection
  }
  $script:formalAttemptClosed = $true
}

function Complete-FormalPreflightFailure([string]$ReasonCode) {
  if (-not $formalAttemptPrepared) { return }
  if ($ReasonCode -notmatch '^[A-Z][A-Z0-9_]{2,127}$') { $ReasonCode = "PREFLIGHT_UNKNOWN_FAILURE" }
  try {
    $summary = Get-VerifiedFormalAttempt "FORMAL_PREFLIGHT_FAILURE_VERIFY_FAILED"
    if ([string]$summary.state -in @("PREPARED", "PREFLIGHT_PASSED")) {
      $body = [ordered]@{ reasonCode = $ReasonCode }
      if ([string]$summary.state -eq "PREPARED" -and $formalRuntimeReceiptDigest) {
        $body["runtimeReceiptDigest"] = $formalRuntimeReceiptDigest
      }
      $summary = Invoke-FormalAttemptTransition "PREFLIGHT_FAILED" $body ([string]$summary.state) (
        "PRECHECK_FAILED"
      ) "FORMAL_PREFLIGHT_FAILURE_STATE_FAILED"
    }
    if ([string]$summary.state -ne "PRECHECK_FAILED" -or [string]$summary.terminalStatus -ne "FAIL") {
      Fail "FORMAL_PREFLIGHT_FAILURE_STATE_INVALID"
    }
    Invoke-FormalTerminalEvidence "FAIL" $ReasonCode $null $null $null
  } catch {
    Publish-FormalTerminalEmergency "FORMAL_PREFLIGHT_TERMINALIZATION_FAILED"
    throw
  }
}

function Invoke-ReleaseAttestationVerification([string]$Code) {
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $ghExe
  $startInfo.Arguments = "release verify $releaseTag --repo bobobo-org/novel --format json"
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.EnvironmentVariables.Clear()
  foreach ($name in @("SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramData", "COMSPEC")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $startInfo.EnvironmentVariables[$name] = $value }
  }
  $startInfo.EnvironmentVariables["PATH"] = "C:\Windows\System32;C:\Windows"
  $startInfo.EnvironmentVariables["NO_COLOR"] = "1"
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { Fail $Code }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(120000)) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
    Fail $Code
  }
  $process.WaitForExit()
  $stdout = [string]$stdoutTask.Result
  $stderr = [string]$stderrTask.Result
  if ($process.ExitCode -ne 0 -or $stdout.Length -gt 262144 -or $stderr.Length -gt 65536 -or $stderr.Trim().Length -ne 0) {
    Fail $Code
  }
  $verification = $stdout | ConvertFrom-Json
  $statement = $verification.verificationResult.statement
  $subject = @($statement.subject)
  if (
    $subject.Count -ne 1 -or
    [string]$statement._type -ne "https://in-toto.io/Statement/v1" -or
    [string]$statement.predicateType -ne "https://in-toto.io/attestation/release/v0.2" -or
    [string]$subject[0].uri -ne "pkg:github/bobobo-org/novel@$releaseTag" -or
    [string]$subject[0].digest.sha1 -ne $releaseTagObject -or
    [string]$statement.predicate.databaseId -ne [string]$releaseId -or
    [string]$statement.predicate.repository -ne "bobobo-org/novel" -or
    [string]$statement.predicate.tag -ne $releaseTag -or
    [string]$verification.verificationResult.signature.certificate.subjectAlternativeName -ne "https://dotcom.releases.github.com"
  ) { Fail $Code }
  $verifiedTimestamps = @($verification.verificationResult.verifiedTimestamps)
  if ($verifiedTimestamps.Count -lt 1 -or [string]$verifiedTimestamps[0].type -ne "TimestampAuthority") { Fail $Code }
  return [pscustomobject][ordered]@{
    statement = $statement
    verifiedCertificateIdentity = [string]$verification.verificationResult.signature.certificate.subjectAlternativeName
    verifiedTimestamp = [string]$verifiedTimestamps[0].timestamp
    rawVerificationDigest = Sha256Text $stdout.Trim()
  }
}

function Assert-MainCas([string]$Code) {
  $ref = Invoke-GitHubJson "$githubApiRoot/git/ref/heads/main" $Code
  if (
    [string]$ref.ref -ne "refs/heads/main" -or
    [string]$ref.object.type -ne "commit" -or
    [string]$ref.object.sha -ne $ExpectedGateControlCommit
  ) {
    Fail $Code
  }
}

function Invoke-GitHubJson([string]$Uri, [string]$Code) {
  if (-not $Uri.StartsWith("$githubApiRoot/", [StringComparison]::Ordinal)) { Fail $Code }
  try {
    return Invoke-RestMethod -Uri "$Uri`?gate=$([Guid]::NewGuid().ToString('N'))" -TimeoutSec 30 -Headers @{
      Accept = "application/vnd.github+json"
      "X-GitHub-Api-Version" = "2022-11-28"
      "User-Agent" = "novel-rc6-2-production-browser-gate"
      "Cache-Control" = "no-store"
    }
  } catch {
    Fail $Code
  }
}

function Assert-ControlLineage {
  $head = Invoke-GitScalar @("rev-parse", "HEAD") "LOCAL_HEAD_READ_FAILED"
  if ($head -ne $ExpectedGateControlCommit) { Fail "LOCAL_GATE_CONTROL_MISMATCH" }
  $originUrl = Invoke-GitScalar @("config", "--get", "remote.origin.url") "LOCAL_ORIGIN_READ_FAILED"
  if ($originUrl -ne $canonicalRepositoryUrl) { Fail "LOCAL_ORIGIN_MISMATCH" }
  $headParents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $head) "GATE_PARENT_READ_FAILED") -split "\s+"
  $c9Parents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $c9BrowserGateControl) "C9_GATE_PARENT_READ_FAILED") -split "\s+"
  $c8Parents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $c8BrowserGateControl) "C8_GATE_PARENT_READ_FAILED") -split "\s+"
  $c7Parents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $c7BrowserGateControl) "C7_GATE_PARENT_READ_FAILED") -split "\s+"
  $c6Parents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $c6BrowserGateControl) "C6_GATE_PARENT_READ_FAILED") -split "\s+"
  $c5Parents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $c5BrowserGateControl) "C5_GATE_PARENT_READ_FAILED") -split "\s+"
  $c4Parents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $c4BrowserGateControl) "C4_GATE_PARENT_READ_FAILED") -split "\s+"
  $initialParents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $initialBrowserGateControl) "INITIAL_GATE_PARENT_READ_FAILED") -split "\s+"
  $recoveryParents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $productionRecoveryControl) "RECOVERY_PARENT_READ_FAILED") -split "\s+"
  $failedParents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $failedRecoveryControl) "FAILED_CONTROL_PARENT_READ_FAILED") -split "\s+"
  if ($headParents.Count -ne 2 -or $headParents[0] -ne $head -or $headParents[1] -ne $c9BrowserGateControl) {
    Fail "GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($c9Parents.Count -ne 2 -or $c9Parents[0] -ne $c9BrowserGateControl -or $c9Parents[1] -ne $c8BrowserGateControl) {
    Fail "C9_GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($c8Parents.Count -ne 2 -or $c8Parents[0] -ne $c8BrowserGateControl -or $c8Parents[1] -ne $c7BrowserGateControl) {
    Fail "C8_GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($c7Parents.Count -ne 2 -or $c7Parents[0] -ne $c7BrowserGateControl -or $c7Parents[1] -ne $c6BrowserGateControl) {
    Fail "C7_GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($c6Parents.Count -ne 2 -or $c6Parents[0] -ne $c6BrowserGateControl -or $c6Parents[1] -ne $c5BrowserGateControl) {
    Fail "C6_GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($c5Parents.Count -ne 2 -or $c5Parents[0] -ne $c5BrowserGateControl -or $c5Parents[1] -ne $c4BrowserGateControl) {
    Fail "C5_GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($c4Parents.Count -ne 2 -or $c4Parents[0] -ne $c4BrowserGateControl -or $c4Parents[1] -ne $initialBrowserGateControl) {
    Fail "C4_GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($initialParents.Count -ne 2 -or $initialParents[0] -ne $initialBrowserGateControl -or $initialParents[1] -ne $productionRecoveryControl) {
    Fail "INITIAL_GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($recoveryParents.Count -ne 2 -or $recoveryParents[0] -ne $productionRecoveryControl -or $recoveryParents[1] -ne $failedRecoveryControl) {
    Fail "RECOVERY_CONTROL_PARENT_MISMATCH"
  }
  if ($failedParents.Count -ne 2 -or $failedParents[0] -ne $failedRecoveryControl -or $failedParents[1] -ne $productCommit) {
    Fail "FAILED_CONTROL_PRODUCT_PARENT_MISMATCH"
  }
  [void](Invoke-Git @("merge-base", "--is-ancestor", $productCommit, $head) "PRODUCT_NOT_GATE_ANCESTOR")
  Assert-ControlDiffPaths -BaseCommit $c9BrowserGateControl -HeadCommit $head -ExpectedPaths $c10RepairGatePaths -Code "C10_GATE_REPAIR_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $c8BrowserGateControl -HeadCommit $c9BrowserGateControl -ExpectedPaths $c9RepairGatePaths -Code "C9_GATE_REPAIR_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $c7BrowserGateControl -HeadCommit $c8BrowserGateControl -ExpectedPaths $c8RepairGatePaths -Code "C8_GATE_REPAIR_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $c6BrowserGateControl -HeadCommit $c7BrowserGateControl -ExpectedPaths $c7RepairGatePaths -Code "C7_GATE_REPAIR_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $c5BrowserGateControl -HeadCommit $c6BrowserGateControl -ExpectedPaths $c6RepairGatePaths -Code "C6_GATE_REPAIR_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $c4BrowserGateControl -HeadCommit $c5BrowserGateControl -ExpectedPaths $historicalRepairGatePaths -Code "C5_GATE_REPAIR_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $initialBrowserGateControl -HeadCommit $c4BrowserGateControl -ExpectedPaths $historicalRepairGatePaths -Code "C4_GATE_REPAIR_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $productionRecoveryControl -HeadCommit $initialBrowserGateControl -ExpectedPaths $initialGatePaths -Code "INITIAL_GATE_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $productionRecoveryControl -HeadCommit $head -ExpectedPaths $allowedGatePaths -Code "GATE_COMPOSITE_DIFF_INVALID"
}

function Assert-TrackedGateBlobs {
  foreach ($path in $allowedGatePaths) {
    $expectedBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:$path") "GATE_COMMIT_BLOB_READ_FAILED"
    $actualBlob = Invoke-GitScalar @("hash-object", $path) "GATE_WORKTREE_BLOB_READ_FAILED"
    if ($expectedBlob -notmatch '^[a-f0-9]{40}$' -or $actualBlob -ne $expectedBlob) {
      Fail "GATE_BLOB_MISMATCH"
    }
  }
}

function Assert-ProductRuntimeBlobs {
  foreach ($path in $productRuntimePaths) {
    $expectedBlob = Invoke-GitScalar @("rev-parse", "${productCommit}:$path") "PRODUCT_RUNTIME_BLOB_READ_FAILED"
    $actualBlob = Invoke-GitScalar @("hash-object", $path) "PRODUCT_RUNTIME_WORKTREE_BLOB_READ_FAILED"
    if ($expectedBlob -notmatch '^[a-f0-9]{40}$' -or $actualBlob -ne $expectedBlob) {
      Fail "PRODUCT_RUNTIME_BLOB_MISMATCH"
    }
  }
}

function Assert-ReleaseTag {
  $ref = Invoke-GitHubJson "$githubApiRoot/git/ref/tags/$releaseTag" "REMOTE_TAG_READ_FAILED"
  $tag = Invoke-GitHubJson "$githubApiRoot/git/tags/$releaseTagObject" "REMOTE_TAG_OBJECT_READ_FAILED"
  $release = Invoke-GitHubJson "$githubApiRoot/releases/tags/$releaseTag" "REMOTE_RELEASE_READ_FAILED"
  if (
    [string]$ref.ref -ne "refs/tags/$releaseTag" -or
    [string]$ref.object.type -ne "tag" -or
    [string]$ref.object.sha -ne $releaseTagObject -or
    [string]$tag.tag -ne $releaseTag -or
    [string]$tag.object.type -ne "commit" -or
    [string]$tag.object.sha -ne $productCommit -or
    [long]$release.id -ne $releaseId -or
    [string]$release.tag_name -ne $releaseTag -or
    [string]$release.target_commitish -ne $productCommit -or
    [string]$release.name -ne $releaseName -or
    ([string]$release.body).Trim() -ne $releaseBody -or
    [DateTimeOffset]::Parse([string]$release.published_at).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") -ne $releasePublishedAt -or
    $release.draft -ne $false -or
    $release.immutable -ne $true
  ) {
    Fail "REMOTE_TAG_IDENTITY_MISMATCH"
  }
}

function Assert-LkgAudit {
  $run = Invoke-GitHubJson "$githubApiRoot/actions/runs/$ExpectedLkgAuditRunId" "LKG_AUDIT_RUN_READ_FAILED"
  if (
    [long]$run.id -ne $ExpectedLkgAuditRunId -or
    [string]$run.name -ne "Vercel Deploy" -or
    [string]$run.path -ne ".github/workflows/deploy.yml" -or
    [string]$run.event -ne "workflow_dispatch" -or
    [string]$run.head_branch -ne "main" -or
    [string]$run.head_sha -ne $ExpectedGateControlCommit -or
    [int]$run.run_attempt -ne 1 -or
    [string]$run.status -ne "completed" -or
    [string]$run.conclusion -ne "success"
  ) { Fail "LKG_AUDIT_RUN_IDENTITY_INVALID" }

  $jobs = Invoke-GitHubJson "$githubApiRoot/actions/runs/$ExpectedLkgAuditRunId/jobs" "LKG_AUDIT_JOBS_READ_FAILED"
  $expectedSkippedJobs = @(
    "alias cutover",
    "build",
    "immutable Product recovery reconciliation",
    "post-build sealed artifact secret scan",
    "preview",
    "production-env-audit",
    "production-env-repair",
    "restore known stable production aliases",
    "runtime gates",
    "staged deploy",
    "validate"
  ) | Sort-Object
  if ([int]$jobs.total_count -ne 12 -or @($jobs.jobs).Count -ne 12) { Fail "LKG_AUDIT_JOB_TOPOLOGY_INVALID" }
  $auditJobs = @($jobs.jobs | Where-Object { [string]$_.name -eq "audit last known good read only" })
  if ($auditJobs.Count -ne 1 -or [string]$auditJobs[0].conclusion -ne "success") {
    Fail "LKG_AUDIT_JOB_NOT_SUCCESSFUL"
  }
  $actualSkippedJobs = @($jobs.jobs | Where-Object { [string]$_.name -ne "audit last known good read only" } |
    ForEach-Object {
      if ([string]$_.conclusion -ne "skipped") { Fail "LKG_AUDIT_MUTATION_JOB_NOT_SKIPPED" }
      [string]$_.name
    } | Sort-Object)
  if ($actualSkippedJobs.Count -ne $expectedSkippedJobs.Count) { Fail "LKG_AUDIT_JOB_TOPOLOGY_INVALID" }
  for ($index = 0; $index -lt $expectedSkippedJobs.Count; $index += 1) {
    if ($actualSkippedJobs[$index] -ne $expectedSkippedJobs[$index]) { Fail "LKG_AUDIT_JOB_TOPOLOGY_INVALID" }
  }

  $artifacts = Invoke-GitHubJson "$githubApiRoot/actions/runs/$ExpectedLkgAuditRunId/artifacts" "LKG_AUDIT_ARTIFACT_READ_FAILED"
  $expectedName = "production-lkg-readonly-audit-rc62-$productCommit-$expectedDeployment-$ExpectedLkgAuditControlProofDigest-$ExpectedLkgSelectionProofDigest-$ExpectedLkgAuditRunId"
  if ([int]$artifacts.total_count -ne 1 -or @($artifacts.artifacts).Count -ne 1) {
    Fail "LKG_AUDIT_ARTIFACT_TOPOLOGY_INVALID"
  }
  $auditArtifact = $artifacts.artifacts[0]
  if (
    [string]$auditArtifact.name -ne $expectedName -or
    $auditArtifact.expired -ne $false -or
    [long]$auditArtifact.size_in_bytes -lt 256 -or
    [long]$auditArtifact.size_in_bytes -gt 65536 -or
    [string]$auditArtifact.digest -notmatch '^sha256:[a-f0-9]{64}$'
  ) { Fail "LKG_AUDIT_ARTIFACT_IDENTITY_INVALID" }

  $lkgArtifact = Invoke-GitHubJson "$githubApiRoot/actions/artifacts/$lkgArtifactId" "LKG_ARTIFACT_READ_FAILED"
  $expectedLkgArtifactName = "production-last-known-good-control-$productionRecoveryControl-product-$productCommit"
  if (
    [long]$lkgArtifact.id -ne $lkgArtifactId -or
    [string]$lkgArtifact.name -ne $expectedLkgArtifactName -or
    [string]$lkgArtifact.digest -ne $lkgArtifactDigest -or
    [long]$lkgArtifact.size_in_bytes -ne 1095 -or
    $lkgArtifact.expired -ne $false -or
    [long]$lkgArtifact.workflow_run.id -ne $lkgPublisherRunId -or
    [string]$lkgArtifact.workflow_run.head_sha -ne $productionRecoveryControl
  ) { Fail "LKG_ARTIFACT_IDENTITY_INVALID" }

  return [pscustomobject]@{
    AuditRunId = [long]$run.id
    AuditArtifactId = [long]$auditArtifact.id
    AuditArtifactDigest = [string]$auditArtifact.digest
    AuditControlProofDigest = $ExpectedLkgAuditControlProofDigest
    SelectionProofDigest = $ExpectedLkgSelectionProofDigest
    LkgArtifactId = [long]$lkgArtifact.id
    LkgArtifactDigest = [string]$lkgArtifact.digest
    LkgPublisherRunId = [long]$lkgArtifact.workflow_run.id
  }
}

function Get-ListenerSnapshot([int]$Port) {
  $records = @()
  $pattern = "^\s*TCP\s+(\S+):$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
  $lines = & "$env:SystemRoot\System32\netstat.exe" -ano -p TCP
  if ($LASTEXITCODE -ne 0) { Fail "NETSTAT_FAILED" }
  foreach ($line in $lines) {
    if ([string]$line -match $pattern) {
      $records += [pscustomobject]@{
        LocalAddress = [string]$Matches[1]
        OwningProcess = [int]$Matches[2]
      }
    }
  }
  return $records
}

function Assert-ServiceOwner(
  [int]$Port,
  [string]$ServerPath,
  [string]$RuntimePath,
  [string]$Code
) {
  $listeners = @(Get-ListenerSnapshot $Port)
  if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne "127.0.0.1") { Fail "${Code}_LISTENER_INVALID" }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0].OwningProcess)"
  if (-not $process -or -not (SamePath ([string]$process.ExecutablePath) $nodeExe)) { Fail "${Code}_OWNER_INVALID" }
  if ([string]$process.CommandLine -notlike "*$ServerPath*") { Fail "${Code}_COMMAND_INVALID" }
  $runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
  if ([int]$runtime.pid -ne [int]$listeners[0].OwningProcess -or [int]$runtime.port -ne $Port -or [string]$runtime.host -ne "127.0.0.1") {
    Fail "${Code}_RUNTIME_INVALID"
  }
  return [pscustomobject]@{
    Pid = [int]$listeners[0].OwningProcess
    CommandLine = [string]$process.CommandLine
    CreationDate = [string]$process.CreationDate
  }
}

function Get-RequiredZeroHealthCounter([object]$Workload, [string]$Name, [string]$Code) {
  if ($null -eq $Workload) { Fail $Code }
  $property = $Workload.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { Fail $Code }
  $value = $property.Value
  if (-not ($value -is [int] -or $value -is [long]) -or [long]$value -ne 0) { Fail $Code }
  return [int]$value
}

function Get-ServiceHealth {
  $bridge = Invoke-RestMethod -Uri "http://127.0.0.1:3217/health" -TimeoutSec 15 -Headers @{
    Origin = "http://localhost:3000"
    "X-Bridge-Protocol" = "novel-local-bridge/v1"
  }
  $hub = Invoke-RestMethod -Uri "http://127.0.0.1:3227/health" -TimeoutSec 15 -Headers @{
    Origin = "http://localhost:3000"
    "X-Private-Hub-Protocol" = "novel-private-hub/v1"
  }
  $bridgeActive = Get-RequiredZeroHealthCounter $bridge.workload "active" "BRIDGE_HEALTH_INVALID"
  $bridgeQueued = Get-RequiredZeroHealthCounter $bridge.workload "queued" "BRIDGE_HEALTH_INVALID"
  $hubActive = Get-RequiredZeroHealthCounter $hub.workload "active" "HUB_HEALTH_INVALID"
  $hubQueued = Get-RequiredZeroHealthCounter $hub.workload "queued" "HUB_HEALTH_INVALID"
  if (
    $bridge.bridgeProcessAlive -ne $true -or
    $bridge.protocolVersion -ne "novel-local-bridge/v1" -or
    $bridge.bindAddress -ne "127.0.0.1" -or
    $bridge.modelAvailable -ne $true -or
    $bridgeActive -ne 0 -or
    $bridgeQueued -ne 0
  ) { Fail "BRIDGE_HEALTH_INVALID" }
  if (
    $hub.hubProcessAlive -ne $true -or
    $hub.protocolVersion -ne "novel-private-hub/v1" -or
    $hub.bindAddress -ne "127.0.0.1" -or
    $hub.modelAvailable -ne $true -or
    $hubActive -ne 0 -or
    $hubQueued -ne 0
  ) { Fail "HUB_HEALTH_INVALID" }
  return [pscustomobject]@{
    BridgeActive = $bridgeActive
    BridgeQueued = $bridgeQueued
    HubActive = $hubActive
    HubQueued = $hubQueued
    BridgeProtocolVersion = [string]$bridge.protocolVersion
    BridgeBindAddress = [string]$bridge.bindAddress
    BridgeModelAvailable = [bool]$bridge.modelAvailable
    HubProtocolVersion = [string]$hub.protocolVersion
    HubBindAddress = [string]$hub.bindAddress
    HubModelAvailable = [bool]$hub.modelAvailable
  }
}

function Get-OllamaTruth {
  $listeners = @(Get-ListenerSnapshot 11434)
  if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne "127.0.0.1") { Fail "OLLAMA_LISTENER_INVALID" }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0].OwningProcess)"
  $expectedExecutable = "C:\Users\user\AppData\Local\Programs\Ollama\ollama.exe"
  if (-not $process -or -not (SamePath ([string]$process.ExecutablePath) $expectedExecutable)) { Fail "OLLAMA_OWNER_INVALID" }
  if ([string]$process.CommandLine -notmatch "(?i)\bollama\.exe\s+serve\b") { Fail "OLLAMA_COMMAND_INVALID" }
  $version = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -TimeoutSec 15
  $running = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/ps" -TimeoutSec 15
  $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 15
  $runningModelsProperty = $running.PSObject.Properties["models"]
  if (
    $null -eq $runningModelsProperty -or
    $null -eq $runningModelsProperty.Value -or
    -not ($runningModelsProperty.Value -is [Array])
  ) { Fail "OLLAMA_RUNTIME_MODELS_SCHEMA_INVALID" }
  $tagModelsProperty = $tags.PSObject.Properties["models"]
  if (
    $null -eq $tagModelsProperty -or
    $null -eq $tagModelsProperty.Value -or
    -not ($tagModelsProperty.Value -is [Array])
  ) { Fail "OLLAMA_MODEL_CATALOG_SCHEMA_INVALID" }
  $runningModels = @($runningModelsProperty.Value)
  $models = @($tagModelsProperty.Value | Where-Object {
    [string]$candidateId = if ($_.model) { $_.model } else { $_.name }
    $candidateId -eq "qwen2.5:3b"
  })
  if (-not [string]$version.version -or $runningModels.Count -ne 0) { Fail "OLLAMA_RUNTIME_NOT_IDLE" }
  if ($models.Count -ne 1 -or [string]$models[0].digest -notmatch '^[a-f0-9]{64}$') {
    Fail "OLLAMA_MODEL_IDENTITY_INVALID"
  }
  return [pscustomobject]@{
    Pid = [int]$listeners[0].OwningProcess
    CommandLine = [string]$process.CommandLine
    CreationDate = [string]$process.CreationDate
    Version = [string]$version.version
    RunningModelCount = $runningModels.Count
    ModelId = "qwen2.5:3b"
    ModelDigest = [string]$models[0].digest
  }
}

function Assert-NoGateResidue([string]$Code) {
  $temporaryRoot = [IO.Path]::GetTempPath()
  $directories = @(Get-ChildItem -LiteralPath $temporaryRoot -Directory -Filter "novel-rc6-2-edge-*" -ErrorAction SilentlyContinue)
  $processes = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
    [string]$_.CommandLine -match "novel-rc6-2-edge-"
  })
  if ($directories.Count -ne 0 -or $processes.Count -ne 0) { Fail $Code }
}

function Assert-OwnedProfilePath([string]$ProfilePath, [string]$Code) {
  if (-not $ProfilePath) { Fail $Code }
  $resolved = [IO.Path]::GetFullPath($ProfilePath)
  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($resolved), $temporaryRoot) -or
    [IO.Path]::GetFileName($resolved) -notmatch '^novel-rc6-2-edge-[a-f0-9]{32}$'
  ) { Fail $Code }
  return $resolved
}

function Remove-OwnedProfile([string]$ProfilePath, [string]$Code) {
  $resolved = Assert-OwnedProfilePath $ProfilePath $Code
  $owners = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
    ([string]$_.CommandLine).IndexOf($resolved, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  if ($owners.Count -ne 0) { Fail $Code }
  if (Test-Path -LiteralPath $resolved) {
    $directories = [Collections.Generic.Stack[string]]::new()
    $directories.Push($resolved)
    while ($directories.Count -gt 0) {
      $directory = $directories.Pop()
      $directoryTruth = Get-Item -LiteralPath $directory -Force
      if (($directoryTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Fail $Code }
      foreach ($entry in @(Get-ChildItem -LiteralPath $directory -Force)) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Fail $Code }
        if ($entry.PSIsContainer) { $directories.Push($entry.FullName) }
      }
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
  if (Test-Path -LiteralPath $resolved) { Fail $Code }
}

function Stop-OwnedProfileProcesses([string]$ProfilePath, [string]$Code) {
  $resolved = Assert-OwnedProfilePath $ProfilePath $Code
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    $owners = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
      ([string]$_.CommandLine).IndexOf($resolved, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    foreach ($owner in $owners) {
      if (-not (SamePath ([string]$owner.ExecutablePath) $edgeExe)) { Fail $Code }
      & "$env:SystemRoot\System32\taskkill.exe" /PID ([int]$owner.ProcessId) /T /F *> $null
      if ($LASTEXITCODE -ne 0 -and $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$owner.ProcessId)")) {
        Fail $Code
      }
    }
    if ($owners.Count -gt 0) { Start-Sleep -Milliseconds 100 }
  } while ($owners.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
  $remaining = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
    ([string]$_.CommandLine).IndexOf($resolved, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  if ($remaining.Count -ne 0) { Fail $Code }
}

function Stop-RunnerTree([Diagnostics.Process]$Process, [string]$Code) {
  if ($null -eq $Process -or $Process.HasExited) { return }
  & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F *> $null
  if ($LASTEXITCODE -ne 0 -or -not $Process.WaitForExit(60000)) { Fail $Code }
  $Process.WaitForExit()
}

function Start-BoundedProcessStreamCapture(
  [IO.Stream]$Stream,
  [long]$MaximumBytes,
  [string]$Code
) {
  if ($null -eq $Stream -or $MaximumBytes -lt 1 -or $MaximumBytes -gt 1048576) { Fail $Code }
  $capture = [pscustomobject]@{
    Bytes = [IO.MemoryStream]::new([int]$MaximumBytes)
    MaximumBytes = [long]$MaximumBytes
    ObservedBytes = 0L
    LimitExceeded = $false
    Completed = $false
    SafeErrorCode = $null
  }
  $buffer = New-Object byte[] 8192
  $asyncResult = $Stream.BeginRead($buffer, 0, $buffer.Length, $null, $null)
  $capture | Add-Member -NotePropertyName Stream -NotePropertyValue $Stream
  $capture | Add-Member -NotePropertyName Buffer -NotePropertyValue $buffer
  $capture | Add-Member -NotePropertyName AsyncResult -NotePropertyValue $asyncResult
  return $capture
}

function Update-BoundedProcessStreamCapture([object]$Capture, [string]$Code) {
  if ($null -eq $Capture) { Fail $Code }
  try {
    while (-not [bool]$Capture.Completed -and $Capture.AsyncResult.IsCompleted) {
      $read = $Capture.Stream.EndRead($Capture.AsyncResult)
      if ($read -le 0) {
        $Capture.Completed = $true
        break
      }
      $Capture.ObservedBytes = [long]$Capture.ObservedBytes + [long]$read
      $remaining = [long]$Capture.MaximumBytes - [long]$Capture.Bytes.Length
      if ($remaining -gt 0) {
        $toWrite = [int][Math]::Min([long]$read, $remaining)
        $Capture.Bytes.Write($Capture.Buffer, 0, $toWrite)
      }
      if ([long]$Capture.ObservedBytes -gt [long]$Capture.MaximumBytes) {
        $Capture.LimitExceeded = $true
      }
      $Capture.AsyncResult = $Capture.Stream.BeginRead(
        $Capture.Buffer,
        0,
        $Capture.Buffer.Length,
        $null,
        $null
      )
    }
  } catch {
    $Capture.SafeErrorCode = $Code
    Fail $Code
  }
}

function Get-BoundedProcessStreamCapture(
  [object]$Capture,
  [int]$WaitMilliseconds,
  [string]$Code
) {
  if ($null -eq $Capture -or $WaitMilliseconds -lt 1 -or $WaitMilliseconds -gt 60000) { Fail $Code }
  $deadline = [DateTime]::UtcNow.AddMilliseconds($WaitMilliseconds)
  while (-not [bool]$Capture.Completed -and [DateTime]::UtcNow -lt $deadline) {
    Update-BoundedProcessStreamCapture $Capture $Code
    if (-not [bool]$Capture.Completed) { [void]$Capture.AsyncResult.AsyncWaitHandle.WaitOne(10) }
  }
  Update-BoundedProcessStreamCapture $Capture $Code
  if (-not [bool]$Capture.Completed -or [string]$Capture.SafeErrorCode) { Fail $Code }
  $bytes = $Capture.Bytes.ToArray()
  return [pscustomobject][ordered]@{
    Bytes = $bytes
    CapturedBytes = [long]$bytes.LongLength
    ObservedBytes = [long]$Capture.ObservedBytes
    LimitExceeded = [bool]$Capture.LimitExceeded
  }
}

function Convert-BoundedProcessCaptureToText([object]$Capture, [string]$Code) {
  if ($null -eq $Capture -or [bool]$Capture.LimitExceeded) { Fail $Code }
  try { return [Text.UTF8Encoding]::new($false, $true).GetString([byte[]]$Capture.Bytes) }
  catch { Fail $Code }
}

function Get-ReleaseIdentity([string]$Origin, [string]$Code) {
  $nonce = [Guid]::NewGuid().ToString("N")
  $response = Invoke-WebRequest -Uri "$Origin/api/release/identity?gate=$nonce" -TimeoutSec 30 -Headers @{
    "Cache-Control" = "no-store, no-cache, max-age=0"
    Pragma = "no-cache"
  } -MaximumRedirection 0 -UseBasicParsing
  $identity = $response.Content | ConvertFrom-Json
  $buildStarted = [DateTimeOffset]::Parse([string]$identity.buildStartedAt)
  $buildCompleted = [DateTimeOffset]::Parse([string]$identity.buildCompletedAt)
  $deployed = [DateTimeOffset]::Parse([string]$identity.deployedAt)
  if (
    [int]$response.StatusCode -ne 200 -or
    [string]$response.Headers["Cache-Control"] -notmatch "no-store" -or
    [string]$response.Headers["Age"] -ne "0" -or
    [string]$response.Headers["X-Vercel-Cache"] -ne "MISS" -or
    $identity.appCommit -ne $productCommit -or
    $identity.releaseProductCommit -ne $productCommit -or
    $identity.deploymentId -ne $expectedDeployment -or
    $identity.releaseTag -ne $releaseTag -or
    $identity.releaseRevision -ne "rc6.2" -or
    $identity.releaseBuild -ne $releaseBuild -or
    $identity.environment -ne "production" -or
    $identity.deploymentProvenance -ne "verified" -or
    $identity.provenanceStatus -ne "verified" -or
    $identity.buildProvenanceStatus -ne "verified" -or
    $identity.provenanceSource -ne "build_sealed" -or
    $identity.temporalProvenanceStatus -ne "verified" -or
    $identity.temporalProvenanceSource -ne "workflow-sealed" -or
    $identity.artifactAttestationStatus -ne "not_produced" -or
    $null -ne $identity.artifactAttestationDigest -or
    [string]$response.Headers["X-Novel-App-Commit"] -ne [string]$identity.appCommit -or
    [string]$response.Headers["X-Novel-Release-Product-Commit"] -ne [string]$identity.releaseProductCommit -or
    [string]$response.Headers["X-Novel-Release-Revision"] -ne [string]$identity.releaseRevision -or
    [string]$response.Headers["X-Novel-Release-Build"] -ne [string]$identity.releaseBuild -or
    [string]$response.Headers["X-Novel-Deployment-Id"] -ne [string]$identity.deploymentId -or
    [string]$response.Headers["X-Novel-Deployment-Provenance"] -ne [string]$identity.deploymentProvenance -or
    [string]$identity.buildTime -ne [string]$identity.buildCompletedAt -or
    $buildStarted -gt $buildCompleted -or
    $buildCompleted -gt $deployed
  ) { Fail $Code }
  return [pscustomobject]@{
    Origin = $Origin
    DeploymentId = [string]$identity.deploymentId
    AppCommit = [string]$identity.appCommit
    ReleaseProductCommit = [string]$identity.releaseProductCommit
    Environment = [string]$identity.environment
    ReleaseBuild = [string]$identity.releaseBuild
    BuildStartedAt = $buildStarted.ToUniversalTime().ToString("o")
    BuildCompletedAt = $buildCompleted.ToUniversalTime().ToString("o")
    DeployedAt = $deployed.ToUniversalTime().ToString("o")
    TemporalProvenanceStatus = [string]$identity.temporalProvenanceStatus
  }
}

function Assert-IdentitySet([object[]]$Identities, [string]$Code) {
  if ($Identities.Count -ne 3) { Fail $Code }
  $first = $Identities[0]
  foreach ($identity in $Identities) {
    if (
      $identity.DeploymentId -ne $first.DeploymentId -or
      $identity.AppCommit -ne $first.AppCommit -or
      $identity.ReleaseProductCommit -ne $first.ReleaseProductCommit -or
      $identity.ReleaseBuild -ne $first.ReleaseBuild -or
      $identity.BuildStartedAt -ne $first.BuildStartedAt -or
      $identity.BuildCompletedAt -ne $first.BuildCompletedAt -or
      $identity.DeployedAt -ne $first.DeployedAt
    ) { Fail $Code }
  }
}

function Sha256Text([string]$Value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Assert-TaskOwnedEdgeToolchainReceipt([string]$Text, [string]$Code) {
  if (
    -not $Text -or
    $Text.Length -gt 1048576 -or
    $Text.Contains("`r") -or
    $Text.Contains("`n") -or
    $Text.IndexOf([char]0) -ge 0
  ) { Fail $Code }
  try {
    $receipt = $Text | ConvertFrom-Json
  } catch {
    Fail $Code
  }
  if (
    $null -eq $receipt -or
    -not (Test-ExactOrdinalStringSet -Actual @($receipt.PSObject.Properties.Name) -Expected @(
      "schemaVersion",
      "packageJsonDigest",
      "pnpmLockDigest",
      "dependencies",
      "dependencyLinks",
      "edge",
      "proofDigest"
    )) -or
    $null -eq $receipt.edge -or
    -not (Test-ExactOrdinalStringSet -Actual @($receipt.edge.PSObject.Properties.Name) -Expected @(
      "installationKind",
      "version",
      "applicationRootPathDigest",
      "sourceManifestSchemaVersion",
      "sourceManifestDigest",
      "sourceManifestFileSha256",
      "sourceMsiUrl",
      "sourceMsiDigest",
      "sourceMsiPublishedAt",
      "provisionedAt",
      "executableDigest",
      "engineDllDigest",
      "visualElementsManifestDigest",
      "proxyExecutableDigest",
      "pwaHelperExecutableDigest",
      "versionDirectoryDigest",
      "versionDirectoryFileCount",
      "versionDirectoryByteCount",
      "applicationDirectoryDigest",
      "applicationDirectoryCount",
      "applicationFileCount",
      "applicationByteCount"
    ))
  ) { Fail $Code }
  $expectedApplicationRootPathDigest = Sha256Text (
    "p24b-rc6.2-task-owned-edge-application-root-v1`n$($edgeApplicationRoot.ToLowerInvariant())"
  )
  if (
    [string]$receipt.schemaVersion -ne "p24b-rc6.2-production-browser-toolchain-receipt-v1" -or
    [string]$receipt.packageJsonDigest -notmatch '^[a-f0-9]{64}$' -or
    [string]$receipt.pnpmLockDigest -notmatch '^[a-f0-9]{64}$' -or
    [string]$receipt.edge.installationKind -ne "task-owned-receipt-sealed" -or
    [string]$receipt.edge.version -ne $expectedEdgeVersion -or
    [string]$receipt.edge.applicationRootPathDigest -ne $expectedApplicationRootPathDigest -or
    [string]$receipt.edge.sourceManifestSchemaVersion -ne $expectedEdgeManifestSchema -or
    [string]$receipt.edge.sourceManifestDigest -ne $expectedEdgeManifestDigest -or
    [string]$receipt.edge.sourceManifestFileSha256 -ne $expectedEdgeManifestFileSha256 -or
    [string]$receipt.edge.sourceMsiUrl -ne $expectedEdgeSourceMsiUrl -or
    [string]$receipt.edge.sourceMsiDigest -ne $expectedEdgeSourceMsiSha256 -or
    [string]$receipt.edge.sourceMsiPublishedAt -ne $expectedEdgeSourceMsiPublishedAt -or
    [string]$receipt.edge.provisionedAt -ne $expectedEdgeProvisionedAt -or
    [string]$receipt.edge.executableDigest -ne $expectedEdgeSha256 -or
    [string]$receipt.edge.engineDllDigest -ne $expectedEdgeDllSha256 -or
    [string]$receipt.edge.visualElementsManifestDigest -ne $expectedEdgeVisualManifestSha256 -or
    [string]$receipt.edge.proxyExecutableDigest -ne $expectedEdgeProxySha256 -or
    [string]$receipt.edge.pwaHelperExecutableDigest -ne $expectedEdgePwaHelperSha256 -or
    [string]$receipt.edge.versionDirectoryDigest -ne $expectedEdgeDirectorySha256 -or
    [long]$receipt.edge.versionDirectoryFileCount -ne $expectedEdgeVersionDirectoryFileCount -or
    [long]$receipt.edge.versionDirectoryByteCount -ne $expectedEdgeVersionDirectoryByteCount -or
    [string]$receipt.edge.applicationDirectoryDigest -ne $expectedEdgeApplicationSha256 -or
    [long]$receipt.edge.applicationDirectoryCount -ne $expectedEdgeApplicationDirectoryCount -or
    [long]$receipt.edge.applicationFileCount -ne $expectedEdgeApplicationFileCount -or
    [long]$receipt.edge.applicationByteCount -ne $expectedEdgeApplicationByteCount -or
    [string]$receipt.proofDigest -notmatch '^[a-f0-9]{64}$'
  ) { Fail $Code }
  return $receipt
}

function Get-RunnerProgressCounts([string]$Value) {
  $setup = 0
  $candidateGeneration = 0
  $t1Analysis = 0
  $offset = 0
  while ($offset -lt $Value.Length) {
    $lineEnd = $Value.IndexOf("`n", $offset)
    if ($lineEnd -lt 0) { break }
    $line = $Value.Substring($offset, $lineEnd - $offset).TrimEnd("`r")
    $match = [regex]::Match(
      $line,
      '^\[RC6\.2 Closed AI\] (setup|candidate generation|T1 analysis) in progress \([0-9]{1,6}s\)$'
    )
    if (-not $match.Success) { break }
    switch ($match.Groups[1].Value) {
      "setup" { $setup += 1 }
      "candidate generation" { $candidateGeneration += 1 }
      "T1 analysis" { $t1Analysis += 1 }
    }
    if (($setup + $candidateGeneration + $t1Analysis) -gt 4096) { break }
    $offset = $lineEnd + 1
  }
  return [pscustomobject][ordered]@{
    setup = $setup
    candidateGeneration = $candidateGeneration
    t1Analysis = $t1Analysis
  }
}

function Get-TerminalWrapperCode([string]$Stage, [int]$PostcheckErrorCount) {
  switch ($Stage) {
    "runner-envelope-validation" { return "PRODUCTION_BROWSER_RUNNER_ENVELOPE_VALIDATION_FAILED" }
    "runner-start" { return "PRODUCTION_BROWSER_RUNNER_START_FAILED" }
    "runner-timeout" { return "PRODUCTION_BROWSER_RUNNER_TIMEOUT" }
    "runner-output-too-large" { return "PRODUCTION_BROWSER_RUNNER_OUTPUT_TOO_LARGE" }
    "runner-failed" { return "PRODUCTION_BROWSER_RUNNER_FAILED" }
    "runner-evidence-validation" { return "PRODUCTION_BROWSER_EVIDENCE_VALIDATION_FAILED" }
  }
  if ($PostcheckErrorCount -gt 0) { return "PRODUCTION_BROWSER_POSTCHECK_FAILED" }
  switch ($Stage) {
    "gate-linearization" { return "PRODUCTION_BROWSER_LINEARIZATION_FAILED" }
    "pass-publication" { return "PRODUCTION_BROWSER_PASS_PUBLICATION_FAILED" }
    default { return "PRODUCTION_BROWSER_WRAPPER_FAILED" }
  }
}

function Get-MainCasStatus {
  try {
    Assert-MainCas "MAIN_CAS_FAILURE_FINALIZATION_FAILED"
    return "pass"
  } catch {
    return "fail"
  }
}

function Write-CreateNewFlushedFile([string]$Path, [string]$Value, [string]$Code) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
  $stream = $null
  try {
    $stream = [IO.FileStream]::new(
      $Path,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None,
      4096,
      [IO.FileOptions]::WriteThrough
    )
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } catch {
    Fail $Code
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

function Test-ExactRegularFileValue([string]$Path, [string]$Value) {
  try {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $truth = Get-Item -LiteralPath $Path -Force
    if (($truth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    $expectedBytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
    $actualBytes = [IO.File]::ReadAllBytes($Path)
    if ($actualBytes.Length -ne $expectedBytes.Length) { return $false }
    for ($index = 0; $index -lt $expectedBytes.Length; $index += 1) {
      if ($actualBytes[$index] -ne $expectedBytes[$index]) { return $false }
    }
    return $true
  } catch {
    return $false
  }
}

function Remove-OwnedExactFile([string]$Path, [string]$Value) {
  if (-not (Test-ExactRegularFileValue $Path $Value)) { return $false }
  try {
    Remove-Item -LiteralPath $Path -Force
    return (-not (Test-Path -LiteralPath $Path))
  } catch {
    return $false
  }
}

function Publish-AtomicTextFile([string]$Destination, [string]$Value, [string]$Code) {
  $parent = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination))
  $parentTruth = Get-Item -LiteralPath $parent -Force
  if (-not $parentTruth.PSIsContainer -or ($parentTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Fail $Code
  }
  if (Test-Path -LiteralPath $Destination) { Fail $Code }
  $tempPath = Join-Path $parent ".preflight-$preflightRunId-$([Guid]::NewGuid().ToString('N')).tmp"
  $destinationCreated = $false
  $expectedSha256 = Sha256Text $Value
  try {
    Write-CreateNewFlushedFile $tempPath $Value $Code
    $expectedBytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
    $actualBytes = [IO.File]::ReadAllBytes($tempPath)
    if ($actualBytes.Length -ne $expectedBytes.Length) { Fail $Code }
    for ($index = 0; $index -lt $expectedBytes.Length; $index += 1) {
      if ($actualBytes[$index] -ne $expectedBytes[$index]) { Fail $Code }
    }
    [IO.File]::Move($tempPath, $Destination)
    $tempPath = $null
    $destinationCreated = $true
    $publishedBytes = [IO.File]::ReadAllBytes($Destination)
    if ($publishedBytes.Length -ne $expectedBytes.Length) { Fail $Code }
    for ($index = 0; $index -lt $expectedBytes.Length; $index += 1) {
      if ($publishedBytes[$index] -ne $expectedBytes[$index]) { Fail $Code }
    }
    return $expectedSha256
  } catch {
    if ($destinationCreated) {
      [void](Remove-OwnedExactFile $Destination $Value)
    }
    throw
  } finally {
    if ($tempPath -and (Test-Path -LiteralPath $tempPath)) {
      Remove-Item -LiteralPath $tempPath -Force
    }
  }
}

function Get-OptionalFileDigest([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-SafePreflightErrorCode([object]$ErrorRecord) {
  $candidate = [string]$ErrorRecord.Exception.Message
  if ($candidate -match '^[A-Z][A-Z0-9_]{2,127}$') { return $candidate }
  return "PREFLIGHT_UNKNOWN_FAILURE"
}

function Publish-PreflightBundle([string]$Status, [string]$SafeErrorCode, [string]$Checkpoint) {
  if ($Status -notin @("PASS", "FAIL")) { Fail "PREFLIGHT_EVIDENCE_STATUS_INVALID" }
  if ($Checkpoint -notmatch '^[a-z][a-z0-9-]{1,63}$') { Fail "PREFLIGHT_EVIDENCE_CHECKPOINT_INVALID" }
  if ($Status -eq "FAIL" -and $SafeErrorCode -notmatch '^[A-Z][A-Z0-9_]{2,127}$') {
    Fail "PREFLIGHT_EVIDENCE_ERROR_CODE_INVALID"
  }
  if ($Status -eq "PASS") {
    [void](Assert-PersistedRuntimeReceipt "PREFLIGHT_RECEIPT_LINEARIZATION_FAILED")
  }
  $completedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $wrapperDigest = Get-OptionalFileDigest $wrapperPath
  $runnerDigest = Get-OptionalFileDigest $runnerPath
  $contractDigest = Get-OptionalFileDigest $contractPath
  $receiptDigest = if ($null -ne $runtimeReceiptBefore) { [string]$runtimeReceiptBefore.digest } else { $null }
  $receiptFileDigest = Get-OptionalFileDigest $runtimeReceiptPath
  $common = [ordered]@{
    preflightRunId = $preflightRunId
    executionMode = $ExecutionMode
    attemptConsumed = $false
    browserStarted = $false
    runnerStarted = $false
    controlCommit = $ExpectedGateControlCommit
    productCommit = $productCommit
    productionDeploymentId = $expectedDeployment
    productionOrigin = $deploymentOrigin
    wrapperDigest = $wrapperDigest
    runnerDigest = $runnerDigest
    contractDigest = $contractDigest
    receiptExpectedPath = if ($runtimeReceiptPath) { [IO.Path]::GetFileName($runtimeReceiptPath) } else { $null }
    receiptExpectedPathDigest = if ($runtimeReceiptPath) { Sha256Text $runtimeReceiptPath } else { $null }
    receiptExists = [bool]($runtimeReceiptPath -and (Test-Path -LiteralPath $runtimeReceiptPath -PathType Leaf))
    receiptDigest = $receiptDigest
    receiptFileSha256 = $receiptFileDigest
    readOnly = $true
    mutationCount = 0
    childMetrics = $script:lastNodeContractMetrics
    historicalC5Cause = [pscustomobject][ordered]@{
      classification = "L"
      innerTrigger = "unknown_unrecoverable_from_c5_evidence"
      failureCheckpoint = "PRODUCTION_BROWSER_RUNTIME_RECEIPT_BEFORE_FAILED"
    }
    createdAt = $preflightStartedAt
    completedAt = $completedAt
  }
  if ($Status -eq "PASS") {
    $outcome = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-preflight-pass-v1"
      status = "PASS"
      phase = "preflight"
      qualifiesProductionBrowserGate = $false
      eligibleForLuna = $false
      backendReadiness = [pscustomobject][ordered]@{
        bridge = "PASS"
        hub = "PASS"
        ollama = "PASS"
        modelId = [string]$runtimeObservation.modelId
        modelDigest = [string]$runtimeObservation.modelDigest
      }
      ollamaPid = [int]$runtimeObservation.ollamaPid
    }
    foreach ($entry in $common.GetEnumerator()) { $outcome | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value }
    $outcomePath = $preflightPassPath
    $shaPath = $preflightPassShaPath
  } else {
    $outcome = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-preflight-failure-v1"
      status = "FAIL"
      phase = "preflight"
      checkpoint = $Checkpoint
      safeErrorCode = $SafeErrorCode
      failureSummary = "Preflight failed closed before the formal Production Browser boundary."
    }
    foreach ($entry in $common.GetEnumerator()) { $outcome | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value }
    $outcomePath = $preflightFailurePath
    $shaPath = $preflightFailureShaPath
  }
  $publishedBundleFiles = [Collections.Generic.List[object]]::new()
  try {
  $outcomeJson = $outcome | ConvertTo-Json -Compress -Depth 32
  $outcomeSha256 = Publish-AtomicTextFile $outcomePath $outcomeJson "PREFLIGHT_OUTCOME_WRITE_FAILED"
  [void]$publishedBundleFiles.Add([pscustomobject]@{ Path = $outcomePath; Value = $outcomeJson })
  $shaText = "$outcomeSha256`n"
  $shaFileSha256 = Publish-AtomicTextFile $shaPath $shaText "PREFLIGHT_SHA_WRITE_FAILED"
  [void]$publishedBundleFiles.Add([pscustomobject]@{ Path = $shaPath; Value = $shaText })
  $rootCause = [pscustomobject][ordered]@{
    schemaVersion = "p24b-rc6.2-c6-runtime-receipt-root-cause-analysis-v1"
    failureCheckpoint = "PRODUCTION_BROWSER_RUNTIME_RECEIPT_BEFORE_FAILED"
    classification = "L"
    innerTrigger = "unknown_unrecoverable_from_c5_evidence"
    failingAssertion = "Invoke-CleanNodeContract aggregate child acceptance predicate"
    expectedValue = [pscustomobject][ordered]@{
      childExitCode = 0
      stdoutMaximumBytes = 1048576
      stderrMaximumBytes = 65536
      stderrTrimmedBytes = 0
    }
    actualValue = [pscustomobject][ordered]@{
      aggregatePredicate = $false
      childExitCode = $null
      stdoutBytes = $null
      stderrBytes = $null
      reason = "C5 did not retain child result metrics"
    }
    receiptExpectedPath = $null
    receiptActualPath = $null
    receiptExists = $false
    receiptSchemaExpected = "p24b-rc6.2-production-browser-runtime-receipt-v1"
    receiptSchemaActual = $null
    digestExpected = $null
    digestActual = $null
    producer = "scripts/run-rc6-2-production-browser-gate-contract.mjs runtime-receipt"
    consumer = "scripts/run-rc6-2-production-browser-gate.ps1 Invoke-CleanNodeContract"
    timing = [pscustomobject][ordered]@{
      wrapperStartedAt = "2026-08-11T22:07:42.2117507Z"
      wrapperCompletedAt = "2026-08-11T22:07:54.7449850Z"
      elapsedMs = 12533
      innerTimingAvailable = $false
    }
    mutationCount = [pscustomobject][ordered]@{
      production = 0
      serviceControl = 0
      browser = 0
      model = 0
      ephemeralLocalFilesystem = "unknown_unretained_from_c5_evidence"
    }
    createdAt = $completedAt
  }
  $rootCauseJson = $rootCause | ConvertTo-Json -Compress -Depth 8
  $rootCauseSha256 = Publish-AtomicTextFile $rootCauseAnalysisPath $rootCauseJson "ROOT_CAUSE_ANALYSIS_WRITE_FAILED"
  [void]$publishedBundleFiles.Add([pscustomobject]@{ Path = $rootCauseAnalysisPath; Value = $rootCauseJson })
  $receiptShaFileDigest = Get-OptionalFileDigest $runtimeReceiptShaPath
  if ($Status -eq "PASS" -and (-not $receiptFileDigest -or -not $receiptShaFileDigest)) {
    Fail "PREFLIGHT_RECEIPT_EVIDENCE_INCOMPLETE"
  }
  $manifestFiles = [Collections.Generic.List[object]]::new()
  [void]$manifestFiles.Add([pscustomobject][ordered]@{
    name = [IO.Path]::GetFileName($outcomePath)
    sha256 = $outcomeSha256
    byteLength = [IO.File]::ReadAllBytes($outcomePath).Length
  })
  [void]$manifestFiles.Add([pscustomobject][ordered]@{
    name = [IO.Path]::GetFileName($shaPath)
    sha256 = $shaFileSha256
    byteLength = [IO.File]::ReadAllBytes($shaPath).Length
  })
  [void]$manifestFiles.Add([pscustomobject][ordered]@{
    name = [IO.Path]::GetFileName($rootCauseAnalysisPath)
    sha256 = $rootCauseSha256
    byteLength = [IO.File]::ReadAllBytes($rootCauseAnalysisPath).Length
  })
  if ($receiptFileDigest) {
    [void]$manifestFiles.Add([pscustomobject][ordered]@{
      name = [IO.Path]::GetFileName($runtimeReceiptPath)
      sha256 = $receiptFileDigest
      byteLength = [IO.File]::ReadAllBytes($runtimeReceiptPath).Length
    })
  }
  if ($receiptShaFileDigest) {
    [void]$manifestFiles.Add([pscustomobject][ordered]@{
      name = [IO.Path]::GetFileName($runtimeReceiptShaPath)
      sha256 = $receiptShaFileDigest
      byteLength = [IO.File]::ReadAllBytes($runtimeReceiptShaPath).Length
    })
  }
  $manifest = [pscustomobject][ordered]@{
    schemaVersion = "p24b-rc6.2-production-browser-preflight-manifest-v1"
    status = $Status
    phase = "preflight"
    preflightRunId = $preflightRunId
    attemptConsumed = $false
    browserStarted = $false
    runnerStarted = $false
    commitMarker = "manifest-published-last-v1"
    files = [object[]]$manifestFiles.ToArray()
    receipt = if ($receiptFileDigest) {
      [pscustomobject][ordered]@{
        name = [IO.Path]::GetFileName($runtimeReceiptPath)
        digest = $receiptDigest
        fileSha256 = $receiptFileDigest
        shaSidecarName = if ($receiptShaFileDigest) { [IO.Path]::GetFileName($runtimeReceiptShaPath) } else { $null }
        shaSidecarSha256 = $receiptShaFileDigest
      }
    } else { $null }
    mutationCount = 0
    createdAt = $completedAt
  }
  $manifestJson = $manifest | ConvertTo-Json -Compress -Depth 16
  if ($Status -eq "PASS") {
    [void](Assert-PersistedRuntimeReceipt "PREFLIGHT_RECEIPT_LINEARIZATION_FAILED")
  }
  foreach ($publishedBundleFile in $publishedBundleFiles) {
    if (-not (Test-ExactRegularFileValue ([string]$publishedBundleFile.Path) ([string]$publishedBundleFile.Value))) {
      Fail "PREFLIGHT_BUNDLE_LINEARIZATION_FAILED"
    }
  }
  [void](Publish-AtomicTextFile $preflightManifestPath $manifestJson "PREFLIGHT_MANIFEST_WRITE_FAILED")
  return $outcomeJson
  } catch {
    for ($index = $publishedBundleFiles.Count - 1; $index -ge 0; $index -= 1) {
      $publishedBundleFile = $publishedBundleFiles[$index]
      [void](Remove-OwnedExactFile ([string]$publishedBundleFile.Path) ([string]$publishedBundleFile.Value))
    }
    throw
  }
}

function Publish-EmergencyPreflightFailure([string]$SafeErrorCode) {
  [Console]::Error.WriteLine("EVIDENCE_WRITE_FAILED")
  $candidateRoots = [Collections.Generic.List[string]]::new()
  [void]$candidateRoots.Add((Join-Path ([IO.Path]::GetTempPath()) "NovelRC62EvidenceEmergency"))
  $localAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA")
  if ($localAppData) {
    [void]$candidateRoots.Add((Join-Path $localAppData "NovelRC62EvidenceEmergency"))
  }
  foreach ($candidateRoot in $candidateRoots) {
    try {
    $root = [IO.Path]::GetFullPath($candidateRoot)
    if (-not (Test-Path -LiteralPath $root)) { [void][IO.Directory]::CreateDirectory($root) }
    $rootTruth = Get-Item -LiteralPath $root -Force
    if (-not $rootTruth.PSIsContainer -or ($rootTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      continue
    }
    $emergencyPath = Join-Path $root "preflight-emergency-$preflightRunId.json"
    $emergency = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-preflight-emergency-v1"
      status = "FAIL"
      phase = "preflight"
      attemptConsumed = $false
      browserStarted = $false
      runnerStarted = $false
      safeErrorCode = $SafeErrorCode
      evidenceWriterErrorCode = "EVIDENCE_WRITE_FAILED"
      controlCommit = $ExpectedGateControlCommit
      productCommit = $productCommit
      mutationCount = 0
      createdAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    }
    $emergencyJson = $emergency | ConvertTo-Json -Compress -Depth 4
    [void](Publish-AtomicTextFile $emergencyPath $emergencyJson "EMERGENCY_EVIDENCE_WRITE_FAILED")
    return
    } catch {
      # Try the next independent evidence root.
    }
  }
  # The first line is the complete public error channel even if both independent roots are unavailable.
}

function Assert-PersistedRuntimeReceipt([string]$Code) {
  if (-not (Test-Path -LiteralPath $runtimeReceiptPath -PathType Leaf)) { Fail $Code }
  $persistedText = [IO.File]::ReadAllText($runtimeReceiptPath, [Text.UTF8Encoding]::new($false, $true))
  if (-not [StringComparer]::Ordinal.Equals($persistedText, $runtimeReceiptBeforeText)) { Fail $Code }
  $validationInput = [pscustomobject][ordered]@{
    receiptText = $persistedText
    expectedObservation = $runtimeObservation
    validatedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    freshnessMode = "immutable-readback"
  } | ConvertTo-Json -Compress -Depth 24
  $validationText = Invoke-CleanNodeContract "validate-production-runtime-receipt" @{} $Code $validationInput
  $validation = $validationText | ConvertFrom-Json
  $fileDigest = (Get-FileHash -LiteralPath $runtimeReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (
    [string]$validation.status -ne "PASS" -or
    [string]$validation.receiptDigest -ne [string]$runtimeReceiptBefore.digest -or
    [string]$validation.receiptFileSha256 -ne $fileDigest -or
    [IO.File]::ReadAllText($runtimeReceiptShaPath, [Text.Encoding]::ASCII) -ne "$fileDigest`n"
  ) { Fail $Code }
  return $validation
}

function Publish-C6FailureEvidence(
  [pscustomobject]$RunnerCapture,
  [Collections.Specialized.OrderedDictionary]$Postchecks,
  [string]$TerminalWrapperCode
) {
  $casStatus = Get-MainCasStatus
  for ($attempt = 0; $attempt -lt 3; $attempt += 1) {
    $Postchecks.remoteMainCas = $casStatus
    $body = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-gate-c6-failure-v1"
      status = "FAIL"
      qualifiesProductionBrowserGate = $false
      eligibleForLuna = $false
      productCommit = $productCommit
      failedRecoveryControl = $failedRecoveryControl
      productionRecoveryControl = $productionRecoveryControl
      initialBrowserGateControl = $initialBrowserGateControl
      c4BrowserGateControl = $c4BrowserGateControl
      c5BrowserGateControl = $c5BrowserGateControl
      browserGateControl = $ExpectedGateControlCommit
      deploymentId = $expectedDeployment
      lkgAuditRunId = $ExpectedLkgAuditRunId
      lkgAuditControlProofDigest = $ExpectedLkgAuditControlProofDigest
      lkgSelectionProofDigest = $ExpectedLkgSelectionProofDigest
      terminalWrapperCode = $TerminalWrapperCode
      runnerCapture = $RunnerCapture
      postchecks = [pscustomobject]$Postchecks
      completedAt = [DateTime]::UtcNow.ToString("o")
    }
    $bodyJson = $body | ConvertTo-Json -Compress -Depth 100
    $proofDomain = "p24b-rc6.2-production-browser-gate-c6-failure-v1"
    $outer = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-gate-c6-failure-proof-v1"
      canonicalization = "powershell-ordered-json-utf8-no-bom-v1"
      sanitized = $true
      rawSecretsStored = $false
      bodyDigest = Sha256Text $bodyJson
      body = $body
      proofDigest = Sha256Text "$proofDomain`n$bodyJson"
    }
    $outerJson = $outer | ConvertTo-Json -Compress -Depth 100
    $tempPath = Join-Path $evidenceDirectory (
      "production-browser-gate-c6-failure-$ExpectedGateControlCommit-$([Guid]::NewGuid().ToString('N')).tmp"
    )
    try {
      Write-CreateNewFlushedFile $tempPath $outerJson "FAILURE_EVIDENCE_TEMP_WRITE_FAILED"
      $tempTruth = Get-Item -LiteralPath $tempPath -Force
      if (($tempTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Fail "FAILURE_EVIDENCE_TEMP_PATH_INVALID"
      }
      $expectedBytes = [Text.UTF8Encoding]::new($false).GetBytes($outerJson)
      $tempBytes = [IO.File]::ReadAllBytes($tempPath)
      if (
        $tempBytes.Length -ne $expectedBytes.Length -or
        (Get-FileHash -LiteralPath $tempPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne (
          Sha256Text $outerJson
        )
      ) { Fail "FAILURE_EVIDENCE_TEMP_READBACK_MISMATCH" }
      for ($index = 0; $index -lt $expectedBytes.Length; $index += 1) {
        if ($tempBytes[$index] -ne $expectedBytes[$index]) {
          Fail "FAILURE_EVIDENCE_TEMP_READBACK_MISMATCH"
        }
      }
      $observedCasStatus = Get-MainCasStatus
      if ($observedCasStatus -ne $casStatus) {
        Remove-Item -LiteralPath $tempPath -Force
        $tempPath = $null
        $casStatus = $observedCasStatus
        continue
      }
      $tempTruth = Get-Item -LiteralPath $tempPath -Force
      if (($tempTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Fail "FAILURE_EVIDENCE_TEMP_PATH_CHANGED"
      }
      $tempBytes = [IO.File]::ReadAllBytes($tempPath)
      if (
        $tempBytes.Length -ne $expectedBytes.Length -or
        (Get-FileHash -LiteralPath $tempPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne (
          Sha256Text $outerJson
        )
      ) { Fail "FAILURE_EVIDENCE_TEMP_READBACK_MISMATCH" }
      for ($index = 0; $index -lt $expectedBytes.Length; $index += 1) {
        if ($tempBytes[$index] -ne $expectedBytes[$index]) {
          Fail "FAILURE_EVIDENCE_TEMP_READBACK_MISMATCH"
        }
      }
      if (
        (Test-Path -LiteralPath $evidencePath) -or
        (Test-Path -LiteralPath $failureEvidencePath)
      ) { Fail "FAILURE_EVIDENCE_DESTINATION_RACE" }
      $directoryTruth = Get-Item -LiteralPath $evidenceDirectory -Force
      if (
        -not $directoryTruth.PSIsContainer -or
        ($directoryTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
      ) { Fail "FAILURE_EVIDENCE_DIRECTORY_CHANGED" }
      [IO.File]::Move($tempPath, $failureEvidencePath)
      $tempPath = $null
      $publishedTruth = Get-Item -LiteralPath $failureEvidencePath -Force
      if (($publishedTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Fail "FAILURE_EVIDENCE_PUBLICATION_PATH_INVALID"
      }
      $publishedBytes = [IO.File]::ReadAllBytes($failureEvidencePath)
      if ($publishedBytes.Length -ne $expectedBytes.Length) {
        Fail "FAILURE_EVIDENCE_PUBLICATION_MISMATCH"
      }
      for ($index = 0; $index -lt $expectedBytes.Length; $index += 1) {
        if ($publishedBytes[$index] -ne $expectedBytes[$index]) {
          Fail "FAILURE_EVIDENCE_PUBLICATION_MISMATCH"
        }
      }
      return $outerJson
    } finally {
      if ($tempPath -and (Test-Path -LiteralPath $tempPath)) {
        Remove-Item -LiteralPath $tempPath -Force
      }
    }
  }
  Fail "FAILURE_EVIDENCE_CAS_UNSTABLE"
}

function Initialize-EvidenceDestination {
  $localAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA")
  if (-not $localAppData) { Fail "EVIDENCE_LOCALAPPDATA_MISSING" }
  $localRoot = [IO.Path]::GetFullPath($localAppData).TrimEnd('\')
  $directory = [IO.Path]::GetFullPath((Join-Path $localRoot "NovelRC62Evidence"))
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($directory), $localRoot)) {
    Fail "EVIDENCE_DIRECTORY_INVALID"
  }
  if (-not (Test-Path -LiteralPath $directory)) {
    [void][IO.Directory]::CreateDirectory($directory)
  }
  $directoryTruth = Get-Item -LiteralPath $directory -Force
  if (
    -not $directoryTruth.PSIsContainer -or
    ($directoryTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
  ) { Fail "EVIDENCE_DIRECTORY_INVALID" }
  $runDirectory = [IO.Path]::GetFullPath((Join-Path $directory "preflight-$ExpectedGateControlCommit-$preflightRunId"))
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($runDirectory), $directory)) {
    Fail "EVIDENCE_RUN_DIRECTORY_INVALID"
  }
  if (Test-Path -LiteralPath $runDirectory) { Fail "EVIDENCE_RUN_DIRECTORY_ALREADY_EXISTS" }
  [void][IO.Directory]::CreateDirectory($runDirectory)
  $runDirectoryTruth = Get-Item -LiteralPath $runDirectory -Force
  if (-not $runDirectoryTruth.PSIsContainer -or ($runDirectoryTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Fail "EVIDENCE_RUN_DIRECTORY_INVALID"
  }
  $destination = [IO.Path]::GetFullPath((Join-Path $runDirectory "production-browser-gate-$ExpectedGateControlCommit.json"))
  $failureDestination = [IO.Path]::GetFullPath((
    Join-Path $runDirectory "production-browser-gate-c6-failure-$ExpectedGateControlCommit.json"
  ))
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($destination), $runDirectory)) {
    Fail "EVIDENCE_DESTINATION_INVALID"
  }
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($failureDestination), $runDirectory)) {
    Fail "FAILURE_EVIDENCE_DESTINATION_INVALID"
  }
  if (
    (Test-Path -LiteralPath $destination) -or
    (Test-Path -LiteralPath $failureDestination)
  ) { Fail "EVIDENCE_DESTINATION_ALREADY_EXISTS" }
  return [pscustomobject]@{
    Directory = $runDirectory
    Path = $destination
    FailurePath = $failureDestination
    RuntimeReceiptPath = (Join-Path $runDirectory "production-browser-runtime-receipt.json")
    RuntimeReceiptShaPath = (Join-Path $runDirectory "production-browser-runtime-receipt.sha256")
    PreflightPassPath = (Join-Path $runDirectory "preflight-pass.json")
    PreflightPassShaPath = (Join-Path $runDirectory "preflight-pass.sha256")
    PreflightFailurePath = (Join-Path $runDirectory "preflight-failure.json")
    PreflightFailureShaPath = (Join-Path $runDirectory "preflight-failure.sha256")
    PreflightManifestPath = (Join-Path $runDirectory "preflight-manifest.json")
    RootCauseAnalysisPath = (Join-Path $runDirectory "root-cause-analysis.json")
  }
}

if ($ExecutionMode -eq "FormalBrowserGate" -and -not $FormalAuthorizationId) {
  Fail "FORMAL_AUTHORIZATION_REQUIRED"
}
if ($ExecutionMode -eq "PreflightDryRun" -and $PSBoundParameters.ContainsKey("FormalAuthorizationId")) {
  Fail "FORMAL_AUTHORIZATION_NOT_ALLOWED_IN_DRY_RUN"
}

try {
$evidenceDestination = Initialize-EvidenceDestination
$evidenceDirectory = [string]$evidenceDestination.Directory
$evidencePath = [string]$evidenceDestination.Path
$failureEvidencePath = [string]$evidenceDestination.FailurePath
$runtimeReceiptPath = [string]$evidenceDestination.RuntimeReceiptPath
$runtimeReceiptShaPath = [string]$evidenceDestination.RuntimeReceiptShaPath
$preflightPassPath = [string]$evidenceDestination.PreflightPassPath
$preflightPassShaPath = [string]$evidenceDestination.PreflightPassShaPath
$preflightFailurePath = [string]$evidenceDestination.PreflightFailurePath
$preflightFailureShaPath = [string]$evidenceDestination.PreflightFailureShaPath
$preflightManifestPath = [string]$evidenceDestination.PreflightManifestPath
$rootCauseAnalysisPath = [string]$evidenceDestination.RootCauseAnalysisPath
Initialize-TaskOwnedEdgePaths
foreach ($requiredPath in @(
  $gitExe,
  $ghExe,
  $nodeExe,
  $edgeExe,
  $edgeDll,
  $edgeToolchainManifestPath,
  $runnerPath,
  $wrapperPath,
  $contractPath,
  $formalAttemptStatePath,
  $terminalEvidencePath
)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { Fail "GATE_REQUIRED_FILE_MISSING" }
}
foreach ($executable in @($gitExe, $ghExe, $nodeExe, $edgeExe, $edgeDll)) {
  if ((Get-AuthenticodeSignature -FilePath $executable).Status -ne "Valid") { Fail "EXECUTABLE_SIGNATURE_INVALID" }
}
if ((Get-FileHash -LiteralPath $gitExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedGitSha256) { Fail "GIT_DIGEST_INVALID" }
if ((Get-FileHash -LiteralPath $ghExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedGhSha256) { Fail "GH_DIGEST_INVALID" }
if ((Get-FileHash -LiteralPath $nodeExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedNodeSha256) { Fail "NODE_DIGEST_INVALID" }
if ((Get-FileHash -LiteralPath $edgeExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedEdgeSha256) { Fail "EDGE_DIGEST_INVALID" }
if ((Get-FileHash -LiteralPath $edgeDll -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedEdgeDllSha256) { Fail "EDGE_ENGINE_DIGEST_INVALID" }
if ([string](Get-Item -LiteralPath $edgeExe).VersionInfo.ProductVersion -ne $expectedEdgeVersion) { Fail "EDGE_VERSION_INVALID" }
if (@(Invoke-Git @("status", "--porcelain=v1", "--untracked-files=all") "WORKTREE_STATUS_FAILED").Count -ne 0) { Fail "WORKTREE_NOT_CLEAN" }
foreach ($trackedPath in $allowedGatePaths) {
  [void](Invoke-Git @("ls-files", "--error-unmatch", $trackedPath) "GATE_PATH_NOT_TRACKED")
}
Assert-ControlLineage
Assert-TrackedGateBlobs
Assert-ProductRuntimeBlobs
$toolchainReceiptText = Invoke-CleanNodeContract "toolchain-receipt" @{} "PRODUCTION_BROWSER_TOOLCHAIN_RECEIPT_FAILED"
$toolchainReceipt = Assert-TaskOwnedEdgeToolchainReceipt (
  $toolchainReceiptText
) "PRODUCTION_BROWSER_TOOLCHAIN_RECEIPT_INVALID"
if (@(Invoke-Git @("status", "--porcelain=v1", "--untracked-files=all") "WORKTREE_STATUS_AFTER_TOOLCHAIN_RECEIPT_FAILED").Count -ne 0) {
  Fail "WORKTREE_NOT_CLEAN_AFTER_TOOLCHAIN_RECEIPT"
}
Assert-ControlLineage
Assert-TrackedGateBlobs
Assert-ProductRuntimeBlobs
Assert-MainCas "MAIN_CAS_AFTER_TOOLCHAIN_RECEIPT_FAILED"
if ($ExecutionMode -eq "FormalBrowserGate") { Initialize-FormalAttempt }
Assert-MainCas "MAIN_CAS_BEFORE_GATE_FAILED"
Assert-ReleaseTag
$releaseAttestationBefore = Invoke-ReleaseAttestationVerification "RELEASE_ATTESTATION_BEFORE_INVALID"
$lkgAudit = Assert-LkgAudit
Assert-NoGateResidue "GATE_RESIDUE_BEFORE_RUN"

$currentPointer = "C:\Users\user\AppData\Local\NovelLocalAICompanion\current.txt"
$release = (Get-Content -Raw -LiteralPath $currentPointer).Trim()
$expectedReleaseRoot = "C:\Users\user\AppData\Local\NovelLocalAICompanion\releases\1.4.5"
if (-not (SamePath $release $expectedReleaseRoot)) { Fail "COMPANION_RELEASE_MISMATCH" }
$bridgeServer = Join-Path $release "bridge\server.mjs"
$bridgeCore = Join-Path $release "bridge\bridge-core.mjs"
$hubServer = Join-Path $release "private-hub\server.mjs"
$expectedBridgeServerSha256 = "19ea9035ebfe9e233eac9a571088a0cea7950787cafb990f003b63695e73fc1f"
$expectedBridgeCoreSha256 = "8e7a0521b262c5986aa341d846ac6a075346ad4b4c4233724fb0328816ce1f94"
$expectedHubServerSha256 = "f2f5a7b10b5f6783641d0ba3b77bf607ec8de24c6624f36e4a702a60f10c3122"
if ((Get-FileHash -LiteralPath $bridgeServer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedBridgeServerSha256) { Fail "BRIDGE_SERVER_DIGEST_INVALID" }
if ((Get-FileHash -LiteralPath $bridgeCore -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedBridgeCoreSha256) { Fail "BRIDGE_CORE_DIGEST_INVALID" }
if ((Get-FileHash -LiteralPath $hubServer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHubServerSha256) { Fail "HUB_SERVER_DIGEST_INVALID" }
$bridgeRuntime = "C:\Users\user\AppData\Local\NovelLocalBridge\runtime.json"
$hubRuntime = "C:\Users\user\AppData\Local\NovelPrivateHub\runtime.json"
$bridgeBefore = Assert-ServiceOwner 3217 $bridgeServer $bridgeRuntime "BRIDGE"
$hubBefore = Assert-ServiceOwner 3227 $hubServer $hubRuntime "HUB"
$healthBefore = Get-ServiceHealth
$ollamaBefore = Get-OllamaTruth
$identityBefore = @(
  Get-ReleaseIdentity $primaryOrigin "PRIMARY_IDENTITY_BEFORE_INVALID"
  Get-ReleaseIdentity $mirrorOrigin "MIRROR_IDENTITY_BEFORE_INVALID"
  Get-ReleaseIdentity $deploymentOrigin "DEPLOYMENT_IDENTITY_BEFORE_INVALID"
)
Assert-IdentitySet $identityBefore "IDENTITY_SET_BEFORE_MISMATCH"

$receiptCreatedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$runtimeObservation = [pscustomobject][ordered]@{
  preflightRunId = $preflightRunId
  executionMode = $ExecutionMode
  productCommit = $productCommit
  controlCommit = $ExpectedGateControlCommit
  productionDeploymentId = $expectedDeployment
  productionOrigin = $deploymentOrigin
  releaseTag = $releaseTag
  releaseRevision = "rc6.2"
  createdAt = $receiptCreatedAt
  bridgeHealth = [pscustomobject][ordered]@{
    status = "PASS"
    processAlive = $true
    pid = [int]$bridgeBefore.Pid
    protocolVersion = [string]$healthBefore.BridgeProtocolVersion
    bindAddress = [string]$healthBefore.BridgeBindAddress
    modelAvailable = [bool]$healthBefore.BridgeModelAvailable
    active = [int]$healthBefore.BridgeActive
    queued = [int]$healthBefore.BridgeQueued
    serverDigest = $expectedBridgeServerSha256
    coreDigest = $expectedBridgeCoreSha256
  }
  hubHealth = [pscustomobject][ordered]@{
    status = "PASS"
    processAlive = $true
    pid = [int]$hubBefore.Pid
    protocolVersion = [string]$healthBefore.HubProtocolVersion
    bindAddress = [string]$healthBefore.HubBindAddress
    modelAvailable = [bool]$healthBefore.HubModelAvailable
    active = [int]$healthBefore.HubActive
    queued = [int]$healthBefore.HubQueued
    serverDigest = $expectedHubServerSha256
  }
  ollamaHealth = [pscustomobject][ordered]@{
    status = "PASS"
    processAlive = $true
    bindAddress = "127.0.0.1"
    version = [string]$ollamaBefore.Version
    idle = $true
    runningModelCount = [int]$ollamaBefore.RunningModelCount
    modelInstalled = $true
  }
  ollamaPid = [int]$ollamaBefore.Pid
  modelId = [string]$ollamaBefore.ModelId
  modelDigest = [string]$ollamaBefore.ModelDigest
  toolchainReceiptDigest = [string]$toolchainReceipt.proofDigest
  readOnly = $true
  mutationCount = 0
}
$runtimeObservationJson = $runtimeObservation | ConvertTo-Json -Compress -Depth 16
$runtimeReceiptBeforeText = Invoke-CleanNodeContract (
  "production-runtime-receipt"
) @{} "PRODUCTION_BROWSER_RUNTIME_RECEIPT_BUILD_FAILED" $runtimeObservationJson
$runtimeReceiptBefore = $runtimeReceiptBeforeText | ConvertFrom-Json
if (
  [string]$runtimeReceiptBefore.schemaVersion -ne "p24b-rc6.2-production-browser-runtime-receipt-v2" -or
  [string]$runtimeReceiptBefore.digest -notmatch '^[a-f0-9]{64}$'
) { Fail "PRODUCTION_BROWSER_RUNTIME_RECEIPT_BUILD_INVALID" }
[void](Publish-AtomicTextFile $runtimeReceiptPath $runtimeReceiptBeforeText "PRODUCTION_BROWSER_RUNTIME_RECEIPT_PERSIST_FAILED")
$persistedRuntimeReceiptText = [IO.File]::ReadAllText($runtimeReceiptPath, [Text.UTF8Encoding]::new($false, $true))
if (-not [StringComparer]::Ordinal.Equals($persistedRuntimeReceiptText, $runtimeReceiptBeforeText)) {
  Fail "PRODUCTION_BROWSER_RUNTIME_RECEIPT_PERSIST_READBACK_FAILED"
}
$validationInput = [pscustomobject][ordered]@{
  receiptText = $persistedRuntimeReceiptText
  expectedObservation = $runtimeObservation
  validatedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  freshnessMode = "preflight"
} | ConvertTo-Json -Compress -Depth 24
$runtimeReceiptValidationText = Invoke-CleanNodeContract (
  "validate-production-runtime-receipt"
) @{} "PRODUCTION_BROWSER_RUNTIME_RECEIPT_VERIFY_FAILED" $validationInput
$runtimeReceiptValidation = $runtimeReceiptValidationText | ConvertFrom-Json
$runtimeReceiptFileSha256 = (Get-FileHash -LiteralPath $runtimeReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
if (
  [string]$runtimeReceiptValidation.status -ne "PASS" -or
  [string]$runtimeReceiptValidation.receiptDigest -ne [string]$runtimeReceiptBefore.digest -or
  [string]$runtimeReceiptValidation.receiptFileSha256 -ne $runtimeReceiptFileSha256
) { Fail "PRODUCTION_BROWSER_RUNTIME_RECEIPT_VERIFY_INVALID" }
if ($ExecutionMode -eq "FormalBrowserGate") {
  # Bind an already validated receipt to any subsequent PREPARED precheck failure.
  $formalRuntimeReceiptDigest = [string]$runtimeReceiptBefore.digest
}
[void](Publish-AtomicTextFile $runtimeReceiptShaPath "$runtimeReceiptFileSha256`n" "PRODUCTION_BROWSER_RUNTIME_RECEIPT_SHA_WRITE_FAILED")
Assert-MainCas "MAIN_CAS_BEFORE_PREFLIGHT_PUBLICATION_FAILED"
if ($ExecutionMode -eq "FormalBrowserGate") {
  [void](Invoke-FormalAttemptTransition "PREFLIGHT_PASSED" ([ordered]@{
    runtimeReceiptDigest = $formalRuntimeReceiptDigest
    wrapperDigest = $formalWrapperDigest
    runnerDigest = $formalRunnerDigest
    contractDigest = $formalContractDigest
  }) "PREPARED" "PREFLIGHT_PASSED" "FORMAL_PREFLIGHT_STATE_FAILED")
}
$preflightPassJson = Publish-PreflightBundle "PASS" "" "preflight-complete"
if ($ExecutionMode -eq "PreflightDryRun") {
  $preflightPassJson
  exit 0
}
} catch {
  $preflightError = $_
  $safePreflightCode = Get-SafePreflightErrorCode $preflightError
  if ($formalAttemptPrepared) {
    try {
      Complete-FormalPreflightFailure $safePreflightCode
    } catch {
      Publish-FormalTerminalEmergency "FORMAL_PREFLIGHT_TERMINALIZATION_FAILED"
      throw "FORMAL_PREFLIGHT_TERMINALIZATION_FAILED"
    }
  }
  try {
    [void](Publish-PreflightBundle "FAIL" $safePreflightCode "preflight-failed")
  } catch {
    Publish-EmergencyPreflightFailure $safePreflightCode
    exit 2
  }
  throw $safePreflightCode
}

$formalGateBoundaryEntered = $false
$mutex = $null
$mutexHeld = $false
$runnerProcess = $null
$runnerStarted = $false
$runnerPassValidated = $false
$runnerEvidence = $null
$runnerStdout = ""
$runnerStderr = ""
$runnerExitCode = $null
$runnerElapsedMs = 0
$runnerStdoutUtf8ByteLength = 0
$runnerStderrUtf8ByteLength = 0
$runnerProgressCounts = Get-RunnerProgressCounts ""
$runnerUnexpectedStderrCount = 0
$runnerSafeTerminalCodeCount = 0
$runnerOutputLimitExceeded = $false
$runnerStdoutCapture = $null
$runnerStderrCapture = $null
$runnerStage = "boundary-entered"
$runnerStopwatch = [Diagnostics.Stopwatch]::new()
$runnerFailureProjection = $null
$runnerFailureProjectionValidated = $false
$runnerFailureProjectionDigest = $null
$runnerEvidenceValidation = $null
$ownedProfilePath = $null
$evidenceValidationPath = $null
$primaryError = $null
$formalProfileCleanupProjection = $null
$formalProcessCleanupProjection = $null
$formalAttemptClosed = $false
$formalTerminalError = $null
$postErrors = [Collections.Generic.List[string]]::new()
$postcheckStatuses = [ordered]@{
  runnerProcessCleanup = "not-run"
  runnerEvidenceCleanup = "not-run"
  profileCleanup = "not-run"
  residueOwnedGateArtifacts = "not-run"
  serviceSnapshot = "not-run"
  releaseIdentity = "not-run"
  runtimeReceipt = "not-run"
  releaseAttestation = "not-run"
  controlLineage = "not-run"
  trackedGateBlobs = "not-run"
  productRuntimeBlobs = "not-run"
  releaseTag = "not-run"
  worktree = "not-run"
  remoteMainCas = "not-run"
}
try {
  $mutex = [Threading.Mutex]::new($false, "Global\NovelRC62ProductionBrowserGate")
try {
  try {
    $mutexHeld = $mutex.WaitOne(0)
  } catch [Threading.AbandonedMutexException] {
    $mutexHeld = $true
  }
  if (-not $mutexHeld) { Fail "PRODUCTION_BROWSER_GATE_ALREADY_RUNNING" }
  $formalGateBoundaryEntered = $true
  [void](Get-VerifiedFormalAttempt "FORMAL_ATTEMPT_BEFORE_LAUNCH_INVALID")

  $ownedProfilePath = Assert-OwnedProfilePath (
    Join-Path ([IO.Path]::GetTempPath()) "novel-rc6-2-edge-$([Guid]::NewGuid().ToString('N'))"
  ) "OWNED_PROFILE_PATH_INVALID"
  if (Test-Path -LiteralPath $ownedProfilePath) { Fail "OWNED_PROFILE_PREEXISTED" }
  [void][IO.Directory]::CreateDirectory($ownedProfilePath)
  if (@(Get-ChildItem -LiteralPath $ownedProfilePath -Force).Count -ne 0) { Fail "OWNED_PROFILE_NOT_EMPTY" }

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $nodeExe
  $startInfo.Arguments = "`"$runnerPath`" generation"
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.EnvironmentVariables.Clear()
  foreach ($name in @("SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramData", "COMSPEC")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $startInfo.EnvironmentVariables[$name] = $value }
  }
  $startInfo.EnvironmentVariables["PATH"] = "C:\Windows\System32;C:\Windows;C:\Program Files\nodejs"
  $startInfo.EnvironmentVariables["RC6_2_CLOSED_AI_BASE_URL"] = $deploymentOrigin
  $startInfo.EnvironmentVariables["EXPECTED_COMMIT"] = $productCommit
  $startInfo.EnvironmentVariables["EXPECTED_DEPLOYMENT_ID"] = $expectedDeployment
  $startInfo.EnvironmentVariables["RC6_2_CLOSED_AI_EDGE_EXECUTABLE"] = $edgeExe
  $startInfo.EnvironmentVariables["RC6_2_CLOSED_AI_PROFILE_PATH"] = $ownedProfilePath
  $startInfo.EnvironmentVariables["RC6_2_CLOSED_AI_HEADLESS"] = "0"
  $startInfo.EnvironmentVariables["RC6_2_CLOSED_AI_SETUP_TIMEOUT_MS"] = "1800000"
  $startInfo.EnvironmentVariables["RC6_2_CLOSED_AI_GENERATION_TIMEOUT_MS"] = "1200000"
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_ATTEMPT_DIRECTORY"] = $formalAttemptDirectory
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_ATTEMPT_ID"] = $formalAttemptId
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_CONTROL_COMMIT"] = $ExpectedGateControlCommit
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_AUTHORIZATION_ID"] = $FormalAuthorizationId
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_AUTHORIZATION_DIGEST"] = $formalAuthorizationDigest
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_RUNTIME_RECEIPT_DIGEST"] = $formalRuntimeReceiptDigest
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_WRAPPER_DIGEST"] = $formalWrapperDigest
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_RUNNER_DIGEST"] = $formalRunnerDigest
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_CONTRACT_DIGEST"] = $formalContractDigest
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_RELEASE_TAG"] = $releaseTag
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_RELEASE_REVISION"] = "rc6.2"
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_RUNNER_ENVELOPE_PATH"] = $formalRunnerEnvelopePath
  $startInfo.EnvironmentVariables["RC6_2_FORMAL_RUNNER_ENVELOPE_SHA_PATH"] = $formalRunnerEnvelopeShaPath
  $startInfo.EnvironmentVariables["NO_COLOR"] = "1"

  $runnerProcess = [Diagnostics.Process]::new()
  $runnerProcess.StartInfo = $startInfo
  $runnerStage = "runner-start"
  $runnerStopwatch.Start()
  foreach ($path in @(
    $formalRunnerEnvelopePath,
    $formalRunnerEnvelopeShaPath,
    $formalRunnerEnvelopeValidationPath
  )) {
    if (Test-Path -LiteralPath $path) { Fail "FORMAL_RUNNER_ENVELOPE_PATH_PREEXISTED" }
  }
  if (@(Invoke-Git @("status", "--porcelain=v1", "--untracked-files=all") "WORKTREE_STATUS_BEFORE_LAUNCH_FAILED").Count -ne 0) {
    Fail "WORKTREE_NOT_CLEAN_BEFORE_LAUNCH"
  }
  Assert-TrackedGateBlobs
  Assert-ProductRuntimeBlobs
  if (
    (Get-FileHash -LiteralPath $wrapperPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $formalWrapperDigest -or
    (Get-FileHash -LiteralPath $runnerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $formalRunnerDigest -or
    (Get-FileHash -LiteralPath $contractPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $formalContractDigest -or
    (Get-FileHash -LiteralPath $formalAttemptStatePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $formalAttemptStateDigest -or
    (Get-FileHash -LiteralPath $terminalEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $terminalEvidenceDigest -or
    (Get-FileHash -LiteralPath $runnerEnvelopeValidatorPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runnerEnvelopeValidatorDigest
  ) { Fail "FORMAL_CODE_DIGEST_BEFORE_LAUNCH_INVALID" }
  $launchToolchainReceiptText = Invoke-CleanNodeContract (
    "toolchain-receipt"
  ) @{} "TASK_OWNED_EDGE_REVALIDATION_FAILED"
  [void](Assert-TaskOwnedEdgeToolchainReceipt (
    $launchToolchainReceiptText
  ) "TASK_OWNED_EDGE_REVALIDATION_FAILED")
  if (-not [StringComparer]::Ordinal.Equals($launchToolchainReceiptText, $toolchainReceiptText)) {
    Fail "TASK_OWNED_EDGE_REVALIDATION_DRIFT"
  }
  if (@(Invoke-Git @("status", "--porcelain=v1", "--untracked-files=all") "WORKTREE_STATUS_AFTER_LAUNCH_RECEIPT_FAILED").Count -ne 0) {
    Fail "WORKTREE_NOT_CLEAN_AFTER_LAUNCH_RECEIPT"
  }
  Assert-ControlLineage
  Assert-TrackedGateBlobs
  Assert-ProductRuntimeBlobs
  Assert-MainCas "MAIN_CAS_AFTER_LAUNCH_RECEIPT_FAILED"
  if (
    (Get-FileHash -LiteralPath $wrapperPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $formalWrapperDigest -or
    (Get-FileHash -LiteralPath $runnerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $formalRunnerDigest -or
    (Get-FileHash -LiteralPath $contractPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $formalContractDigest -or
    (Get-FileHash -LiteralPath $formalAttemptStatePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $formalAttemptStateDigest -or
    (Get-FileHash -LiteralPath $terminalEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $terminalEvidenceDigest -or
    (Get-FileHash -LiteralPath $runnerEnvelopeValidatorPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runnerEnvelopeValidatorDigest
  ) { Fail "FORMAL_LAUNCH_VERIFIER_DIGEST_INVALID" }
  [void](Invoke-FormalAttemptTransition "LAUNCH_COMMITTED" ([ordered]@{}) (
    "PREFLIGHT_PASSED"
  ) "LAUNCH_COMMITTED" "FORMAL_LAUNCH_COMMIT_FAILED")
  if (-not $runnerProcess.Start()) { Fail "PRODUCTION_BROWSER_RUNNER_START_FAILED" }
  $runnerStarted = $true
  $runnerPid = [int]$runnerProcess.Id
  try {
    [void](Invoke-FormalAttemptTransition "RUNNER_STARTED" ([ordered]@{
      runnerPid = $runnerPid
    }) "LAUNCH_COMMITTED" "RUNNER_STARTED" "FORMAL_RUNNER_START_STATE_FAILED")
  } catch {
    $runnerStartTransitionError = $_
    try {
      if (-not $runnerProcess.HasExited) {
        Stop-RunnerTree $runnerProcess "FORMAL_RUNNER_START_STATE_CLEANUP_FAILED"
        [void]$runnerProcess.WaitForExit(30000)
      }
      $runnerStartTruth = Get-VerifiedFormalAttempt "FORMAL_RUNNER_START_STATE_RECOVERY_FAILED"
      if (-not [bool]$runnerStartTruth.runnerStarted) {
        if ([string]$runnerStartTruth.state -ne "LAUNCH_COMMITTED") {
          Fail "FORMAL_RUNNER_START_STATE_RECOVERY_FAILED"
        }
        [void](Invoke-FormalAttemptTransition "RUNNER_STARTED" ([ordered]@{
          runnerPid = $runnerPid
        }) "LAUNCH_COMMITTED" "RUNNER_STARTED" "FORMAL_RUNNER_START_STATE_RECOVERY_FAILED")
      }
    } catch {
      Publish-FormalTerminalEmergency "FORMAL_RUNNER_START_STATE_RECOVERY_FAILED"
      throw
    }
    throw $runnerStartTransitionError
  }
  $runnerStdoutCapture = Start-BoundedProcessStreamCapture (
    $runnerProcess.StandardOutput.BaseStream
  ) 1048576 "PRODUCTION_BROWSER_RUNNER_STDOUT_CAPTURE_FAILED"
  $runnerStderrCapture = Start-BoundedProcessStreamCapture (
    $runnerProcess.StandardError.BaseStream
  ) 1048576 "PRODUCTION_BROWSER_RUNNER_STDERR_CAPTURE_FAILED"
  $runnerStage = "runner-running"
  $runnerDeadline = [DateTime]::UtcNow.AddMilliseconds(10800000)
  while (-not $runnerProcess.HasExited) {
    Update-BoundedProcessStreamCapture (
      $runnerStdoutCapture
    ) "PRODUCTION_BROWSER_RUNNER_STDOUT_CAPTURE_FAILED"
    Update-BoundedProcessStreamCapture (
      $runnerStderrCapture
    ) "PRODUCTION_BROWSER_RUNNER_STDERR_CAPTURE_FAILED"
    if ([bool]$runnerStdoutCapture.LimitExceeded -or [bool]$runnerStderrCapture.LimitExceeded) {
      $runnerOutputLimitExceeded = $true
      $runnerStage = "runner-output-too-large"
      try { Stop-RunnerTree $runnerProcess "PRODUCTION_BROWSER_RUNNER_OUTPUT_TOO_LARGE_CLEANUP_FAILED" }
      catch { [void]$postErrors.Add("PRODUCTION_BROWSER_RUNNER_OUTPUT_TOO_LARGE_CLEANUP_FAILED") }
      break
    }
    if ([DateTime]::UtcNow -ge $runnerDeadline) {
      $runnerStage = "runner-timeout"
      try { Stop-RunnerTree $runnerProcess "PRODUCTION_BROWSER_RUNNER_TIMEOUT_CLEANUP_FAILED" }
      catch { [void]$postErrors.Add("PRODUCTION_BROWSER_RUNNER_TIMEOUT_CLEANUP_FAILED") }
      break
    }
    [void]$runnerProcess.WaitForExit(100)
  }
  if (-not $runnerProcess.HasExited) { Fail "PRODUCTION_BROWSER_RUNNER_PROCESS_LIVENESS_FAILED" }
  $runnerProcess.WaitForExit()
  $runnerStdoutResult = Get-BoundedProcessStreamCapture (
    $runnerStdoutCapture
  ) 30000 "PRODUCTION_BROWSER_RUNNER_STDOUT_CAPTURE_FAILED"
  $runnerStderrResult = Get-BoundedProcessStreamCapture (
    $runnerStderrCapture
  ) 30000 "PRODUCTION_BROWSER_RUNNER_STDERR_CAPTURE_FAILED"
  $runnerOutputLimitExceeded = [bool](
    $runnerOutputLimitExceeded -or
    $runnerStdoutResult.LimitExceeded -or
    $runnerStderrResult.LimitExceeded
  )
  $runnerStdoutUtf8ByteLength = [long]$runnerStdoutResult.ObservedBytes
  $runnerStderrUtf8ByteLength = [long]$runnerStderrResult.ObservedBytes
  if (-not [bool]$runnerStdoutResult.LimitExceeded) {
    $runnerStdout = Convert-BoundedProcessCaptureToText (
      $runnerStdoutResult
    ) "PRODUCTION_BROWSER_RUNNER_STDOUT_UTF8_INVALID"
  }
  if (-not [bool]$runnerStderrResult.LimitExceeded) {
    $runnerStderr = Convert-BoundedProcessCaptureToText (
      $runnerStderrResult
    ) "PRODUCTION_BROWSER_RUNNER_STDERR_UTF8_INVALID"
  }
  $runnerExitCode = [int]$runnerProcess.ExitCode
  $runnerStopwatch.Stop()
  $runnerElapsedMs = [long]$runnerStopwatch.ElapsedMilliseconds
  if ($runnerStage -eq "runner-timeout") { Fail "PRODUCTION_BROWSER_RUNNER_TIMEOUT" }
  if ($runnerOutputLimitExceeded) { Fail "PRODUCTION_BROWSER_RUNNER_OUTPUT_TOO_LARGE" }
  if ([Text.Encoding]::UTF8.GetByteCount($runnerStdout) -ne $runnerStdoutUtf8ByteLength) {
    Fail "PRODUCTION_BROWSER_RUNNER_STDOUT_CAPTURE_FAILED"
  }
  if ([Text.Encoding]::UTF8.GetByteCount($runnerStderr) -ne $runnerStderrUtf8ByteLength) {
    Fail "PRODUCTION_BROWSER_RUNNER_STDERR_CAPTURE_FAILED"
  }
  $runnerProgressCounts = Get-RunnerProgressCounts $runnerStderr
  $finalRunnerStderrLines = @($runnerStderr -split "\r?\n" | Where-Object { $_ })
  $runnerUnexpectedStderrCount = [int]@($finalRunnerStderrLines | Where-Object {
    $_ -notmatch "^\[RC6\.2 Closed AI\] (?:setup|candidate generation|T1 analysis) in progress \([0-9]+s\)$" -and
    $_ -ne "RC6_2_RUNNER_TERMINAL_FAIL"
  }).Count
  $runnerSafeTerminalCodeCount = [int]@($finalRunnerStderrLines | Where-Object {
    $_ -eq "RC6_2_RUNNER_TERMINAL_FAIL"
  }).Count
  $unexpectedStderr = @($runnerStderr -split "\r?\n" | Where-Object {
    $_ -and
    $_ -notmatch "^\[RC6\.2 Closed AI\] (?:setup|candidate generation|T1 analysis) in progress \([0-9]+s\)$" -and
    $_ -ne "RC6_2_RUNNER_TERMINAL_FAIL"
  })
  $safeTerminalCodes = @($runnerStderr -split "\r?\n" | Where-Object {
    $_ -eq "RC6_2_RUNNER_TERMINAL_FAIL"
  })
  $runnerUnexpectedStderrCount = [int]$unexpectedStderr.Count
  $runnerSafeTerminalCodeCount = [int]$safeTerminalCodes.Count
  if (
    $runnerExitCode -ne 0 -or
    $unexpectedStderr.Count -ne 0 -or
    $safeTerminalCodes.Count -gt 1 -or
    ($runnerExitCode -eq 0 -and $safeTerminalCodes.Count -ne 0) -or
    ($runnerExitCode -ne 0 -and $safeTerminalCodes.Count -ne 1)
  ) {
    $runnerStage = "runner-failed"
    Fail "PRODUCTION_BROWSER_RUNNER_FAILED"
  }

  $runnerStage = "runner-evidence-validation"
  $evidenceValidationPath = Join-Path ([IO.Path]::GetTempPath()) "novel-rc6-2-evidence-$([Guid]::NewGuid().ToString('N')).json"
  if (Test-Path -LiteralPath $evidenceValidationPath) { Fail "RUNNER_EVIDENCE_PATH_PREEXISTED" }
  [IO.File]::WriteAllText($evidenceValidationPath, $runnerStdout, [Text.UTF8Encoding]::new($false))
  $runnerEvidenceValidationText = Invoke-CleanNodeContract "validate-evidence" @{
    RC6_2_BROWSER_EVIDENCE_PATH = $evidenceValidationPath
  } "PRODUCTION_BROWSER_EVIDENCE_VALIDATION_FAILED"
  $runnerEvidenceValidation = $runnerEvidenceValidationText | ConvertFrom-Json
  if (
    [string]$runnerEvidenceValidation.status -ne "PASS" -or
    [string]$runnerEvidenceValidation.evidenceDigest -ne (Sha256Text $runnerStdout.Trim())
  ) { Fail "PRODUCTION_BROWSER_EVIDENCE_VALIDATION_FAILED" }
  $runnerEvidence = $runnerStdout | ConvertFrom-Json
  $runnerPassValidated = $true
  $runnerStage = "runner-pass"
} catch {
  $primaryError = $_
} finally {
  if ($runnerStopwatch.IsRunning) { $runnerStopwatch.Stop() }
  $runnerElapsedMs = [long]$runnerStopwatch.ElapsedMilliseconds
  if ($runnerStarted -and $null -ne $runnerProcess) {
    try {
      if (-not $runnerProcess.HasExited) {
        Stop-RunnerTree $runnerProcess "RUNNER_PROCESS_CLEANUP_FAILED"
        [void]$runnerProcess.WaitForExit(30000)
      }
      if (-not $runnerProcess.HasExited) { Fail "RUNNER_PROCESS_CLEANUP_FAILED" }
      $runnerExitCode = [int]$runnerProcess.ExitCode
      $postcheckStatuses.runnerProcessCleanup = "pass"
    } catch {
      $postcheckStatuses.runnerProcessCleanup = "fail"
      [void]$postErrors.Add("RUNNER_PROCESS_CLEANUP_FAILED")
    }
    if ($null -ne $runnerStdoutCapture) {
      try {
        $runnerStdoutResult = Get-BoundedProcessStreamCapture (
          $runnerStdoutCapture
        ) 30000 "PRODUCTION_BROWSER_RUNNER_STDOUT_CAPTURE_FAILED"
        $runnerStdoutUtf8ByteLength = [long]$runnerStdoutResult.ObservedBytes
        $runnerOutputLimitExceeded = [bool](
          $runnerOutputLimitExceeded -or $runnerStdoutResult.LimitExceeded
        )
        if (-not [bool]$runnerStdoutResult.LimitExceeded) {
          $runnerStdout = Convert-BoundedProcessCaptureToText (
            $runnerStdoutResult
          ) "PRODUCTION_BROWSER_RUNNER_STDOUT_UTF8_INVALID"
        }
      } catch {
        if (-not $postErrors.Contains("PRODUCTION_BROWSER_RUNNER_STDOUT_CAPTURE_FAILED")) {
          [void]$postErrors.Add("PRODUCTION_BROWSER_RUNNER_STDOUT_CAPTURE_FAILED")
        }
      }
    }
    if ($null -ne $runnerStderrCapture) {
      try {
        $runnerStderrResult = Get-BoundedProcessStreamCapture (
          $runnerStderrCapture
        ) 30000 "PRODUCTION_BROWSER_RUNNER_STDERR_CAPTURE_FAILED"
        $runnerStderrUtf8ByteLength = [long]$runnerStderrResult.ObservedBytes
        $runnerOutputLimitExceeded = [bool](
          $runnerOutputLimitExceeded -or $runnerStderrResult.LimitExceeded
        )
        if (-not [bool]$runnerStderrResult.LimitExceeded) {
          $runnerStderr = Convert-BoundedProcessCaptureToText (
            $runnerStderrResult
          ) "PRODUCTION_BROWSER_RUNNER_STDERR_UTF8_INVALID"
        }
      } catch {
        if (-not $postErrors.Contains("PRODUCTION_BROWSER_RUNNER_STDERR_CAPTURE_FAILED")) {
          [void]$postErrors.Add("PRODUCTION_BROWSER_RUNNER_STDERR_CAPTURE_FAILED")
        }
      }
    }
  }
  $runnerProgressCounts = Get-RunnerProgressCounts $runnerStderr
  $finalRunnerStderrLines = @($runnerStderr -split "\r?\n" | Where-Object { $_ })
  $runnerUnexpectedStderrCount = [int]@($finalRunnerStderrLines | Where-Object {
    $_ -notmatch "^\[RC6\.2 Closed AI\] (?:setup|candidate generation|T1 analysis) in progress \([0-9]+s\)$" -and
    $_ -ne "RC6_2_RUNNER_TERMINAL_FAIL"
  }).Count
  $runnerSafeTerminalCodeCount = [int]@($finalRunnerStderrLines | Where-Object {
    $_ -eq "RC6_2_RUNNER_TERMINAL_FAIL"
  }).Count
  if (
    $runnerOutputLimitExceeded -or
    $runnerStdoutUtf8ByteLength -gt 1048576 -or
    $runnerStderrUtf8ByteLength -gt 1048576
  ) {
    $runnerStage = "runner-output-too-large"
    if (-not $postErrors.Contains("PRODUCTION_BROWSER_RUNNER_OUTPUT_TOO_LARGE")) {
      [void]$postErrors.Add("PRODUCTION_BROWSER_RUNNER_OUTPUT_TOO_LARGE")
    }
  }
  if ($evidenceValidationPath -and (Test-Path -LiteralPath $evidenceValidationPath)) {
    try {
      Remove-Item -LiteralPath $evidenceValidationPath -Force
      $postcheckStatuses.runnerEvidenceCleanup = "pass"
    } catch {
      $postcheckStatuses.runnerEvidenceCleanup = "fail"
      [void]$postErrors.Add("RUNNER_EVIDENCE_CLEANUP_FAILED")
    }
  } else {
    $postcheckStatuses.runnerEvidenceCleanup = "pass"
  }
  if ($ownedProfilePath) {
    try {
      Stop-OwnedProfileProcesses $ownedProfilePath "OWNED_PROFILE_PROCESS_CLEANUP_FAILED"
      Remove-OwnedProfile $ownedProfilePath "OWNED_PROFILE_CLEANUP_FAILED"
      $postcheckStatuses.profileCleanup = "pass"
    }
    catch {
      $postcheckStatuses.profileCleanup = "fail"
      [void]$postErrors.Add("OWNED_PROFILE_CLEANUP_FAILED")
    }
  }
  try {
    Assert-NoGateResidue "GATE_RESIDUE_AFTER_RUN"
    $postcheckStatuses.residueOwnedGateArtifacts = "pass"
  } catch {
    $postcheckStatuses.residueOwnedGateArtifacts = "fail"
    [void]$postErrors.Add("GATE_RESIDUE_AFTER_RUN")
  }
  try {
    $bridgeAfter = Assert-ServiceOwner 3217 $bridgeServer $bridgeRuntime "BRIDGE"
    $hubAfter = Assert-ServiceOwner 3227 $hubServer $hubRuntime "HUB"
    $healthAfter = Get-ServiceHealth
    $ollamaAfter = Get-OllamaTruth
    if (
      $bridgeAfter.Pid -ne $bridgeBefore.Pid -or
      $bridgeAfter.CommandLine -ne $bridgeBefore.CommandLine -or
      $bridgeAfter.CreationDate -ne $bridgeBefore.CreationDate -or
      $hubAfter.Pid -ne $hubBefore.Pid -or
      $hubAfter.CommandLine -ne $hubBefore.CommandLine -or
      $hubAfter.CreationDate -ne $hubBefore.CreationDate -or
      $ollamaAfter.Pid -ne $ollamaBefore.Pid -or
      $ollamaAfter.CommandLine -ne $ollamaBefore.CommandLine -or
      $ollamaAfter.CreationDate -ne $ollamaBefore.CreationDate -or
      $ollamaAfter.Version -ne $ollamaBefore.Version -or
      $ollamaAfter.ModelId -ne $ollamaBefore.ModelId -or
      $ollamaAfter.ModelDigest -ne $ollamaBefore.ModelDigest -or
      $healthAfter.BridgeActive -ne $healthBefore.BridgeActive -or
      $healthAfter.BridgeQueued -ne $healthBefore.BridgeQueued -or
      $healthAfter.HubActive -ne $healthBefore.HubActive -or
      $healthAfter.HubQueued -ne $healthBefore.HubQueued -or
      $ollamaAfter.RunningModelCount -ne $ollamaBefore.RunningModelCount -or
      (Get-FileHash -LiteralPath $bridgeServer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedBridgeServerSha256 -or
      (Get-FileHash -LiteralPath $bridgeCore -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedBridgeCoreSha256 -or
      (Get-FileHash -LiteralPath $hubServer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHubServerSha256
    ) { Fail "LOCAL_SERVICE_STATE_CHANGED" }
    $postcheckStatuses.serviceSnapshot = "pass"
  } catch {
    $postcheckStatuses.serviceSnapshot = "fail"
    [void]$postErrors.Add("LOCAL_SERVICE_STATE_CHANGED")
  }
  try {
    $identityAfter = @(
      Get-ReleaseIdentity $primaryOrigin "PRIMARY_IDENTITY_AFTER_INVALID"
      Get-ReleaseIdentity $mirrorOrigin "MIRROR_IDENTITY_AFTER_INVALID"
      Get-ReleaseIdentity $deploymentOrigin "DEPLOYMENT_IDENTITY_AFTER_INVALID"
    )
    Assert-IdentitySet $identityAfter "IDENTITY_SET_AFTER_MISMATCH"
    Assert-IdentitySet @($identityBefore[0], $identityAfter[0], $identityAfter[1]) "IDENTITY_CHANGED_DURING_GATE"
    $postcheckStatuses.releaseIdentity = "pass"
  } catch {
    $postcheckStatuses.releaseIdentity = "fail"
    [void]$postErrors.Add("RELEASE_IDENTITY_POSTCHECK_FAILED")
  }
  try {
    [void](Assert-PersistedRuntimeReceipt "PRODUCTION_BROWSER_RUNTIME_RECEIPT_POSTCHECK_FAILED")
    $postcheckStatuses.runtimeReceipt = "pass"
  } catch {
    $postcheckStatuses.runtimeReceipt = "fail"
    [void]$postErrors.Add("PRODUCTION_BROWSER_RUNTIME_RECEIPT_POSTCHECK_FAILED")
  }
  try {
    $releaseAttestationAfter = Invoke-ReleaseAttestationVerification "RELEASE_ATTESTATION_AFTER_INVALID"
    if ($releaseAttestationAfter.rawVerificationDigest -ne $releaseAttestationBefore.rawVerificationDigest) {
      Fail "RELEASE_ATTESTATION_CHANGED"
    }
    $postcheckStatuses.releaseAttestation = "pass"
  } catch {
    $postcheckStatuses.releaseAttestation = "fail"
    [void]$postErrors.Add("RELEASE_ATTESTATION_POSTCHECK_FAILED")
  }
  try { Assert-ControlLineage; $postcheckStatuses.controlLineage = "pass" }
  catch { $postcheckStatuses.controlLineage = "fail"; [void]$postErrors.Add("CONTROL_LINEAGE_POSTCHECK_FAILED") }
  try { Assert-TrackedGateBlobs; $postcheckStatuses.trackedGateBlobs = "pass" }
  catch { $postcheckStatuses.trackedGateBlobs = "fail"; [void]$postErrors.Add("TRACKED_GATE_BLOBS_POSTCHECK_FAILED") }
  try { Assert-ProductRuntimeBlobs; $postcheckStatuses.productRuntimeBlobs = "pass" }
  catch { $postcheckStatuses.productRuntimeBlobs = "fail"; [void]$postErrors.Add("PRODUCT_RUNTIME_BLOBS_POSTCHECK_FAILED") }
  try { Assert-ReleaseTag; $postcheckStatuses.releaseTag = "pass" }
  catch { $postcheckStatuses.releaseTag = "fail"; [void]$postErrors.Add("RELEASE_TAG_POSTCHECK_FAILED") }
  try {
    if (@(Invoke-Git @("status", "--porcelain=v1", "--untracked-files=all") "WORKTREE_STATUS_AFTER_FAILED").Count -ne 0) {
      Fail "WORKTREE_NOT_CLEAN_AFTER_GATE"
    }
    $postcheckStatuses.worktree = "pass"
  } catch {
    $postcheckStatuses.worktree = "fail"
    [void]$postErrors.Add("WORKTREE_POSTCHECK_FAILED")
  }

  $runnerResidueCount = if (
    $runnerStarted -and $null -ne $runnerProcess -and -not $runnerProcess.HasExited
  ) { 1 } else { 0 }
  $edgeResidueCount = if ($ownedProfilePath) {
    @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
      ([string]$_.CommandLine).IndexOf($ownedProfilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    }).Count
  } else { 0 }
  $profileDisposed = [bool]($ownedProfilePath -and -not (Test-Path -LiteralPath $ownedProfilePath))
  $cleanupStatus = if (
    $profileDisposed -and $runnerResidueCount -eq 0 -and $edgeResidueCount -eq 0 -and
    [string]$postcheckStatuses.profileCleanup -eq "pass" -and
    [string]$postcheckStatuses.residueOwnedGateArtifacts -eq "pass"
  ) { "PASS" } else { "FAIL" }
  $formalProfileCleanupProjection = [pscustomobject][ordered]@{
    schemaVersion = "p24b-rc6.2-formal-profile-cleanup-v1"
    attemptId = $formalAttemptId
    status = $cleanupStatus
    profileDisposed = $profileDisposed
    edgeResidueCount = [int]$edgeResidueCount
  }
  $formalProcessCleanupProjection = [pscustomobject][ordered]@{
    schemaVersion = "p24b-rc6.2-formal-process-cleanup-v1"
    attemptId = $formalAttemptId
    status = $cleanupStatus
    runnerResidueCount = [int]$runnerResidueCount
    edgeResidueCount = [int]$edgeResidueCount
  }
}

if ($runnerStarted -and [bool](
  Get-VerifiedFormalAttempt "FORMAL_RUNNER_ENVELOPE_STATE_VERIFY_FAILED"
).runnerStarted) {
  $stageBeforeEnvelopeValidation = $runnerStage
  try {
    $runnerStage = "runner-envelope-validation"
    $validatedEnvelope = Resolve-RunnerEnvelopeValidation
    $runnerFailureProjectionValidated = (
      [string]$validatedEnvelope.status -eq "PASS" -and
      [string]$validatedEnvelope.statusObserved -eq "FAIL"
    )
    $runnerFailureProjectionDigest = [string]$validatedEnvelope.validationDigest
    $expectedEnvelopeStatus = if ($runnerExitCode -eq 0) { "PASS" } else { "FAIL" }
    if ($expectedEnvelopeStatus -eq "PASS") {
      if (
        [string]$validatedEnvelope.status -ne "PASS" -or
        [string]$validatedEnvelope.statusObserved -ne "PASS"
      ) { Fail "RUNNER_ENVELOPE_DISPOSITION_INVALID" }
    } elseif (
      [string]$validatedEnvelope.status -eq "PASS" -and
      [string]$validatedEnvelope.statusObserved -ne "FAIL"
    ) { Fail "RUNNER_ENVELOPE_DISPOSITION_INVALID" }
    $runnerStage = $stageBeforeEnvelopeValidation
  } catch {
    [void]$postErrors.Add("RUNNER_ENVELOPE_VALIDATION_FAILED")
  }
}

if ($postErrors.Count -ne 0) {
  $postcheckFailureCode = Get-TerminalWrapperCode $runnerStage $postErrors.Count
  if ($runnerStage -ne "runner-envelope-validation") { $runnerStage = "postchecks" }
  Close-FormalPostLaunchAttempt $false $postcheckFailureCode -Terminalize
  Fail "PRODUCTION_BROWSER_POSTCHECK_FAILED:$([string]::Join(',', $postErrors))"
}
if ($null -ne $primaryError) {
  Close-FormalPostLaunchAttempt $false (Get-TerminalWrapperCode $runnerStage $postErrors.Count) -Terminalize
  throw $primaryError
}

$runnerStage = "gate-linearization"
$runnerBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-rc6-2-closed-agent-browser.mjs") "RUNNER_BLOB_FAILED"
$runnerContractBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-rc6-2-closed-agent-runtime.mjs") "RUNNER_CONTRACT_BLOB_FAILED"
$wrapperBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-rc6-2-production-browser-gate.ps1") "WRAPPER_BLOB_FAILED"
$contractBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-rc6-2-production-browser-gate-contract.mjs") "CONTRACT_BLOB_FAILED"
$workflowBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:.github/workflows/deploy.yml") "WORKFLOW_BLOB_FAILED"
$workflowContractBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-pr23-r21-workflow-contract.mjs") "WORKFLOW_CONTRACT_BLOB_FAILED"
$packageBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:package.json") "PACKAGE_BLOB_FAILED"
$networkPolicyBlob = Invoke-GitScalar @("rev-parse", "${productCommit}:scripts/rc6-2-closed-agent-network-policy.mjs") "NETWORK_POLICY_BLOB_FAILED"
$identityBeforeDigest = Sha256Text ($identityBefore | ConvertTo-Json -Compress -Depth 5)
$identityAfterDigest = Sha256Text ($identityAfter | ConvertTo-Json -Compress -Depth 5)
if ($identityBeforeDigest -ne $identityAfterDigest) { Fail "IDENTITY_DIGEST_CHANGED_DURING_GATE" }
$serviceBeforeDigest = Sha256Text ([pscustomobject][ordered]@{
  bridge = [pscustomobject][ordered]@{
    pid = $bridgeBefore.Pid
    commandDigest = Sha256Text $bridgeBefore.CommandLine
    creationDate = $bridgeBefore.CreationDate
    active = $healthBefore.BridgeActive
    queued = $healthBefore.BridgeQueued
  }
  hub = [pscustomobject][ordered]@{
    pid = $hubBefore.Pid
    commandDigest = Sha256Text $hubBefore.CommandLine
    creationDate = $hubBefore.CreationDate
    active = $healthBefore.HubActive
    queued = $healthBefore.HubQueued
  }
  ollama = [pscustomobject][ordered]@{
    pid = $ollamaBefore.Pid
    commandDigest = Sha256Text $ollamaBefore.CommandLine
    creationDate = $ollamaBefore.CreationDate
    version = $ollamaBefore.Version
    runningModelCount = $ollamaBefore.RunningModelCount
    modelId = $ollamaBefore.ModelId
    modelDigest = $ollamaBefore.ModelDigest
  }
} | ConvertTo-Json -Compress -Depth 5)
$serviceAfterDigest = Sha256Text ([pscustomobject][ordered]@{
  bridge = [pscustomobject][ordered]@{
    pid = $bridgeAfter.Pid
    commandDigest = Sha256Text $bridgeAfter.CommandLine
    creationDate = $bridgeAfter.CreationDate
    active = $healthAfter.BridgeActive
    queued = $healthAfter.BridgeQueued
  }
  hub = [pscustomobject][ordered]@{
    pid = $hubAfter.Pid
    commandDigest = Sha256Text $hubAfter.CommandLine
    creationDate = $hubAfter.CreationDate
    active = $healthAfter.HubActive
    queued = $healthAfter.HubQueued
  }
  ollama = [pscustomobject][ordered]@{
    pid = $ollamaAfter.Pid
    commandDigest = Sha256Text $ollamaAfter.CommandLine
    creationDate = $ollamaAfter.CreationDate
    version = $ollamaAfter.Version
    runningModelCount = $ollamaAfter.RunningModelCount
    modelId = $ollamaAfter.ModelId
    modelDigest = $ollamaAfter.ModelDigest
  }
} | ConvertTo-Json -Compress -Depth 5)
if ($serviceBeforeDigest -ne $serviceAfterDigest) { Fail "SERVICE_DIGEST_CHANGED_DURING_GATE" }

try { Assert-ControlLineage; $postcheckStatuses.controlLineage = "pass" }
catch { $postcheckStatuses.controlLineage = "fail"; throw }
try { Assert-TrackedGateBlobs; $postcheckStatuses.trackedGateBlobs = "pass" }
catch { $postcheckStatuses.trackedGateBlobs = "fail"; throw }
try { Assert-ProductRuntimeBlobs; $postcheckStatuses.productRuntimeBlobs = "pass" }
catch { $postcheckStatuses.productRuntimeBlobs = "fail"; throw }
try {
  if (@(Invoke-Git @("status", "--porcelain=v1", "--untracked-files=all") "WORKTREE_STATUS_LINEARIZATION_FAILED").Count -ne 0) {
    Fail "WORKTREE_NOT_CLEAN_AT_LINEARIZATION"
  }
  $postcheckStatuses.worktree = "pass"
} catch { $postcheckStatuses.worktree = "fail"; throw }
try {
  [void](Assert-PersistedRuntimeReceipt "PRODUCTION_BROWSER_RUNTIME_RECEIPT_LINEARIZATION_FAILED")
  $postcheckStatuses.runtimeReceipt = "pass"
} catch { $postcheckStatuses.runtimeReceipt = "fail"; throw }

$evidenceBody = [pscustomobject][ordered]@{
  schemaVersion = "p24b-rc6.2-production-browser-gate-harness-v1"
  status = "PASS"
  productCommit = $productCommit
  productionRecoveryControl = $productionRecoveryControl
  initialBrowserGateControl = $initialBrowserGateControl
  c4BrowserGateControl = $c4BrowserGateControl
  c5BrowserGateControl = $c5BrowserGateControl
  browserGateControl = $ExpectedGateControlCommit
  deploymentId = $expectedDeployment
  primaryOrigin = $primaryOrigin
  mirrorOrigin = $mirrorOrigin
  immutableDeploymentOrigin = $deploymentOrigin
  releaseTag = $releaseTag
  releaseName = $releaseName
  releasePublishedAt = $releasePublishedAt
  releaseBodyDigest = Sha256Text $releaseBody
  releaseTagObject = $releaseTagObject
  releaseId = $releaseId
  lkgAuditRunId = $lkgAudit.AuditRunId
  lkgAuditArtifactId = $lkgAudit.AuditArtifactId
  lkgAuditArtifactDigest = $lkgAudit.AuditArtifactDigest
  lkgAuditControlProofDigest = $lkgAudit.AuditControlProofDigest
  lkgSelectionProofDigest = $lkgAudit.SelectionProofDigest
  lkgArtifactId = $lkgAudit.LkgArtifactId
  lkgArtifactDigest = $lkgAudit.LkgArtifactDigest
  lkgPublisherRunId = $lkgAudit.LkgPublisherRunId
  runnerBlob = $runnerBlob
  runnerContractBlob = $runnerContractBlob
  wrapperBlob = $wrapperBlob
  contractBlob = $contractBlob
  workflowBlob = $workflowBlob
  workflowContractBlob = $workflowContractBlob
  packageBlob = $packageBlob
  productNetworkPolicyBlob = $networkPolicyBlob
  runnerEvidenceDigest = Sha256Text ($runnerStdout.Trim())
  runnerEvidence = $runnerEvidence
  runnerEvidenceValidation = $runnerEvidenceValidation
  runtimeReceipt = $runtimeReceiptBefore
  runtimeReceiptStableAfterGate = $true
  releaseAttestation = $releaseAttestationBefore
  releaseAttestationStableAfterGate = $true
  runnerSchemaVersion = [string]$runnerEvidence.schemaVersion
  runnerProfileDisposed = [bool]$runnerEvidence.profileDisposed
  networkPolicy = [string]$runnerEvidence.crossOriginPolicy.policy
  prohibitedExternalAiRequestCount = [int]$runnerEvidence.prohibitedExternalAiRequestCount
  disallowedRequestCount = [int]$runnerEvidence.crossOriginPolicy.disallowedRequestCount
  disallowedMethodRequestCount = [int]$runnerEvidence.crossOriginPolicy.disallowedMethodRequestCount
  blockedNonToolbarResponseCount = [int]$runnerEvidence.crossOriginPolicy.blockedNonToolbarResponseCount
  blockedWebSocketAttemptCount = [int]$runnerEvidence.crossOriginPolicy.blockedWebSocketAttemptCount
  releaseIdentityBeforeDigest = $identityBeforeDigest
  releaseIdentityAfterDigest = $identityAfterDigest
  serviceTruthBeforeDigest = $serviceBeforeDigest
  serviceTruthAfterDigest = $serviceAfterDigest
  bridgePidUnchanged = $true
  hubPidUnchanged = $true
  ollamaPidUnchanged = $true
  serviceControlActionPerformed = $false
  observedServiceProcessHealthAndPinnedCodeStableAcrossGate = $true
  bridgeServerSha256 = $expectedBridgeServerSha256
  bridgeCoreSha256 = $expectedBridgeCoreSha256
  hubServerSha256 = $expectedHubServerSha256
  mainCasBeforeAndAfter = $true
  mainCasLinearization = "before-gate-and-immediately-before-atomic-evidence-publication"
  buildStartedAt = $identityAfter[0].BuildStartedAt
  buildCompletedAt = $identityAfter[0].BuildCompletedAt
  deployedAt = $identityAfter[0].DeployedAt
  gitSha256 = $expectedGitSha256
  nodeSha256 = $expectedNodeSha256
  edgeSha256 = $expectedEdgeSha256
  edgeEngineDllSha256 = $expectedEdgeDllSha256
  edgeVersionDirectorySha256 = $expectedEdgeDirectorySha256
  edgeVersion = $expectedEdgeVersion
  ghSha256 = $expectedGhSha256
  ownedProfilePathDigest = Sha256Text $ownedProfilePath
  ownedProfileDisposed = (-not (Test-Path -LiteralPath $ownedProfilePath))
  evidenceDestinationDigest = Sha256Text $evidencePath
  completedAt = [DateTime]::UtcNow.ToString("o")
}
$evidenceJson = $evidenceBody | ConvertTo-Json -Compress -Depth 100
$proofDomain = "p24b-rc6.2-production-browser-gate-harness-v1"
$outerEvidence = [pscustomobject][ordered]@{
  schemaVersion = "p24b-rc6.2-production-browser-gate-proof-v1"
  canonicalization = "powershell-ordered-json-utf8-no-bom-v1"
  sanitized = $true
  rawSecretsStored = $false
  bodyDigest = Sha256Text $evidenceJson
  body = $evidenceBody
  proofDigest = Sha256Text "$proofDomain`n$evidenceJson"
}
$outerEvidenceJson = $outerEvidence | ConvertTo-Json -Compress -Depth 100
$evidenceTempPath = Join-Path $evidenceDirectory "production-browser-gate-$ExpectedGateControlCommit-$([Guid]::NewGuid().ToString('N')).tmp"
$runnerStage = "pass-publication"
try {
  if (Test-Path -LiteralPath $evidenceTempPath) { Fail "EVIDENCE_TEMP_PATH_PREEXISTED" }
  Write-CreateNewFlushedFile $evidenceTempPath $outerEvidenceJson "EVIDENCE_TEMP_CREATE_FAILED"
  $tempTruth = Get-Item -LiteralPath $evidenceTempPath -Force
  if (($tempTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Fail "EVIDENCE_TEMP_PATH_INVALID" }
  $expectedEvidenceBytes = [Text.UTF8Encoding]::new($false).GetBytes($outerEvidenceJson)
  $tempEvidenceBytes = [IO.File]::ReadAllBytes($evidenceTempPath)
  if ($tempEvidenceBytes.Length -ne $expectedEvidenceBytes.Length) { Fail "EVIDENCE_TEMP_READBACK_MISMATCH" }
  for ($index = 0; $index -lt $expectedEvidenceBytes.Length; $index += 1) {
    if ($tempEvidenceBytes[$index] -ne $expectedEvidenceBytes[$index]) { Fail "EVIDENCE_TEMP_READBACK_MISMATCH" }
  }
  Assert-MainCas "MAIN_CAS_AFTER_GATE_FAILED"
  if (
    (Test-Path -LiteralPath $evidencePath) -or
    (Test-Path -LiteralPath $failureEvidencePath)
  ) { Fail "EVIDENCE_DESTINATION_RACE" }
  Close-FormalPostLaunchAttempt $true "" -Terminalize
  try {
    [IO.File]::Move($evidenceTempPath, $evidencePath)
    $evidenceTempPath = $null
  } catch {
    # The validated terminal manifest is the formal PASS commit; this C6-compatible projection is best-effort.
  }
} finally {
  if ($evidenceTempPath -and (Test-Path -LiteralPath $evidenceTempPath)) {
    try { Remove-Item -LiteralPath $evidenceTempPath -Force } catch { }
  }
}
$outerEvidenceJson
} catch {
  $terminalError = $_
  if ($formalGateBoundaryEntered) {
    $runnerCapture = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-gate-c6-runner-capture-v1"
      stage = $runnerStage
      runnerStarted = [bool]$runnerStarted
      exitCode = $runnerExitCode
      elapsedMs = [long]$runnerElapsedMs
      stdoutUtf8ByteLength = [long]$runnerStdoutUtf8ByteLength
      stderrUtf8ByteLength = [long]$runnerStderrUtf8ByteLength
      heartbeatCounts = $runnerProgressCounts
      evidenceDisposition = if ($runnerFailureProjectionValidated) {
        "validated-runner-failure"
      } else {
        "wrapper-fallback"
      }
    }
    if ($runnerFailureProjectionValidated) {
      $runnerCapture | Add-Member -NotePropertyName safeProjectionDigest -NotePropertyValue $runnerFailureProjectionDigest
      $runnerCapture | Add-Member -NotePropertyName safeFailureProjection -NotePropertyValue (
        $runnerFailureProjection
      )
    }
    if (-not $formalTerminalFinalized) {
      try {
        $terminalWrapperCode = Get-TerminalWrapperCode $runnerStage $postErrors.Count
        [void](Publish-C6FailureEvidence $runnerCapture $postcheckStatuses $terminalWrapperCode)
      } catch {
        throw "FAILURE_EVIDENCE_PUBLICATION_FAILED"
      }
    }
  }
  throw $terminalError
} finally {
  if ($formalAttemptPrepared -and $formalTerminalFinalizationAttempted -and -not $formalTerminalFinalized) {
    Publish-FormalTerminalEmergency "FORMAL_TERMINAL_FINALIZATION_FAILED"
    $formalTerminalError = "FORMAL_TERMINAL_FINALIZATION_FAILED"
  }
  if ($formalAttemptPrepared -and -not $formalTerminalFinalizationAttempted) {
    try {
      $summary = Get-VerifiedFormalAttempt "FORMAL_TERMINAL_STATE_VERIFY_FAILED"
      if ([string]$summary.state -eq "PREFLIGHT_PASSED") {
        if ($ownedProfilePath -and (Test-Path -LiteralPath $ownedProfilePath)) {
          try {
            Stop-OwnedProfileProcesses $ownedProfilePath "OWNED_PROFILE_PROCESS_CLEANUP_FAILED"
            Remove-OwnedProfile $ownedProfilePath "OWNED_PROFILE_CLEANUP_FAILED"
          } catch {
            [void]$postErrors.Add("OWNED_PROFILE_CLEANUP_FAILED")
          }
        }
        $reason = Get-TerminalWrapperCode $runnerStage $postErrors.Count
        $summary = Invoke-FormalAttemptTransition "PREFLIGHT_FAILED" ([ordered]@{
          reasonCode = $reason
        }) "PREFLIGHT_PASSED" "PRECHECK_FAILED" "FORMAL_PRELAUNCH_FAILURE_STATE_FAILED"
        Invoke-FormalTerminalEvidence "FAIL" $reason $null $null $null
      } elseif ([string]$summary.state -notin @(
        "PRECHECK_FAILED", "TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"
      )) {
        if ($null -eq $formalProfileCleanupProjection -or $null -eq $formalProcessCleanupProjection) {
          $runnerResidueCount = if (
            $runnerStarted -and $null -ne $runnerProcess -and -not $runnerProcess.HasExited
          ) { 1 } else { 0 }
          $edgeResidueCount = if ($ownedProfilePath) {
            @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
              ([string]$_.CommandLine).IndexOf(
                $ownedProfilePath,
                [StringComparison]::OrdinalIgnoreCase
              ) -ge 0
            }).Count
          } else { 0 }
          $profileDisposed = [bool]($ownedProfilePath -and -not (Test-Path -LiteralPath $ownedProfilePath))
          $fallbackCleanupStatus = if (
            $profileDisposed -and $runnerResidueCount -eq 0 -and $edgeResidueCount -eq 0
          ) { "PASS" } else { "FAIL" }
          $formalProfileCleanupProjection = [pscustomobject][ordered]@{
            schemaVersion = "p24b-rc6.2-formal-profile-cleanup-v1"
            attemptId = $formalAttemptId
            status = $fallbackCleanupStatus
            profileDisposed = $profileDisposed
            edgeResidueCount = [int]$edgeResidueCount
          }
          $formalProcessCleanupProjection = [pscustomobject][ordered]@{
            schemaVersion = "p24b-rc6.2-formal-process-cleanup-v1"
            attemptId = $formalAttemptId
            status = $fallbackCleanupStatus
            runnerResidueCount = [int]$runnerResidueCount
            edgeResidueCount = [int]$edgeResidueCount
          }
          $cleanupPassed = $fallbackCleanupStatus -eq "PASS"
        }
        Close-FormalPostLaunchAttempt $false (Get-TerminalWrapperCode $runnerStage $postErrors.Count) -Terminalize
      } else {
        Fail "FORMAL_ATTEMPT_TERMINAL_WITHOUT_EVIDENCE"
      }
    } catch {
      $formalTerminalError = $_
      Publish-FormalTerminalEmergency "FORMAL_TERMINAL_FINALIZATION_FAILED"
    }
  }
  if ($mutexHeld -and $null -ne $mutex) {
    try { $mutex.ReleaseMutex() } catch {
      if (-not $formalTerminalFinalized) { throw }
    }
  }
  if ($null -ne $mutex) {
    try { $mutex.Dispose() } catch {
      if (-not $formalTerminalFinalized) { throw }
    }
  }
  if ($null -ne $formalTerminalError) { throw "FORMAL_TERMINAL_FINALIZATION_FAILED" }
}
