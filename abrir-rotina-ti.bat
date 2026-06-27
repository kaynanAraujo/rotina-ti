@echo off
title Rotina TI - Servidor Local
cd /d "%~dp0"

set PORTA=3000
set NOMEPC=%COMPUTERNAME%
set URL_LOCAL=http://localhost:%PORTA%
set URL_REDE=http://%NOMEPC%:%PORTA%

echo ==========================================
echo        Rotina TI - Servidor Local
echo ==========================================
echo.
echo Link neste PC: %URL_LOCAL%
echo Link para outros PCs: %URL_REDE%
echo.

if not exist "package.json" (
  echo ERRO: package.json nao encontrado.
  echo Coloque este BAT dentro da pasta do projeto.
  pause
  exit /b
)

if not exist "node_modules" (
  echo Instalando dependencias pela primeira vez...
  echo Isso pode demorar alguns minutos.
  npm.cmd install
  if errorlevel 1 (
    echo.
    echo ERRO ao instalar dependencias.
    pause
    exit /b
  )
)

start "Servidor Rotina TI" cmd /k "cd /d "%~dp0" && npm.cmd start"
timeout /t 3 /nobreak >nul
start "" "%URL_LOCAL%"

echo.
echo Sistema iniciado.
echo Para outras pessoas acessarem, use: %URL_REDE%
echo.
exit
