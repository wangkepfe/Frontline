@echo off
echo Building FRONTLINE release...
call npm run dist:win
if %ERRORLEVEL% neq 0 (
    echo Build failed.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo Build complete. Output in .\release\
pause
exit /b 0
