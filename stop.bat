@echo off
title Stop Murasame
powershell -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
pause
