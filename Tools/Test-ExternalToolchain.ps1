param(
    [string]$ToolRoot = $(if ($env:WASMBRIDGE_TOOLS) { $env:WASMBRIDGE_TOOLS } else { 'C:\CODEX\TOOLS\WasmBridge' }),
    [string]$OutputDirectory = $(Join-Path ([IO.Path]::GetTempPath()) ('WasmBridge\external-' + [Guid]::NewGuid().ToString('N')))
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$cli = Join-Path $repoRoot 'bin\Release\WXP\x64\WasmBridge.exe'
$input = Join-Path $repoRoot 'Examples\BufferArena\buffers.wasm'

function Resolve-WasmBridgeTool([string]$Name, [string]$RelativePath) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $portable = Join-Path $ToolRoot $RelativePath
    if (Test-Path -LiteralPath $portable) { return $portable }
    return $null
}

$validator = Resolve-WasmBridgeTool 'wasm-validate.exe' 'wabt-1.0.42\bin\wasm-validate.exe'
$optimizer = Resolve-WasmBridgeTool 'wasm-opt.exe' 'binaryen-version_133\bin\wasm-opt.exe'
$wasm2js = Resolve-WasmBridgeTool 'wasm2js.exe' 'binaryen-version_133\bin\wasm2js.exe'
$esbuild = Resolve-WasmBridgeTool 'esbuild.exe' 'esbuild-0.28.2\esbuild.exe'

foreach ($file in @($cli,$input)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Required WasmBridge file not found: $file" }
}

$missing = @()
if (-not $validator) { $missing += 'wasm-validate.exe' }
if (-not $optimizer) { $missing += 'wasm-opt.exe' }
if (-not $wasm2js) { $missing += 'wasm2js.exe' }
if (-not $esbuild) { $missing += 'esbuild.exe' }
if ($missing.Count -ne 0) {
    Write-Host ("SKIP: optional external toolchain is not installed/discoverable: " + ($missing -join ', ') +
        ". Add the tools to PATH or set WASMBRIDGE_TOOLS / -ToolRoot.")
    $global:LASTEXITCODE = 0
    return
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

# Test the freshly generated candidate against the current BufferArena ABI.
# This avoids trusting the historical checked-in candidate after buffers.wasm
# changes and proves the current toolchain output still matches the maintained
# handwritten fallback.
& node (Join-Path $repoRoot 'Tests\test_generated_fallback_node.js') $candidate $input
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ('WABT: ' + (& $validator --version))
Write-Host ('Binaryen wasm-opt: ' + (& $optimizer --version))
Write-Host ('Binaryen wasm2js: ' + (& $wasm2js --version))
Write-Host ('esbuild: ' + (& $esbuild --version))
Write-Host "PASS: external toolchain outputs and fresh generated-fallback parity are verified under $OutputDirectory"
$global:LASTEXITCODE = 0
