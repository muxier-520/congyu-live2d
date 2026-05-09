@echo off
chcp 65001 >nul 2>&1
title 停止丛雨 Live2D

powershell -ExecutionPolicy Bypass -File "%~dp0停止.ps1"
pause
