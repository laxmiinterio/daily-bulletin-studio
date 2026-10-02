@echo off
echo ====================================================
echo Starting Local Web Server on http://localhost:8000
echo ====================================================
cd /d "%~dp0bulletin_app"
start "" http://localhost:8000
python -m http.server 8000
pause
