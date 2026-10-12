@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 goto folder_error
where py >nul 2>&1
if not errorlevel 1 goto use_py
where python >nul 2>&1
if not errorlevel 1 goto use_python
echo Python was not found. Install Python 3.10 or newer from:
echo https://www.python.org/downloads/windows/
set "exporter_exit=1"
goto finish

:use_py
py -3 windows_launcher.py %*
set "exporter_exit=%errorlevel%"
goto finish

:use_python
python windows_launcher.py %*
set "exporter_exit=%errorlevel%"
goto finish

:folder_error
echo Extract this ZIP to a writable local folder before running it.
pause
exit /b 1

:finish
if not "%exporter_exit%"=="0" pause
popd
exit /b %exporter_exit%
