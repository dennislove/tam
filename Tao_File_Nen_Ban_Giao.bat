@echo off
chcp 65001 >nul
title Dong Goi Ban Giao TNVN Auto Exam Pro

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pack_release.ps1"

pause
