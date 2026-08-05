@echo off
chcp 65001 >nul
title Novel Local AI Companion Installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "NOVEL_INSTALL_EXIT=%ERRORLEVEL%"
if not "%NOVEL_INSTALL_EXIT%"=="0" (
  echo.
  echo Installation did not complete. Keep the error above and retry.
  pause
)
exit /b %NOVEL_INSTALL_EXIT%
