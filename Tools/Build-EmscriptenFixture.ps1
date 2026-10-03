param(
    [string]$Emsdk,
    [string]$ToolRoot,
    [string]$Version = "6.0.10"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if ([String]::IsNullOrEmpty($ToolRoot)) {
    $ToolRoot = $(if ($env:WASMBRIDGE_TOOLS) { $env:WASMBRIDGE_TOOLS } else { Join-Path $repo "Toolchain" })
}
if ([String]::IsNullOrEmpty($Emsdk)) {
    $Emsdk = Join-Path $ToolRoot "emsdk"
}
$cli = Join-Path $repo "bin\Release\WXP\x64\WasmBridge.exe"
$emcc = Join-Path $Emsdk "upstream\emscripten\emcc.exe"
$validator = Join-Path $ToolRoot "wabt-1.0.42\bin\wasm-validate.exe"
$python = Get-ChildItem -LiteralPath (Join-Path $Emsdk "python") -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
$node = Get-ChildItem -LiteralPath (Join-Path $Emsdk "node") -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
foreach ($file in @($cli, $emcc, $validator)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Required file not found: $file" }
}
if (-not $python -or -not $node) { throw "Activate Emscripten $Version under $Emsdk first." }

$env:EMSDK = $Emsdk
$env:EMSDK_PYTHON = Join-Path $python.FullName "python.exe"
$env:EMSDK_NODE = Join-Path $node.FullName "node.exe"
$env:Path = $python.FullName + ";" + $node.FullName + ";" + $env:Path
$reportedVersion = (& $emcc --version 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $reportedVersion -notmatch ("emcc.*" + [regex]::Escape($Version))) {
    throw "Expected Emscripten $Version, but emcc reported: $reportedVersion"
}
$output = Join-Path $repo "Examples\EmscriptenHelloWorld\add.wasm"
[IO.File]::Delete($output)
& $cli build-emscripten --source (Join-Path $repo "Core\math.c") --out $output --emcc $emcc --export add
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $cli validate-legacy --wasm $output --validator $validator
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "PASS: bundled Emscripten $Version fixture built and validated for the restricted MVP profile."
