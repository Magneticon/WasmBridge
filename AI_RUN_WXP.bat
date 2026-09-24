@echo off
setlocal

rem Unattended XP test: managed header plus v141_xp native RGBA sample.
rem This does NOT test Firefox/WebAssembly execution.
rem Preserve the operator's existing remote root and DBGRun installation.
set "PROGNAME=WasmBridge"
set "REPONAME=WasmBridge"
set "OUTFILE=WasmBridge_out.txt"
set "ROOT=R:\GPT\CODEX\CODEX\GIT\%REPONAME%\"
set "OUT=%ROOT%%OUTFILE%"

set "ARCH=x64"
set "DBG=G:\CODEX\GIT\CONTROL\DBGRun\%ARCH%\DBGRun.exe"
set "EXE=%ROOT%bin\Release\WXP\%ARCH%\%PROGNAME%.exe"
set "NATIVE=%ROOT%bin\Release\WXP\%ARCH%\WasmBridge.Native.dll"
set "DBGOUT=%ROOT%AI_RUN_LOG_WXP.txt"

echo WasmBridge managed CLI self-test on WXP %ARCH% >"%OUT%"
echo Executable: "%EXE%" >>"%OUT%"
if exist "%DBGOUT%" del "%DBGOUT%"

if not exist "%EXE%" (
    echo RUN FAILED: executable not found. >>"%OUT%"
    endlocal & exit /b 1
)
if not exist "%NATIVE%" (
    echo RUN FAILED: required XP native DLL not found beside WasmBridge.exe: "%NATIVE%" >>"%OUT%"
    echo Verify that the v141_xp x64 native project is built and deployed with the managed binaries. >>"%OUT%"
    endlocal & exit /b 1
)

if not exist "%DBG%" (
    echo RUN FAILED: DBGRun not found. >>"%OUT%"
    endlocal & exit /b 1
)

"%DBG%" "%DBGOUT%" "%EXE%" self-test >>"%OUT%" 2>&1
set "RC=%ERRORLEVEL%"
echo DBGRun exit code: %RC% >>"%OUT%"
if exist "%DBGOUT%" type "%DBGOUT%" >>"%OUT%"

rem Do not report success merely because the launcher returned 0.
findstr /C:"PASS: valid and invalid headers handled." "%OUT%" >nul 2>&1
if errorlevel 1 set "RC=1"
findstr /C:"PASS: native RGBA8 inversion, alpha and bounds handled." "%OUT%" >nul 2>&1
if errorlevel 1 set "RC=1"
findstr /C:"PASS: XP native independent buffers, RGBA output, release and bounds." "%OUT%" >nul 2>&1
if errorlevel 1 set "RC=1"

if not "%RC%"=="0" (
    echo RUN FAILED: self-test result was not verified. >>"%OUT%"
) else (
    echo RUN PASS: managed header parser, native RGBA8 and native buffer-manager tests. >>"%OUT%"
)
endlocal & exit /b %RC%
