@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title VANTA - publicar version
cd /d "%~dp0"

echo.
echo   VANTA - publicar una version nueva
echo   ---------------------------------------------
echo.

:: ---- herramientas necesarias ----
where git >nul 2>nul
if errorlevel 1 (
  echo   [X] Falta Git. Instalalo con este comando en una consola y vuelve:
  echo.
  echo       winget install --id Git.Git -e
  echo.
  pause
  exit /b 1
)
where gh >nul 2>nul
if errorlevel 1 (
  echo   [X] Falta la consola de GitHub. Instalala con este comando y vuelve:
  echo.
  echo       winget install --id GitHub.cli -e
  echo.
  pause
  exit /b 1
)

:: ---- sesion en GitHub (la primera vez abre el navegador) ----
gh auth status >nul 2>nul
if errorlevel 1 (
  echo   Hay que iniciar sesion en GitHub. Se abre el navegador; acepta y vuelve aqui.
  echo.
  gh auth login --web --git-protocol https
  if errorlevel 1 (
    echo   [X] No se pudo iniciar sesion.
    pause
    exit /b 1
  )
)

for /f "usebackq delims=" %%u in (`gh api user -q .login`) do set OWNER=%%u
if "!OWNER!"=="" (
  echo   [X] No se pudo leer tu usuario de GitHub.
  pause
  exit /b 1
)
echo   Usuario de GitHub: !OWNER!

:: ---- identidad de git, si no la hay ----
for /f "usebackq delims=" %%e in (`git config user.email`) do set GIT_EMAIL=%%e
if "!GIT_EMAIL!"=="" (
  git config --global user.name "!OWNER!"
  git config --global user.email "!OWNER!@users.noreply.github.com"
)

:: ---- repositorio: crearlo la primera vez, subir cambios las demas ----
if not exist ".git" (
  echo.
  echo   Primera publicacion: se crea el repositorio publico "vanta" en tu cuenta.
  echo   ^(Publico porque la actualizacion automatica lee las releases sin contrasena.^)
  echo.
  git init -b main >nul
  git add -A
  git commit -q -m "VANTA: primera version"
  gh repo create vanta --public --source=. --remote=origin --push
  if errorlevel 1 (
    echo   [X] No se pudo crear el repositorio.
    pause
    exit /b 1
  )
)

:: ---- version nueva ----
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set CURVER=%%v
echo.
echo   Version actual: !CURVER!
set /p NEWVER=  Nueva version (por ejemplo 0.3.0): 
if "!NEWVER!"=="" (
  echo   Sin version no se publica nada.
  pause
  exit /b 1
)
if "!NEWVER!"=="!CURVER!" (
  echo   Tiene que ser distinta de la actual: GitHub no admite dos releases con la misma.
  pause
  exit /b 1
)

call npm version !NEWVER! --no-git-tag-version >nul
if errorlevel 1 (
  echo   [X] Version no valida. Usa el formato mayor.menor.parche, como 0.3.0
  pause
  exit /b 1
)
node -e "const f=require('fs');const p=JSON.parse(f.readFileSync('package.json','utf8'));p.repository='github:%OWNER%/vanta';f.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"

:: ---- subir el codigo ----
git add -A
git commit -q -m "VANTA !NEWVER!"
git push -q origin main
if errorlevel 1 (
  echo   [X] No se pudo subir el codigo.
  pause
  exit /b 1
)

:: ---- compilar el instalador y publicar la release ----
for /f "usebackq delims=" %%t in (`gh auth token`) do set GH_TOKEN=%%t
echo.
echo   Compilando el instalador y publicando la release !NEWVER!.
echo   La primera vez descarga herramientas y tarda unos minutos.
echo.
call npm run release
if errorlevel 1 (
  echo.
  echo   [X] Fallo al compilar o publicar.
  pause
  exit /b 1
)

echo.
echo   ---------------------------------------------
echo   Publicada la version !NEWVER!
echo   https://github.com/!OWNER!/vanta/releases
echo.
echo   El instalador esta en dist-installer\VANTA-Setup-!NEWVER!.exe
echo   Instalalo una vez; a partir de ahi la app se actualiza sola.
echo   ---------------------------------------------
echo.
pause
