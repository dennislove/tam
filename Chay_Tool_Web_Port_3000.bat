@echo off
chcp 65001 >nul
title TNVN Auto Exam Pro - Port 3000

echo Dang khoi dong Web Server tai http://localhost:3000 ...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

pnpm ui
