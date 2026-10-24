@echo off
rem ============================================================================
rem Initialize the Windows C++ build environment (MSVC + Windows SDK).
rem
rem Design notes:
rem   * Visual Studio / Build Tools is discovered with vswhere.exe. No hardcoded
rem     install path, MSVC toolset version or Windows SDK version.
rem   * VsDevCmd.bat initializes PATH / INCLUDE / LIB / SDK. We never hand-build
rem     INCLUDE or LIB.
rem   * No setlocal: the environment must stay in the caller process so cargo
rem     inherits a working cl.exe.
rem   * No build-directory relocation: the old MSVC D8050 workaround (a short
rem     CARGO_TARGET_DIR outside the repo) is no longer needed. The real fix lives
rem     in src-tauri/Cargo.toml: [profile.dev.package.ring] debug = false.
rem
rem Optional environment variables:
rem   CARGO_TARGET_DIR       respected if the developer sets it explicitly
rem   EDT_SKIP_MSVC_INIT=1   skip VsDevCmd (already inside a VS dev prompt)
rem   EDT_ENV_DUMP=<file>    dump INCLUDE/LIB/SDK/VS path for scripts/doctor.mjs
rem ============================================================================

set "EDT_VC_COMPONENT=Microsoft.VisualStudio.Component.VC.Tools.x86.x64"

rem Note: "defined" is true for variables that exist with an empty value, so compare text.
if not "%INCLUDE%"=="" if not "%LIB%"=="" goto :env_done
if "%EDT_SKIP_MSVC_INIT%"=="1" goto :env_done

rem --- 1. locate vswhere ------------------------------------------------------
set "EDT_VSWHERE="
if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" set "EDT_VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not defined EDT_VSWHERE if exist "%ProgramFiles%\Microsoft Visual Studio\Installer\vswhere.exe" set "EDT_VSWHERE=%ProgramFiles%\Microsoft Visual Studio\Installer\vswhere.exe"
if not defined EDT_VSWHERE (
  echo [ERROR] Visual Studio Build Tools not found ^(vswhere.exe missing^).
  echo.
  echo   Required: "Desktop development with C++" ^(MSVC x64 toolset + Windows SDK^)
  echo   Install:  https://aka.ms/vs/17/release/vs_BuildTools.exe
  echo   A full Visual Studio IDE is NOT required.
  exit /b 1
)

rem --- 2. locate an instance that has the C++ workload ------------------------
set "EDT_VS_PATH="
for /f "usebackq delims=" %%i in (`"%EDT_VSWHERE%" -latest -products * -requires %EDT_VC_COMPONENT% -property installationPath -nologo`) do set "EDT_VS_PATH=%%i"
if not defined EDT_VS_PATH (
  echo [ERROR] Visual Studio was found, but the C++ build tools workload is missing.
  echo.
  echo   Required component: %EDT_VC_COMPONENT%
  echo   In the Visual Studio Installer enable "Desktop development with C++".
  exit /b 1
)

rem --- 3. initialize the environment in the caller process --------------------
set "EDT_VSDEVCMD=%EDT_VS_PATH%\Common7\Tools\VsDevCmd.bat"
if not exist "%EDT_VSDEVCMD%" (
  echo [ERROR] VsDevCmd.bat not found: "%EDT_VSDEVCMD%"
  echo         The Visual Studio installation looks incomplete; repair it in the installer.
  exit /b 1
)

call "%EDT_VSDEVCMD%" -arch=amd64 -host_arch=amd64 -no_logo >nul
if errorlevel 1 (
  echo [ERROR] VsDevCmd.bat failed to initialize the MSVC environment.
  exit /b 1
)

rem --- 4. validate the environment (checking cl.exe alone is not enough) ------
where cl.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cl.exe not found after VsDevCmd initialization.
  echo         Check that the MSVC x64 toolset is installed.
  exit /b 1
)
if not defined INCLUDE (
  echo [ERROR] INCLUDE is empty after VsDevCmd initialization ^(Windows SDK headers missing^).
  echo         Install the Windows SDK component in the Visual Studio Installer.
  exit /b 1
)
if not defined LIB (
  echo [ERROR] LIB is empty after VsDevCmd initialization ^(Windows SDK libraries missing^).
  echo         Install the Windows SDK component in the Visual Studio Installer.
  exit /b 1
)
if not defined WindowsSdkDir (
  echo [ERROR] Windows SDK not detected ^(WindowsSdkDir is empty^).
  echo         Install a Windows 10/11 SDK in the Visual Studio Installer.
  exit /b 1
)

:env_done
rem Optional machine-readable dump for scripts/doctor.mjs.
rem Deliberately no parenthesised block: %WindowsSdkDir% contains "(x86)" which would close it.
if not defined EDT_ENV_DUMP goto :env_done_finish
> "%EDT_ENV_DUMP%" echo INCLUDE=%INCLUDE%
>> "%EDT_ENV_DUMP%" echo LIB=%LIB%
>> "%EDT_ENV_DUMP%" echo WINDOWSSDKDIR=%WindowsSdkDir%
>> "%EDT_ENV_DUMP%" echo CARGO_TARGET_DIR=%CARGO_TARGET_DIR%
>> "%EDT_ENV_DUMP%" echo VS_PATH=%EDT_VS_PATH%
for /f "delims=" %%P in ('where cl.exe 2^>nul') do >> "%EDT_ENV_DUMP%" echo CL=%%P

:env_done_finish
exit /b 0