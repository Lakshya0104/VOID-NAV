#!/bin/sh
cd "$(dirname "$0")"
python3 -c "import serial" 2>/dev/null || python3 -m pip install pyserial
(sleep 1; xdg-open http://localhost:8800/command 2>/dev/null || open http://localhost:8800/command) &
python3 server.py --node "$@"
