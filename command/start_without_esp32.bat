@echo off
cd /d "%~dp0"
start "" "http://localhost:8800/command"
python server.py
pause
