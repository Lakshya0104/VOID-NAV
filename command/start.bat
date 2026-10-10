@echo off
cd /d "%~dp0"
echo Checking pyserial...
python -c "import serial" 2>nul || python -m pip install pyserial
start "" "http://localhost:8800/command"
python server.py --node %*
pause
