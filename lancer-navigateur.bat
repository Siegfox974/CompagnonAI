@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Version navigateur (sans site en fond).
if not exist node_modules call npm install
if not exist .env copy .env.example .env >nul
start "" /min cmd /c "timeout /t 5 >nul & start http://localhost:3000"
npm run dev
