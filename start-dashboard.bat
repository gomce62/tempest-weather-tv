@echo off
title Tempest Weather Dashboard
echo Starting Tempest Weather Dashboard on http://localhost:3080 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
