@echo off
chcp 65001 >nul
title Novel Local AI Companion Installer
echo This installer downloads two checksum-pinned files from novel-orcin.vercel.app.
echo Windows may ask before installing Node.js or Ollama for the current user.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $d=Join-Path $env:TEMP ('NovelLocalAICompanion-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $d -Force ^| Out-Null; try { $s=Join-Path $d 'install.ps1'; $z=Join-Path $d 'companion.zip'; Invoke-WebRequest -UseBasicParsing -Uri 'https://novel-orcin.vercel.app/downloads/novel-local-ai-companion-install-v1.4.7.ps1' -OutFile $s; Invoke-WebRequest -UseBasicParsing -Uri 'https://novel-orcin.vercel.app/downloads/novel-local-ai-companion-v1.4.7.zip' -OutFile $z; if((Get-FileHash -LiteralPath $s -Algorithm SHA256).Hash -ne 'BFE21B68D2316002B6CFF10960E2B49B7AC3B8C3F9C6534A33C9DBAD44C97011'){throw 'INSTALL_SCRIPT_DIGEST_MISMATCH'}; if((Get-FileHash -LiteralPath $z -Algorithm SHA256).Hash -ne '9B1245EA7D68957A007D5703D63B673D7EE5C1872A1C1A9BE83AC0E001265D8F'){throw 'COMPANION_ARCHIVE_DIGEST_MISMATCH'}; ^& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $s -ArchivePath $z; exit $LASTEXITCODE } finally { if(Test-Path -LiteralPath $d){Remove-Item -LiteralPath $d -Recurse -Force} }"
set "NOVEL_INSTALL_EXIT=%ERRORLEVEL%"
if not "%NOVEL_INSTALL_EXIT%"=="0" (
  echo.
  echo Installation did not complete. Keep the error above and retry.
  pause
)
exit /b %NOVEL_INSTALL_EXIT%