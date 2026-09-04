@echo off
chcp 65001 >nul
title VANTA - recompilar
cd /d "%~dp0"

echo   Recompilando VANTA tras los cambios...
echo.
call npm install
call npm run build
if errorlevel 1 (
  echo.
  echo   [X] Fallo al compilar.
  pause
  exit /b 1
)
echo.
echo   Hecho. Abre VANTA.bat
pause
