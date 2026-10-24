@echo off
rem Windows native dev entry: initialize MSVC, then run Tauri dev
rem (beforeDevCommand starts the Vite dev server).
rem Can be double-clicked or run from cmd; the unified entry is `pnpm dev`.
call "%~dp0_env.bat"
if errorlevel 1 exit /b 1

echo [dev] MSVC environment ready
call "%~dp0..\..\node_modules\.bin\tauri.cmd" dev %*
exit /b %errorlevel%
