$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$scripts = @(
  "scripts\run-r5-2-desktop-e2e.ps1",
  "scripts\run-r5-2r1a-real-browser.ps1",
  "scripts\r5-2-desktop\collect-browser-evidence.ps1",
  "scripts\r5-2-desktop\evidence-json.ps1",
  "scripts\r5-2-desktop\start-real-browser.ps1",
  "scripts\r5-2-desktop\stop-real-browser.ps1"
)

$results = foreach ($relativePath in $scripts) {
  $scriptPath = Resolve-Path (Join-Path $root $relativePath)
  $tokens = $null
  $errors = $null

  $ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $scriptPath,
    [ref]$tokens,
    [ref]$errors
  )

  $parameterNames = @()
  if ($ast.ParamBlock) {
    $parameterNames = @($ast.ParamBlock.Parameters | ForEach-Object {
      $_.Name.VariablePath.UserPath.ToLowerInvariant()
    })
  }
  $loopNames = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.ForEachStatementAst]
  }, $true) | ForEach-Object {
    $_.Variable.VariablePath.UserPath.ToLowerInvariant()
  })
  $variableCollisions = @($parameterNames | Where-Object {
    $loopNames -contains $_
  } | Sort-Object -Unique)

  [pscustomobject]@{
    path = $relativePath.Replace("\", "/")
    parserErrors = @($errors).Count
    parameterLoopVariableCollisions = @($variableCollisions)
    errors = @($errors | ForEach-Object {
      [pscustomobject]@{
        message = $_.Message
        line = $_.Extent.StartLineNumber
        column = $_.Extent.StartColumnNumber
        text = $_.Extent.Text
      }
    })
  }
}

$results | Format-Table path, parserErrors, @{ Label = "variableCollisions"; Expression = { $_.parameterLoopVariableCollisions.Count } } -AutoSize
$failures = @($results | Where-Object {
  $_.parserErrors -gt 0 -or $_.parameterLoopVariableCollisions.Count -gt 0
})
if ($failures.Count -gt 0) {
  $failures | ConvertTo-Json -Depth 8
  throw "PowerShell parser validation failed."
}

Write-Host "R1K_POWERSHELL_PARSER_PASS scripts=$($results.Count) errors=0"
