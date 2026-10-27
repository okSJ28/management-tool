@echo off
setlocal
cd /d "%~dp0tool"

rem Corporate proxies can intercept loopback requests; make sure they are bypassed.
set NO_PROXY=localhost,127.0.0.1,::1
set no_proxy=localhost,127.0.0.1,::1

set PYEXE=
where py >nul 2>nul && set PYEXE=py -3
if "%PYEXE%"=="" (
  where python >nul 2>nul && set PYEXE=python
)
rem The Microsoft Store alias "python" exists but does not run; verify it.
if not "%PYEXE%"=="" (
  %PYEXE% -c "import sys" >nul 2>nul || set PYEXE=
)
if "%PYEXE%"=="" (
  echo [ERROR] Python was not found. Please install Python 3.9 or later.
  echo         https://www.python.org/downloads/  ^(check "Add python.exe to PATH"^)
  pause
  exit /b 1
)

%PYEXE% -c "import openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Installing required package: openpyxl
  %PYEXE% -m pip install --quiet openpyxl
  if errorlevel 1 (
    echo.
    echo [WARNING] Failed to install openpyxl. Excel import/export will not work.
    echo           Check the network/proxy, or run: %PYEXE% -m pip install openpyxl
    echo.
    pause
  )
)

%PYEXE% server.py
pause
