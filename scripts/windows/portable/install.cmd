@echo off
rem everydaytool one-click install: plain file copy + shortcuts + uninstall entry.
rem It does not use NSIS / MSI, so installer write blocks ("Can't write: ...everydaytool.exe")
rem do not apply. Keep this file ASCII-only. Double-click to run; takes no arguments.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  pause
)
endlocal
