[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$ReaderPath
)

$ErrorActionPreference = "Stop"
. $ReaderPath
$value = Read-EvidenceJson -Path $InputPath
Write-EvidenceJson -Path $OutputPath -Value $value -Depth 24
