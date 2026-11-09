@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules\electron\dist call npm install
if not exist .env copy .env.example .env >nul
npm run app
if errorlevel 1 pause
