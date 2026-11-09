@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist .env copy .env.example .env >nul
rem Ouvre le navigateur quelques secondes apres, le temps que le serveur demarre.
start "" /min cmd /c "timeout /t 5 >nul & start http://localhost:3000"
npm run dev
