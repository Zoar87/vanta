@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title VANTA - publicar version
cd /d "%~dp0"
set "LOG=%~dp0publicar.log"
echo ===== %date% %time% ===== > "%LOG%"

echo.
echo   VANTA - publicar una version nueva
echo   ---------------------------------------------
echo   Todo lo que salga aqui queda guardado en publicar.log
echo.

:: ---- herramientas necesarias ----
where git >nul 2>nul || (
  echo   [X] Falta Git. Instalalo desde una consola con:  winget install --id Git.Git -e
  goto :fin
)
where gh >nul 2>nul || (
  echo   [X] Falta la consola de GitHub. Instalala con:  winget install --id GitHub.cli -e
  goto :fin
)
where node >nul 2>nul || (
  echo   [X] Falta Node.js. Instalalo desde https://nodejs.org
  goto :fin
)

:: ---- sesion en GitHub (la primera vez abre el navegador) ----
gh auth status >nul 2>nul || (
  echo   Hay que iniciar sesion en GitHub. Se abre el navegador; acepta y vuelve aqui.
  echo.
  gh auth login --web --git-protocol https
  gh auth status >nul 2>nul || (
    echo   [X] No se pudo iniciar sesion.
    goto :fin
  )
)
gh auth setup-git >nul 2>nul

for /f "usebackq delims=" %%u in (`gh api user -q .login`) do set "OWNER=%%u"
if "!OWNER!"=="" (
  echo   [X] No se pudo leer tu usuario de GitHub.
  goto :fin
)
echo   Usuario de GitHub: !OWNER!
echo   Usuario: !OWNER! >> "%LOG%"

:: ---- identidad de git, si no la hay ----
set "GIT_EMAIL="
for /f "usebackq delims=" %%e in (`git config user.email`) do set "GIT_EMAIL=%%e"
if "!GIT_EMAIL!"=="" (
  git config --global user.name "!OWNER!"
  git config --global user.email "!OWNER!@users.noreply.github.com"
)

:: ---- repositorio local y remoto, aguantando ejecuciones a medias ----
if not exist ".git" git init -b main >> "%LOG%" 2>&1
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  gh repo view !OWNER!/vanta >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   Primera publicacion: se crea el repositorio publico "vanta" en tu cuenta.
    echo   ^(Publico porque la actualizacion automatica lee las releases sin contrasena.^)
    gh repo create vanta --public --source=. --remote=origin >> "%LOG%" 2>&1
    if errorlevel 1 (
      echo   [X] No se pudo crear el repositorio. Mira publicar.log
      goto :fin
    )
  ) else (
    echo   El repositorio ya existe en tu cuenta: se enlaza.
    git remote add origin https://github.com/!OWNER!/vanta.git >> "%LOG%" 2>&1
  )
)

:: ---- version ----
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "CURVER=%%v"
echo.
echo   Version actual: !CURVER!
set "NEWVER="
set /p "NEWVER=  Nueva version (Enter para publicar la !CURVER! si aun no esta publicada): "
if "!NEWVER!"=="" set "NEWVER=!CURVER!"

gh release view v!NEWVER! -R !OWNER!/vanta >nul 2>nul
if not errorlevel 1 (
  echo   [X] La version !NEWVER! ya esta publicada. Pon un numero mas alto.
  goto :fin
)

if not "!NEWVER!"=="!CURVER!" (
  call npm version !NEWVER! --no-git-tag-version >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo   [X] Version no valida. Usa el formato mayor.menor.parche, como 0.3.0
    goto :fin
  )
)
node -e "const f=require('fs');const p=JSON.parse(f.readFileSync('package.json','utf8'));p.repository='github:%OWNER%/vanta';f.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"

:: ---- dependencias: aqui es donde fallaba, electron-builder no estaba instalado ----
echo.
echo   Comprobando dependencias...
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   [X] Fallo al instalar dependencias. Mira publicar.log
  goto :fin
)

:: ---- subir el codigo ----
git add -A >> "%LOG%" 2>&1
git commit -q -m "VANTA !NEWVER!" >> "%LOG%" 2>&1
git push -u origin main >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   [X] No se pudo subir el codigo. Mira publicar.log
  goto :fin
)
echo   Codigo subido.

:: ---- compilar el instalador (la salida se ve y se guarda) ----
echo.
echo   Compilando el instalador. La primera vez descarga herramientas y tarda unos minutos.
echo   No cierres esta ventana ni pulses teclas dentro.
echo.
call npm run dist 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath '%LOG%' -Append"

set "EXE=dist-installer\VANTA-Setup-!NEWVER!.exe"
if not exist "!EXE!" (
  echo.
  echo   [X] No se genero el instalador. El motivo esta al final de publicar.log
  goto :fin
)
if not exist "dist-installer\latest.yml" (
  echo   [X] Falta latest.yml, que es lo que lee el actualizador. Mira publicar.log
  goto :fin
)

:: ---- publicar la release con sus tres archivos ----
echo.
echo   Publicando la release v!NEWVER! en GitHub...
set "BLOCKMAP="
if exist "!EXE!.blockmap" set "BLOCKMAP=!EXE!.blockmap"
gh release create v!NEWVER! "!EXE!" !BLOCKMAP! "dist-installer\latest.yml" -R !OWNER!/vanta --title "VANTA !NEWVER!" --notes "Version !NEWVER!" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   [X] El instalador se creo pero no se pudo publicar la release. Mira publicar.log
  goto :fin
)

echo.
echo   ---------------------------------------------
echo   Publicada la version !NEWVER!
echo   https://github.com/!OWNER!/vanta/releases
echo.
echo   El instalador esta en !EXE!
echo   Instalalo una vez; a partir de ahi la app se actualiza sola.
echo   ---------------------------------------------

:fin
echo.
echo   Registro completo: publicar.log
echo   (Puedes cerrar esta ventana. Si algo ha fallado, pasame ese archivo.)
echo.
pause
