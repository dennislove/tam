@echo off
setlocal
chcp 65001 >nul
title TNVN Auto Exam Pro - Tool Tu Dong Thi Truc Tuyen

echo ====================================================================
echo   TNVN AUTO EXAM PRO - HE THONG TU DONG THI THANH NIEN VIET NAM
echo ====================================================================
echo.

set "NODE_BIN="
if exist "%~dp0bin\node.exe" (
    set "NODE_BIN=%~dp0bin\node.exe"
)
if "%NODE_BIN%"=="" (
    where node >nul 2>nul
    if %errorlevel% equ 0 (
        set "NODE_BIN=node"
    )
)

if "%NODE_BIN%"=="" (
    echo [LOI] Khong tim thay Node.js tren may tinh!
    echo Vui long cai dat Node.js tu trang web: https://nodejs.org
    echo.
    pause
    exit /b 1
)

start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

echo [*] Dang khoi dong Web Server tai http://localhost:3000 ...
echo [*] Trinh duyet se tu dong mo sau 2 giay.
echo [*] Khong tat cua so nay trong khi dang thi.
echo --------------------------------------------------------------------
echo.

"%NODE_BIN%" "%~dp0dist\server.js"

if %errorlevel% neq 0 (
    echo.
    echo [LOI] Server bi dung voi ma loi %errorlevel%.
    pause
)
