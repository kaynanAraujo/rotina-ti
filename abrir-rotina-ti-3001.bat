@echo off
setlocal
title Rotina TI - Servidor Local
cd /d "%~dp0"

set "PORT=3001"
set "URL_LOCAL=http://localhost:3001"
set "URL_REDE=http://%COMPUTERNAME%:3001"
set "URL_HEALTH=http://127.0.0.1:3001/api/health"

if /i "%~1"=="--server" goto RUN_SERVER

echo ==========================================
echo        Rotina TI - Servidor Local
echo ==========================================
echo.
echo %URL_LOCAL%
echo %URL_REDE%
echo.

if not exist "package.json" (
  echo ERRO: package.json nao encontrado.
  pause
  exit /b 1
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js nao esta instalado.
  echo Instale o Node.js LTS atual, versao 20.17.0 ou superior.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>20 || (v[0]===20 && v[1]>=17) ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo ERRO: a versao do Node.js e antiga ou nao pode ser executada.
  echo Instale o Node.js LTS atual, versao 20.17.0 ou superior.
  node --version
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERRO: npm.cmd nao foi encontrado.
  echo Repare ou reinstale o Node.js LTS.
  pause
  exit /b 1
)

call npm.cmd --version >nul 2>nul
if errorlevel 1 (
  echo ERRO: o npm foi encontrado, mas nao pode ser executado.
  pause
  exit /b 1
)

node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))" >nul 2>nul
if errorlevel 1 (
  echo ERRO: package.json invalido.
  pause
  exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERRO: Windows PowerShell nao foi encontrado.
  echo Ele e necessario para verificar a porta e a saude do Rotina TI.
  pause
  exit /b 1
)

call :CHECK_HEALTH
if not errorlevel 1 goto ROTINA_ALREADY_RUNNING

call :CHECK_PORT
if not errorlevel 1 goto PORT_IN_USE

if not exist "node_modules" (
  echo Instalando dependencias pela primeira vez...
  call npm.cmd install
  if errorlevel 1 (
    echo ERRO ao instalar dependencias.
    pause
    exit /b 1
  )
)

echo Iniciando uma instancia do Rotina TI...
start "Servidor Rotina TI" cmd.exe /k call "%~f0" --server

call :WAIT_FOR_HEALTH
if errorlevel 1 goto START_FAILED

echo Rotina TI iniciado com sucesso.
goto OPEN_BROWSER

:ROTINA_ALREADY_RUNNING
echo Rotina TI ja esta funcionando na porta 3001.
echo Nenhuma nova instancia sera iniciada.
goto OPEN_BROWSER

:PORT_IN_USE
echo.
echo ERRO: a porta 3001 esta ocupada por outro programa.
echo O endereco %URL_HEALTH% nao respondeu como Rotina TI.
echo Feche o outro programa ou libere a porta 3001 antes de tentar novamente.
pause
exit /b 1

:START_FAILED
echo.
echo ERRO: o Rotina TI nao respondeu em ate 15 segundos.
echo Verifique a janela "Servidor Rotina TI" para consultar o erro de inicializacao.
echo Nenhuma outra instancia sera iniciada por este BAT.
pause
exit /b 1

:OPEN_BROWSER
if /i "%ROTINA_TI_NO_BROWSER%"=="1" (
  echo Abertura do navegador desativada por ROTINA_TI_NO_BROWSER=1.
  exit /b 0
)

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  start "" "%CHROME%" "%URL_LOCAL%"
) else (
  echo Google Chrome nao encontrado. Abrindo no navegador padrao.
  start "" "%URL_LOCAL%"
)

exit /b 0

:CHECK_HEALTH
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-RestMethod -Uri '%URL_HEALTH%' -Method Get -TimeoutSec 2; if ($response.ok -eq $true) { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>nul
exit /b %errorlevel%

:CHECK_PORT
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $attempt = $client.BeginConnect('127.0.0.1', 3001, $null, $null); if (-not $attempt.AsyncWaitHandle.WaitOne(1000)) { $client.Close(); exit 1 }; $client.EndConnect($attempt); $client.Close(); exit 0 } catch { $client.Close(); exit 1 }" >nul 2>nul
exit /b %errorlevel%

:WAIT_FOR_HEALTH
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$deadline = [DateTime]::UtcNow.AddSeconds(15); do { try { $response = Invoke-RestMethod -Uri '%URL_HEALTH%' -Method Get -TimeoutSec 1; if ($response.ok -eq $true) { exit 0 } } catch {}; if ([DateTime]::UtcNow -ge $deadline) { break }; Start-Sleep -Milliseconds 500 } while ($true); exit 1" >nul 2>nul
exit /b %errorlevel%

:RUN_SERVER
title Servidor Rotina TI
echo ==========================================
echo        Rotina TI - Servidor Local
echo ==========================================
echo.
echo %URL_LOCAL%
echo %URL_REDE%
echo.
call npm.cmd start
exit /b %errorlevel%
