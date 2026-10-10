@echo off
echo Installing Qiskit + Aer (needs internet once, ~200 MB)...
python -m pip install qiskit qiskit-aer scipy numpy
python -c "import qiskit, qiskit_aer; print(\"Qiskit\", qiskit.__version__, \"Aer\", qiskit_aer.__version__, \"ready\")"
pause
