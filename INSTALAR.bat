@echo off
chcp 65001 >nul
title VANTA - instalacion
cd /d "%~dp0"

echo.
echo   VANTA
echo   Instalacion inicial
echo   ---------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] No se encuentra Node.js.
  echo.
  echo   Instalalo desde https://nodejs.org  ^(version LTS^)
  echo   y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo   Node.js %%v detectado.
echo.
echo   Descargando dependencias. La primera vez tarda varios minutos
echo   porque incluye Electron ^(unos 150 MB^). No cierres esta ventana.
echo.

call npm install
if errorlevel 1 (
  echo.
  echo   [X] Fallo al instalar las dependencias.
  echo   Revisa tu conexion y vuelve a intentarlo.
  pause
  exit /b 1
)

echo.
echo   Compilando la aplicacion...
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo   [X] Fallo al compilar.
  pause
  exit /b 1
)

echo.
echo   ---------------------------------------------
echo   Listo. Ya puedes abrir VANTA.bat
echo   ---------------------------------------------
echo.
pause
