@echo off
rem Windows: keeps running and refreshes every LOOP_MINUTES. Put a shortcut to this file
rem into the Autostart folder (Win+R -> shell:startup), set "Run: Minimized".
cd /d "%~dp0"
if not exist out mkdir out
bun run src/main.ts --loop >> out\run.log 2>&1
