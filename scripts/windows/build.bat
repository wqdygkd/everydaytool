@echo off
rem Windows native build entry: initialize MSVC, then run Tauri build
rem (beforeBuildCommand builds the frontend).
rem The unified entry is `pnpm build`.
call "%~dp0_env.bat"
if errorlevel 1 exit /b 1

echo [build] MSVC environment ready

rem Default bundle target for Windows; an explicit --bundles argument wins.
set "EDT_BUNDLES=--bundles nsis"
echo %* | findstr /i /c:"--bundles" >nul && set "EDT_BUNDLES="

call "%~dp0..\..\node_modules\.bin\tauri.cmd" build %EDT_BUNDLES% %*
exit /b %errorlevel%
