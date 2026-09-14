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
if "%PYEXE%"=="" (
  echo Python was not found. Please install Python 3.9 or later.
  pause
  exit /b 1
)

%PYEXE% -c "import openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Installing required package: openpyxl
  %PYEXE% -m pip install --quiet openpyxl
)

echo.
echo  SHARED MODE - other people on the same network can use this tool.
echo  Keep this window open while the team is using it.
echo.
%PYEXE% server.py --share
pause
