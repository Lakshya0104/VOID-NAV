@echo off
echo Stopping every running Python server (old VOID-NAV windows)...
taskkill /F /IM python.exe >nul 2>nul
taskkill /F /IM py.exe >nul 2>nul
taskkill /F /IM pythonw.exe >nul 2>nul
echo Done. Now run start.bat (with ESP32) or start_without_esp32.bat from THIS folder.
pause
