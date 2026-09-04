@echo off
chcp 65001 >nul
title VANTA
cd /d "%~dp0"

if not exist "node_modules" (
  echo   Falta la instalacion. Ejecuta primero INSTALAR.bat
  pause
  exit /b 1
)
if not exist "dist-electron\main.js" (
  echo   Falta la compilacion. Ejecuta primero INSTALAR.bat
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo   Falta el binario de Electron. Ejecuta INSTALAR.bat
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
exit
