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

:: npm 12 no ejecuta los scripts de instalacion sin permiso explicito, y sin
:: ellos no se descarga el binario de Electron. Se pide y se comprueba.
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   Autorizando la descarga de Electron...
  call npm approve-scripts electron >nul 2>nul
  call npm rebuild electron >nul 2>nul
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   [!] No se ha descargado el motor de Electron.
  echo       Ejecuta en esta carpeta:  npm approve-scripts --allow-scripts-pending
  echo       y autoriza electron. Despues vuelve a ejecutar INSTALAR.bat
  echo.
  echo       ^(Publicar con PUBLICAR.bat funciona igualmente: descarga su copia.^)
  echo.
  pause
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
