@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Mise a jour de CompagnonAI ===
git pull
if errorlevel 1 (
  echo.
  echo [ERREUR] git pull a echoue. Envoie une capture de cette fenetre.
  pause
  exit /b 1
)
call npm install
echo.
echo Mise a jour terminee.
pause
