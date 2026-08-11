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
  [string]$ExpectedLkgSelectionProofDigest
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

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location -LiteralPath $repoRoot
$gitExe = "C:\Program Files\Git\cmd\git.exe"
$ghExe = "C:\Program Files\GitHub CLI\gh.exe"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$edgeExe = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$canonicalRepositoryUrl = "https://github.com/bobobo-org/novel.git"
$githubApiRoot = "https://api.github.com/repos/bobobo-org/novel"
$expectedGitSha256 = "22fead8244ef3a7225fb800099a4e43eca8bcec0466774917669599c2f19a05a"
$expectedGhSha256 = "cd79f16203f1fbe56937c4c96e2b6eadd10549418dcb241d91576ac77af0ac8b"
$expectedNodeSha256 = "9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de"
$expectedEdgeSha256 = "e73e04dacdb48557c13d9f93f90a248f3e5a0bf55bb738f2fc548a768a9a10af"
$expectedEdgeDllSha256 = "340669f76761a7844f6efa26ee58781a68ae43d5f54dbe158545528b8507137a"
$expectedEdgeDirectorySha256 = "7148bc3bddf499f24f003ed47741301ee10792f709fb7966876ebcbdfb0b0974"
$expectedEdgeVersion = "151.0.4129.72"
$edgeVersionRoot = "C:\Program Files (x86)\Microsoft\Edge\Application\151.0.4129.72"
$edgeDll = Join-Path $edgeVersionRoot "msedge.dll"
$productCommit = "29fc6e742672bb07187765d34ea818afdadf56ae"
$productionRecoveryControl = "9cd074f239b73dd9b61f6d758fcf97fbd809face"
$failedRecoveryControl = "3b716fc0d974a9d59b49ffca5953776af66c7a07"
$initialBrowserGateControl = "aab0e7bd52c57bc57ecfe8be8b08c1cf63db9824"
$previousBrowserGateControl = "100eea11003c5132ab2b519707c5dee658bc9cbe"
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
$runnerPath = Join-Path $repoRoot "scripts\run-rc6-2-closed-agent-browser.mjs"
$wrapperPath = Join-Path $repoRoot "scripts\run-rc6-2-production-browser-gate.ps1"
$contractPath = Join-Path $repoRoot "scripts\run-rc6-2-production-browser-gate-contract.mjs"
$allowedGatePaths = @(
  ".github/workflows/deploy.yml",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1"
)
$repairGatePaths = @(
  ".github/workflows/deploy.yml",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1"
)
$productRuntimePaths = @(
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
  if ($Mode -notmatch '^[a-z][a-z-]{0,63}$') { Fail $Code }
  $standardInputBytes = $null
  if ($null -ne $StandardInput) {
    if (
      $StandardInput.IndexOf([char]0) -ge 0 -or
      $StandardInput.IndexOf([char]0xFFFD) -ge 0 -or
      $StandardInput.StartsWith([string][char]0xFEFF)
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
    if ($process.ExitCode -ne 0 -or $stdout.Length -gt 1048576 -or $stderr.Length -gt 65536 -or $stderr.Trim().Length -ne 0) {
      Fail $Code
    }
    return $stdout.Trim()
  } finally {
    if ($processStarted -and -not $process.HasExited) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
      [void]$process.WaitForExit(30000)
    }
    $process.Dispose()
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
  $previousParents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $previousBrowserGateControl) "PREVIOUS_GATE_PARENT_READ_FAILED") -split "\s+"
  $initialParents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $initialBrowserGateControl) "INITIAL_GATE_PARENT_READ_FAILED") -split "\s+"
  $recoveryParents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $productionRecoveryControl) "RECOVERY_PARENT_READ_FAILED") -split "\s+"
  $failedParents = (Invoke-GitScalar @("rev-list", "--parents", "-n", "1", $failedRecoveryControl) "FAILED_CONTROL_PARENT_READ_FAILED") -split "\s+"
  if ($headParents.Count -ne 2 -or $headParents[0] -ne $head -or $headParents[1] -ne $previousBrowserGateControl) {
    Fail "GATE_CONTROL_PARENT_MISMATCH"
  }
  if ($previousParents.Count -ne 2 -or $previousParents[0] -ne $previousBrowserGateControl -or $previousParents[1] -ne $initialBrowserGateControl) {
    Fail "PREVIOUS_GATE_CONTROL_PARENT_MISMATCH"
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
  Assert-ControlDiffPaths -BaseCommit $previousBrowserGateControl -HeadCommit $head -ExpectedPaths $repairGatePaths -Code "GATE_REPAIR_DIFF_INVALID"
  Assert-ControlDiffPaths -BaseCommit $initialBrowserGateControl -HeadCommit $previousBrowserGateControl -ExpectedPaths $repairGatePaths -Code "PREVIOUS_GATE_REPAIR_DIFF_INVALID"
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

function Get-ServiceHealth {
  $bridge = Invoke-RestMethod -Uri "http://127.0.0.1:3217/health" -TimeoutSec 15 -Headers @{
    Origin = "http://localhost:3000"
    "X-Bridge-Protocol" = "novel-local-bridge/v1"
  }
  $hub = Invoke-RestMethod -Uri "http://127.0.0.1:3227/health" -TimeoutSec 15 -Headers @{
    Origin = "http://localhost:3000"
    "X-Private-Hub-Protocol" = "novel-private-hub/v1"
  }
  if (
    $bridge.bridgeProcessAlive -ne $true -or
    $bridge.protocolVersion -ne "novel-local-bridge/v1" -or
    $bridge.bindAddress -ne "127.0.0.1" -or
    $bridge.modelAvailable -ne $true -or
    [int]$bridge.workload.active -ne 0 -or
    [int]$bridge.workload.queued -ne 0
  ) { Fail "BRIDGE_HEALTH_INVALID" }
  if (
    $hub.hubProcessAlive -ne $true -or
    $hub.protocolVersion -ne "novel-private-hub/v1" -or
    $hub.bindAddress -ne "127.0.0.1" -or
    $hub.modelAvailable -ne $true -or
    [int]$hub.workload.active -ne 0 -or
    [int]$hub.workload.queued -ne 0
  ) { Fail "HUB_HEALTH_INVALID" }
  return [pscustomobject]@{
    BridgeActive = [int]$bridge.workload.active
    BridgeQueued = [int]$bridge.workload.queued
    HubActive = [int]$hub.workload.active
    HubQueued = [int]$hub.workload.queued
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
  if (-not [string]$version.version -or @($running.models).Count -ne 0) { Fail "OLLAMA_RUNTIME_NOT_IDLE" }
  return [pscustomobject]@{
    Pid = [int]$listeners[0].OwningProcess
    CommandLine = [string]$process.CommandLine
    CreationDate = [string]$process.CreationDate
    Version = [string]$version.version
    RunningModelCount = @($running.models).Count
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
  if ($PostcheckErrorCount -gt 0) { return "PRODUCTION_BROWSER_POSTCHECK_FAILED" }
  switch ($Stage) {
    "runner-start" { return "PRODUCTION_BROWSER_RUNNER_START_FAILED" }
    "runner-timeout" { return "PRODUCTION_BROWSER_RUNNER_TIMEOUT" }
    "runner-output-too-large" { return "PRODUCTION_BROWSER_RUNNER_OUTPUT_TOO_LARGE" }
    "runner-failed" { return "PRODUCTION_BROWSER_RUNNER_FAILED" }
    "runner-evidence-validation" { return "PRODUCTION_BROWSER_EVIDENCE_VALIDATION_FAILED" }
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

function Publish-C5FailureEvidence(
  [pscustomobject]$RunnerCapture,
  [Collections.Specialized.OrderedDictionary]$Postchecks,
  [string]$TerminalWrapperCode
) {
  $casStatus = Get-MainCasStatus
  for ($attempt = 0; $attempt -lt 3; $attempt += 1) {
    $Postchecks.remoteMainCas = $casStatus
    $body = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-gate-c5-failure-v1"
      status = "FAIL"
      qualifiesProductionBrowserGate = $false
      eligibleForLuna = $false
      productCommit = $productCommit
      failedRecoveryControl = $failedRecoveryControl
      productionRecoveryControl = $productionRecoveryControl
      initialBrowserGateControl = $initialBrowserGateControl
      previousBrowserGateControl = $previousBrowserGateControl
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
    $proofDomain = "p24b-rc6.2-production-browser-gate-c5-failure-v1"
    $outer = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-gate-c5-failure-proof-v1"
      canonicalization = "powershell-ordered-json-utf8-no-bom-v1"
      sanitized = $true
      rawSecretsStored = $false
      bodyDigest = Sha256Text $bodyJson
      body = $body
      proofDigest = Sha256Text "$proofDomain`n$bodyJson"
    }
    $outerJson = $outer | ConvertTo-Json -Compress -Depth 100
    $tempPath = Join-Path $evidenceDirectory (
      "production-browser-gate-c5-failure-$ExpectedGateControlCommit-$([Guid]::NewGuid().ToString('N')).tmp"
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
  $destination = [IO.Path]::GetFullPath((Join-Path $directory "production-browser-gate-$ExpectedGateControlCommit.json"))
  $failureDestination = [IO.Path]::GetFullPath((
    Join-Path $directory "production-browser-gate-c5-failure-$ExpectedGateControlCommit.json"
  ))
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($destination), $directory)) {
    Fail "EVIDENCE_DESTINATION_INVALID"
  }
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName($failureDestination), $directory)) {
    Fail "FAILURE_EVIDENCE_DESTINATION_INVALID"
  }
  if (
    (Test-Path -LiteralPath $destination) -or
    (Test-Path -LiteralPath $failureDestination)
  ) { Fail "EVIDENCE_DESTINATION_ALREADY_EXISTS" }
  return [pscustomobject]@{
    Directory = $directory
    Path = $destination
    FailurePath = $failureDestination
  }
}

foreach ($requiredPath in @($gitExe, $ghExe, $nodeExe, $edgeExe, $edgeDll, $runnerPath, $wrapperPath, $contractPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { Fail "GATE_REQUIRED_FILE_MISSING" }
}
$evidenceDestination = Initialize-EvidenceDestination
$evidenceDirectory = [string]$evidenceDestination.Directory
$evidencePath = [string]$evidenceDestination.Path
$failureEvidencePath = [string]$evidenceDestination.FailurePath
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
Assert-MainCas "MAIN_CAS_BEFORE_GATE_FAILED"
Assert-ReleaseTag
$releaseAttestationBefore = Invoke-ReleaseAttestationVerification "RELEASE_ATTESTATION_BEFORE_INVALID"
$lkgAudit = Assert-LkgAudit
Assert-NoGateResidue "GATE_RESIDUE_BEFORE_RUN"
$runtimeReceiptBeforeText = Invoke-CleanNodeContract "runtime-receipt" @{} "PRODUCTION_BROWSER_RUNTIME_RECEIPT_BEFORE_FAILED"
$runtimeReceiptBefore = $runtimeReceiptBeforeText | ConvertFrom-Json
if (
  $runtimeReceiptBefore.schemaVersion -ne "p24b-rc6.2-production-browser-runtime-receipt-v1" -or
  [string]$runtimeReceiptBefore.edge.version -ne $expectedEdgeVersion -or
  [string]$runtimeReceiptBefore.edge.executableDigest -ne $expectedEdgeSha256 -or
  [string]$runtimeReceiptBefore.edge.engineDllDigest -ne $expectedEdgeDllSha256 -or
  [string]$runtimeReceiptBefore.edge.versionDirectoryDigest -ne $expectedEdgeDirectorySha256 -or
  [string]$runtimeReceiptBefore.proofDigest -notmatch '^[a-f0-9]{64}$'
) { Fail "PRODUCTION_BROWSER_RUNTIME_RECEIPT_BEFORE_INVALID" }

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

$formalGateBoundaryEntered = $false
$mutex = $null
$mutexHeld = $false
$runnerProcess = $null
$runnerStarted = $false
$runnerEvidence = $null
$runnerStdout = ""
$runnerStderr = ""
$runnerExitCode = $null
$runnerElapsedMs = 0
$runnerStdoutUtf8ByteLength = 0
$runnerStderrUtf8ByteLength = 0
$runnerProgressCounts = Get-RunnerProgressCounts ""
$runnerStage = "boundary-entered"
$runnerStopwatch = [Diagnostics.Stopwatch]::new()
$runnerFailureProjection = $null
$runnerFailureProjectionValidated = $false
$runnerFailureProjectionDigest = $null
$runnerEvidenceValidation = $null
$ownedProfilePath = $null
$evidenceValidationPath = $null
$primaryError = $null
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
  $startInfo.EnvironmentVariables["NO_COLOR"] = "1"

  $runnerProcess = [Diagnostics.Process]::new()
  $runnerProcess.StartInfo = $startInfo
  $runnerStage = "runner-start"
  $runnerStopwatch.Start()
  if (-not $runnerProcess.Start()) { Fail "PRODUCTION_BROWSER_RUNNER_START_FAILED" }
  $runnerStarted = $true
  $runnerStage = "runner-running"
  $stdoutTask = $runnerProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $runnerProcess.StandardError.ReadToEndAsync()
  if (-not $runnerProcess.WaitForExit(10800000)) {
    $runnerStage = "runner-timeout"
    try { Stop-RunnerTree $runnerProcess "PRODUCTION_BROWSER_RUNNER_TIMEOUT_CLEANUP_FAILED" }
    catch { [void]$postErrors.Add("PRODUCTION_BROWSER_RUNNER_TIMEOUT_CLEANUP_FAILED") }
    [void]$runnerProcess.WaitForExit(30000)
    if ($stdoutTask.IsCompleted) { $runnerStdout = [string]$stdoutTask.Result }
    if ($stderrTask.IsCompleted) { $runnerStderr = [string]$stderrTask.Result }
    Fail "PRODUCTION_BROWSER_RUNNER_TIMEOUT"
  }
  $runnerProcess.WaitForExit()
  $runnerStdout = [string]$stdoutTask.Result
  $runnerStderr = [string]$stderrTask.Result
  $runnerExitCode = [int]$runnerProcess.ExitCode
  $runnerStopwatch.Stop()
  $runnerElapsedMs = [long]$runnerStopwatch.ElapsedMilliseconds
  $runnerStdoutUtf8ByteLength = [Text.Encoding]::UTF8.GetByteCount($runnerStdout)
  $runnerStderrUtf8ByteLength = [Text.Encoding]::UTF8.GetByteCount($runnerStderr)
  $runnerProgressCounts = Get-RunnerProgressCounts $runnerStderr
  if ($runnerStdoutUtf8ByteLength -gt 1048576 -or $runnerStderrUtf8ByteLength -gt 1048576) {
    $runnerStage = "runner-output-too-large"
    Fail "PRODUCTION_BROWSER_RUNNER_OUTPUT_TOO_LARGE"
  }
  $unexpectedStderr = @($runnerStderr -split "\r?\n" | Where-Object {
    $_ -and $_ -notmatch "^\[RC6\.2 Closed AI\] (?:setup|candidate generation|T1 analysis) in progress \([0-9]+s\)$"
  })
  if ($runnerExitCode -ne 0 -or $unexpectedStderr.Count -ne 0) {
    $runnerStage = "runner-failed"
    if ($runnerStdout.Length -eq 0) {
      try {
        $runnerFailureValidationText = Invoke-CleanNodeContract "validate-failure-evidence" @{} "PRODUCTION_BROWSER_FAILURE_EVIDENCE_VALIDATION_FAILED" $runnerStderr
        $runnerFailureValidation = $runnerFailureValidationText | ConvertFrom-Json
        if (
          [string]$runnerFailureValidation.status -ne "PASS" -or
          [string]$runnerFailureValidation.projectionDigest -notmatch '^[a-f0-9]{64}$' -or
          [string]$runnerFailureValidation.projection.schemaVersion -ne "p24b-rc6.2-validated-runner-failure-projection-v1"
        ) { Fail "PRODUCTION_BROWSER_FAILURE_EVIDENCE_VALIDATION_FAILED" }
        $runnerFailureProjection = $runnerFailureValidation.projection
        $runnerFailureProjectionValidated = $true
        $runnerFailureProjectionDigest = [string]$runnerFailureValidation.projectionDigest
      } catch {
        $runnerFailureProjection = $null
        $runnerFailureProjectionValidated = $false
        $runnerFailureProjectionDigest = $null
      }
    }
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
    if ((Get-Variable -Name stdoutTask -ErrorAction SilentlyContinue) -and $stdoutTask.IsCompleted) {
      $runnerStdout = [string]$stdoutTask.Result
    }
    if ((Get-Variable -Name stderrTask -ErrorAction SilentlyContinue) -and $stderrTask.IsCompleted) {
      $runnerStderr = [string]$stderrTask.Result
    }
  }
  $runnerStdoutUtf8ByteLength = [Text.Encoding]::UTF8.GetByteCount($runnerStdout)
  $runnerStderrUtf8ByteLength = [Text.Encoding]::UTF8.GetByteCount($runnerStderr)
  $runnerProgressCounts = Get-RunnerProgressCounts $runnerStderr
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
    $runtimeReceiptAfterText = Invoke-CleanNodeContract "runtime-receipt" @{} "PRODUCTION_BROWSER_RUNTIME_RECEIPT_AFTER_FAILED"
    if ($runtimeReceiptAfterText -ne $runtimeReceiptBeforeText) { Fail "PRODUCTION_BROWSER_RUNTIME_RECEIPT_CHANGED" }
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
}

if ($postErrors.Count -ne 0) {
  $runnerStage = "postchecks"
  Fail "PRODUCTION_BROWSER_POSTCHECK_FAILED:$([string]::Join(',', $postErrors))"
}
if ($null -ne $primaryError) { throw $primaryError }

$runnerStage = "gate-linearization"
$runnerBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-rc6-2-closed-agent-browser.mjs") "RUNNER_BLOB_FAILED"
$runnerContractBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-rc6-2-closed-agent-runtime.mjs") "RUNNER_CONTRACT_BLOB_FAILED"
$wrapperBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-rc6-2-production-browser-gate.ps1") "WRAPPER_BLOB_FAILED"
$contractBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-rc6-2-production-browser-gate-contract.mjs") "CONTRACT_BLOB_FAILED"
$workflowBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:.github/workflows/deploy.yml") "WORKFLOW_BLOB_FAILED"
$workflowContractBlob = Invoke-GitScalar @("rev-parse", "${ExpectedGateControlCommit}:scripts/run-pr23-r21-workflow-contract.mjs") "WORKFLOW_CONTRACT_BLOB_FAILED"
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
  $runtimeReceiptLinearizationText = Invoke-CleanNodeContract "runtime-receipt" @{} "PRODUCTION_BROWSER_RUNTIME_RECEIPT_LINEARIZATION_FAILED"
  if ($runtimeReceiptLinearizationText -ne $runtimeReceiptBeforeText) {
    Fail "PRODUCTION_BROWSER_RUNTIME_RECEIPT_LINEARIZATION_CHANGED"
  }
  $postcheckStatuses.runtimeReceipt = "pass"
} catch { $postcheckStatuses.runtimeReceipt = "fail"; throw }

$evidenceBody = [pscustomobject][ordered]@{
  schemaVersion = "p24b-rc6.2-production-browser-gate-harness-v1"
  status = "PASS"
  productCommit = $productCommit
  productionRecoveryControl = $productionRecoveryControl
  initialBrowserGateControl = $initialBrowserGateControl
  previousBrowserGateControl = $previousBrowserGateControl
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
  [IO.File]::WriteAllText($evidenceTempPath, $outerEvidenceJson, [Text.UTF8Encoding]::new($false))
  $tempTruth = Get-Item -LiteralPath $evidenceTempPath -Force
  if (($tempTruth.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Fail "EVIDENCE_TEMP_PATH_INVALID" }
  Assert-MainCas "MAIN_CAS_AFTER_GATE_FAILED"
  if (
    (Test-Path -LiteralPath $evidencePath) -or
    (Test-Path -LiteralPath $failureEvidencePath)
  ) { Fail "EVIDENCE_DESTINATION_RACE" }
  [IO.File]::Move($evidenceTempPath, $evidencePath)
  $evidenceTempPath = $null
} finally {
  if ($evidenceTempPath -and (Test-Path -LiteralPath $evidenceTempPath)) {
    Remove-Item -LiteralPath $evidenceTempPath -Force
  }
}
if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) { Fail "EVIDENCE_PUBLICATION_FAILED" }
$publishedEvidence = [IO.File]::ReadAllText($evidencePath, [Text.Encoding]::UTF8)
if ($publishedEvidence -ne $outerEvidenceJson) { Fail "EVIDENCE_PUBLICATION_MISMATCH" }
$outerEvidenceJson
} catch {
  $terminalError = $_
  if ($formalGateBoundaryEntered) {
    $runnerCapture = [pscustomobject][ordered]@{
      schemaVersion = "p24b-rc6.2-production-browser-gate-c5-runner-capture-v1"
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
    try {
      $terminalWrapperCode = Get-TerminalWrapperCode $runnerStage $postErrors.Count
      [void](Publish-C5FailureEvidence $runnerCapture $postcheckStatuses $terminalWrapperCode)
    } catch {
      throw "FAILURE_EVIDENCE_PUBLICATION_FAILED"
    }
  }
  throw $terminalError
} finally {
  if ($mutexHeld -and $null -ne $mutex) { $mutex.ReleaseMutex() }
  if ($null -ne $mutex) { $mutex.Dispose() }
}
