@echo off
rem Windows: keeps running and refreshes every LOOP_MINUTES. Put a shortcut to this file
rem into the Autostart folder (Win+R -> shell:startup), set "Run: Minimized".
cd /d "%~dp0"
if not exist out mkdir out
rem Bun's installer only adds itself to the user PATH, which Autostart doesn't always see.
set "BUN=bun"
where bun >nul 2>&1 || set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
"%BUN%" run src/main.ts --loop >> out\run.log 2>&1
