@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 24 e abra este arquivo novamente.
  pause
  exit /b 1
)
if not exist .env (
  echo Configure a instalacao conforme LEIA_PRIMEIRO.md antes de iniciar.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Execute npm ci antes de iniciar. Consulte LEIA_PRIMEIRO.md.
  pause
  exit /b 1
)
set ZEN_RUN_WORKER=true
echo Iniciando API e fila do ZenControl. Use Ctrl+C para encerrar.
echo Abra o endereco configurado em ZEN_PUBLIC_URL no arquivo .env.
call npm start
pause
