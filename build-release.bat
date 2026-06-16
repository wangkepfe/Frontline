@echo off
setlocal
cd /d "%~dp0"

echo Building FRONTLINE release...
call npm run dist:win
if %ERRORLEVEL% neq 0 (
    echo Build failed.
    pause
    exit /b %ERRORLEVEL%
)

set "GAME_EXE=release\win-unpacked\FRONTLINE.exe"
if not exist "%GAME_EXE%" (
    echo Build reported success but %GAME_EXE% was not found.
    pause
    exit /b 1
)

echo.
echo Build complete. Output in .\release\
echo Starting FRONTLINE...
start "" "%GAME_EXE%"
exit /b 0
