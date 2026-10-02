param(
    [string]$Cli = "C:\CODEX\GIT\WasmBridge\bin\Release\WXP\x64\WasmBridge.exe"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("wasmbridge-package-" + [Guid]::NewGuid().ToString("N"))

try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $general = Join-Path $temporary "general"
    $legacy = Join-Path $temporary "legacy"
    & $Cli package `
        --wasm (Join-Path $repo "Examples\BufferArena\buffers.wasm") `
        --fallback (Join-Path $repo "Examples\BufferArena\buffers-fallback.js") `
        --runtime (Join-Path $repo "Runtime\wasmbridge.js") `
        --module-runtime (Join-Path $repo "Runtime\module.js") `
        --out $general `
        --export "wb_active_count,wb_invert_rgba" `
        --allocator "wb_alloc,wb_free,wb_capacity" `
        --memory-export "memory" `
        --fallback-global "WasmBridgeBuffersFallback" `
        --signatures (Join-Path $repo "Examples\BufferArena\signatures.json")
    if ($LASTEXITCODE -ne 0) { throw "Package command failed with exit code $LASTEXITCODE." }

    $manifest = Get-Content -LiteralPath (Join-Path $general "manifest.json") -Raw | ConvertFrom-Json
    if ($manifest.format -ne "wasmbridge-package-0.2") { throw "Unexpected package format." }
    if ($manifest.moduleRuntime -ne "module.js") { throw "General module runtime is missing." }
    if ($manifest.allocator.allocate -ne "wb_alloc" -or
        $manifest.allocator.release -ne "wb_free" -or
        $manifest.allocator.capacity -ne "wb_capacity") { throw "Allocator metadata mismatch." }
    if ($manifest.memoryExport -ne "memory") { throw "Memory export mismatch." }
    if ($manifest.fallbackGlobal -ne "WasmBridgeBuffersFallback") { throw "Fallback global mismatch." }
    if ($manifest.signatures.wb_invert_rgba.parameters.Count -ne 3 -or
        $manifest.signatures.wb_invert_rgba.result -ne "i32") { throw "Signature metadata mismatch." }
    & $Cli verify-package --manifest (Join-Path $general "manifest.json")
    if ($LASTEXITCODE -ne 0) { throw "General package verification failed." }

    $hashes = @{
        "module.wasm" = $manifest.wasmSha256
        "fallback.js" = $manifest.fallbackSha256
        "wasmbridge.js" = $manifest.runtimeSha256
        "module.js" = $manifest.moduleRuntimeSha256
    }
    foreach ($name in $hashes.Keys) {
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $general $name)).Hash.ToLowerInvariant()
        if ($actual -ne $hashes[$name]) { throw "SHA-256 mismatch for $name." }
    }

    & $Cli package `
        --wasm (Join-Path $repo "Examples\HelloWorld\add.wasm") `
        --fallback (Join-Path $repo "Examples\HelloWorld\add.js") `
        --runtime (Join-Path $repo "Runtime\wasmbridge.js") `
        --out $legacy `
        --export "add"
    if ($LASTEXITCODE -ne 0) { throw "Legacy package command failed with exit code $LASTEXITCODE." }
    $legacyManifest = Get-Content -LiteralPath (Join-Path $legacy "manifest.json") -Raw | ConvertFrom-Json
    if ($legacyManifest.format -ne "wasmbridge-package-0.1" -or
        $null -ne $legacyManifest.moduleRuntime) { throw "Legacy package compatibility regressed." }
    & $Cli verify-package --manifest (Join-Path $legacy "manifest.json")
    if ($LASTEXITCODE -ne 0) { throw "Legacy package verification failed." }

    Add-Content -LiteralPath (Join-Path $general "fallback.js") -Value "// deliberate tamper"
    $tamperOutput = & $Cli verify-package --manifest (Join-Path $general "manifest.json") 2>&1
    if ($LASTEXITCODE -eq 0 -or ($tamperOutput -join " ") -notmatch "SHA-256 mismatch") {
        throw "Package verifier did not reject a modified artifact."
    }
    Set-Content -LiteralPath (Join-Path $legacy "unexpected.txt") -Value "unexpected"
    $unexpectedOutput = & $Cli verify-package --manifest (Join-Path $legacy "manifest.json") 2>&1
    if ($LASTEXITCODE -eq 0 -or ($unexpectedOutput -join " ") -notmatch "Unexpected package artifact") {
        throw "Package verifier did not reject an unexpected artifact."
    }

    Write-Host "PASS: v0.2/v0.1 packages verify; tampered and unexpected artifacts are rejected."
}
finally {
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
}
$global:LASTEXITCODE = 0
