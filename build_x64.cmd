@echo off
setlocal
set "TARGET_OS=%~1"
if "%TARGET_OS%"=="" set "TARGET_OS=WXP"
if /I not "%TARGET_OS%"=="WXP" if /I not "%TARGET_OS%"=="W10" (
    echo Usage: build_x64.cmd [WXP^|W10]
    exit /b 2
)
where MSBuild.exe >nul 2>&1
if errorlevel 1 (
    echo Run from the Visual Studio 2022 Developer Command Prompt.
    exit /b 1
)
MSBuild.exe "%~dp0WasmBridge.sln" /t:Rebuild /p:Configuration=Release /p:Platform=x64 /p:AtaTargetOS=%TARGET_OS% /m:1 /v:minimal /nologo
exit /b %ERRORLEVEL%
