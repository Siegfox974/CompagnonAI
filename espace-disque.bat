@echo off
chcp 65001 >nul
echo === Espace utilise par CompagnonAI et ses outils ===
echo (calcul en cours, cela peut prendre une minute)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0espace-disque.ps1"
echo.
echo Le cache du navigateur integre est vide a chaque fermeture de l'application.
echo Le cache npm et les fichiers temporaires peuvent etre vides sans risque.
pause
