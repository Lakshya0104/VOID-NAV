@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
REM usage:  flash.bat rescuer [COM5]  |  flash.bat gateway [COM6]  |  flash.bat rescuer_usb_only [COM5]
set ROLE=%1
if "%ROLE%"=="" (echo usage: flash.bat rescuer^|gateway^|rescuer_usb_only [COMx] & pause & exit /b 1)
where arduino-cli >nul 2>nul || (echo arduino-cli not found in PATH. & pause & exit /b 1)
echo [1/4] ESP32 core + LoRa library (first time downloads ~300 MB)
arduino-cli config init --overwrite >nul 2>nul
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core list | findstr /i "esp32:esp32" >nul || arduino-cli core install esp32:esp32
arduino-cli lib list | findstr /i /b "LoRa " >nul || arduino-cli lib install LoRa
set PORT=%2
if "%PORT%"=="" for /f "tokens=1" %%p in ('arduino-cli board list ^| findstr /i "COM"') do if "!PORT!"=="" set PORT=%%p
if "%PORT%"=="" (echo No COM port found. Data cable? CP210x/CH340 driver? & arduino-cli board list & pause & exit /b 1)
echo [2/4] port %PORT%   role %ROLE%
echo [3/4] compiling voidnav_%ROLE%
arduino-cli compile --fqbn esp32:esp32:esp32 voidnav_%ROLE% || (echo COMPILE FAILED - send the red text to Claude & pause & exit /b 1)
echo [4/4] uploading (hold BOOT if stuck on Connecting...)
arduino-cli upload -p %PORT% --fqbn esp32:esp32:esp32 voidnav_%ROLE% || (echo UPLOAD FAILED - hold BOOT, close Serial Monitor & pause & exit /b 1)
echo DONE. Press EN/RST. Showing output (Ctrl+C to stop):
arduino-cli monitor -p %PORT% -c baudrate=115200
