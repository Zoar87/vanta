@echo off
chcp 65001 >nul
title VANTA - pruebas
cd /d "%~dp0"

if not exist "node_modules" (
  echo   Falta la instalacion. Ejecuta primero INSTALAR.bat
  pause
  exit /b 1
)

echo   Ejecutando las pruebas de los servicios de VANTA...
echo.
node pruebas\servicios.mjs
echo.
pause
