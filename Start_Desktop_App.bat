@echo off
echo ====================================================
echo Starting Daily Bulletin Studio (Desktop App)...
echo ====================================================
if exist "%~dp0dist\Daily-Bulletin-Studio-v2-Portable.exe" (
    start "" "%~dp0dist\Daily-Bulletin-Studio-v2-Portable.exe"
) else if exist "%~dp0dist\Daily-Bulletin-Studio-Portable.exe" (
    start "" "%~dp0dist\Daily-Bulletin-Studio-Portable.exe"
) else if exist "%~dp0dist\win-unpacked\Daily Bulletin Studio.exe" (
    start "" "%~dp0dist\win-unpacked\Daily Bulletin Studio.exe"
) else (
    cd /d "%~dp0bulletin_app"
    start index.html
)
exit
