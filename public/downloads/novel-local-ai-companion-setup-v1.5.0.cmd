@echo off
chcp 65001 >nul
title Novel Local AI Companion Installer
echo This installer downloads two checksum-pinned files from novel-orcin.vercel.app.
echo Windows may ask before installing Node.js or Ollama for the current user.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $d=Join-Path $env:TEMP ('NovelLocalAICompanion-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $d -Force ^| Out-Null; try { $s=Join-Path $d 'install.ps1'; $z=Join-Path $d 'companion.zip'; Invoke-WebRequest -UseBasicParsing -Uri 'https://novel-orcin.vercel.app/downloads/novel-local-ai-companion-install-v1.5.0.ps1' -OutFile $s; Invoke-WebRequest -UseBasicParsing -Uri 'https://novel-orcin.vercel.app/downloads/novel-local-ai-companion-v1.5.0.zip' -OutFile $z; if((Get-FileHash -LiteralPath $s -Algorithm SHA256).Hash -ne '3FC1830126A97A255DBE0F6E9AD46B16008C8754BFCC89B650498AC59331AE43'){throw 'INSTALL_SCRIPT_DIGEST_MISMATCH'}; if((Get-FileHash -LiteralPath $z -Algorithm SHA256).Hash -ne '9F3F8A50F8862CEE61B7219474C2448358A3FB2F967FA143551207B3C917FB7E'){throw 'COMPANION_ARCHIVE_DIGEST_MISMATCH'}; ^& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $s -ArchivePath $z; exit $LASTEXITCODE } finally { if(Test-Path -LiteralPath $d){Remove-Item -LiteralPath $d -Recurse -Force} }"
set "NOVEL_INSTALL_EXIT=%ERRORLEVEL%"
if not "%NOVEL_INSTALL_EXIT%"=="0" (
  echo.
  echo Installation did not complete. Keep the error above and retry.
  pause
)
exit /b %NOVEL_INSTALL_EXIT%