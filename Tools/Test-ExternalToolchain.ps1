param(
    [string]$ToolRoot = $(if ($env:WASMBRIDGE_TOOLS) { $env:WASMBRIDGE_TOOLS } else { 'C:\CODEX\TOOLS\WasmBridge' }),
    [string]$OutputDirectory = $(Join-Path ([IO.Path]::GetTempPath()) ('WasmBridge\external-' + [Guid]::NewGuid().ToString('N')))
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$cli = Join-Path $repoRoot 'bin\Release\WXP\x64\WasmBridge.exe'
$input = Join-Path $repoRoot 'Examples\BufferArena\buffers.wasm'
$validator = Join-Path $ToolRoot 'wabt-1.0.42\bin\wasm-validate.exe'
$optimizer = Join-Path $ToolRoot 'binaryen-version_133\bin\wasm-opt.exe'
$wasm2js = Join-Path $ToolRoot 'binaryen-version_133\bin\wasm2js.exe'
$esbuild = Join-Path $ToolRoot 'esbuild-0.28.2\esbuild.exe'
foreach ($file in @($cli,$input,$validator,$optimizer,$wasm2js,$esbuild)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Required file not found: $file" }
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$optimized = Join-Path $OutputDirectory 'buffers-optimized.wasm'
$candidate = Join-Path $OutputDirectory 'buffers-generated-candidate.js'

& $cli validate-legacy --wasm $input --validator $validator
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $cli optimize-legacy --wasm $input --out $optimized --validator $validator --optimizer $optimizer
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $cli generate-fallback --wasm $input --out $candidate --validator $validator --wasm2js $wasm2js --esbuild $esbuild
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ('WABT: ' + (& $validator --version))
Write-Host ('Binaryen wasm-opt: ' + (& $optimizer --version))
Write-Host ('Binaryen wasm2js: ' + (& $wasm2js --version))
Write-Host ('esbuild: ' + (& $esbuild --version))
Write-Host "PASS: external toolchain outputs are under $OutputDirectory"
