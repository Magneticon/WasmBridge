param(
    [string]$Cli = "C:\CODEX\GIT\WasmBridge\bin\Release\WXP\x64\WasmBridge.exe"
)

$ErrorActionPreference = "Stop"
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("wasmbridge-emcc-" + [Guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $source = Join-Path $temporary "sample source.c"
    $source2 = Join-Path $temporary "helper.cpp"
    $include = Join-Path $temporary "include dir"
    $output = Join-Path $temporary "sample output.wasm"
    $fixture = Join-Path $temporary "fixture.wasm"
    $log = Join-Path $temporary "arguments.txt"
    $fake = Join-Path $temporary "fake-emcc.cmd"
    Set-Content -LiteralPath $source -Encoding ASCII -Value "int add(int a, int b) { return a + b; }"
    Set-Content -LiteralPath $source2 -Encoding ASCII -Value "int helper() { return 1; }"
    New-Item -ItemType Directory -Path $include | Out-Null
    [IO.File]::WriteAllBytes($fixture, [byte[]](0,97,115,109,1,0,0,0))
    @'
@echo off
echo %* > "%FAKE_EMCC_LOG%"
copy /b /y "%FAKE_EMCC_WASM%" "%FAKE_EMCC_OUTPUT%" >nul
exit /b %errorlevel%
'@ | Set-Content -LiteralPath $fake -Encoding ASCII

    $env:FAKE_EMCC_LOG = $log
    $env:FAKE_EMCC_WASM = $fixture
    $env:FAKE_EMCC_OUTPUT = $output
    & $Cli build-emscripten --sources ($source + ";" + $source2) --out $output --emcc $fake --export "add,wb_process" --include $include --define "WB_TEST;VALUE=1"
    if ($LASTEXITCODE -ne 0) { throw "build-emscripten failed with exit code $LASTEXITCODE." }
    $arguments = Get-Content -LiteralPath $log -Raw
    foreach ($expected in @("--no-entry", "STANDALONE_WASM=1", "FILESYSTEM=0", "'_add'", "'_wb_process'",
                            "-mno-bulk-memory", "-mno-sign-ext", "-mno-nontrapping-fptoint", "-I", "-DWB_TEST", "-DVALUE=1",
                            "helper.cpp")) {
        if ($arguments -notlike "*$expected*") { throw "Missing emcc argument: $expected" }
    }
    if (-not (Test-Path -LiteralPath $output)) { throw "Fake emcc output was not accepted." }

    $badOutput = Join-Path $temporary "bad.wasm"
    $bad = & $Cli build-emscripten --source $source --out $badOutput --emcc $fake --export "bad-name" 2>&1
    if ($LASTEXITCODE -eq 0 -or ($bad -join " ") -notmatch "simple C symbols") {
        throw "Invalid Emscripten export name was not rejected."
    }
    Write-Host "PASS: Emscripten batch launcher, legacy flags, exports, output verification and validation errors."
}
finally {
    Remove-Item Env:FAKE_EMCC_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_EMCC_WASM -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_EMCC_OUTPUT -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
$global:LASTEXITCODE = 0
