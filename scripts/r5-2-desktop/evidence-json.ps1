function Read-EvidenceJson {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false, $true)
  $json = [System.IO.File]::ReadAllText($Path, $utf8NoBom)
  return $json | ConvertFrom-Json -ErrorAction Stop
}

function Write-EvidenceJson {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowNull()][object]$Value,
    [int]$Depth = 16
  )

  $directory = Split-Path -Parent $Path
  if ($directory) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  $json = $Value | ConvertTo-Json -Depth $Depth
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}
