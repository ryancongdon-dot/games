@echo off
title Strike Valley Lanes - game server
cd /d "%~dp0"
echo ==============================================
echo   STRIKE VALLEY LANES
echo   Keep this window open while you play.
echo   Close it when you're done.
echo ==============================================
start "" "http://localhost:8000/games/bowling/"
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8000
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -m http.server 8000
  ) else (
    echo.
    echo Python was not found on this computer.
    echo Install it from https://www.python.org/downloads/
    echo and CHECK the "Add python.exe to PATH" box during install.
    echo Or use the "Live Server" extension in VS Code instead.
    echo.
    pause
  )
)
