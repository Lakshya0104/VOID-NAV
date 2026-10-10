@echo off
REM Run this ONCE as Administrator (right-click > Run as administrator)
netsh advfirewall firewall add rule name="VOID-NAV 8800" dir=in action=allow protocol=TCP localport=8800 profile=any
echo Done. Port 8800 is open for the phone.
pause
