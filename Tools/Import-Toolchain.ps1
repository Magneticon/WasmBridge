[CmdletBinding(PositionalBinding=$false)]
param(
    [string]$Source,
    [string]$Destination,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if ([String]::IsNullOrEmpty($Source)) {
    if ($env:WASMBRIDGE_TOOLCHAIN_SOURCE) {
        $Source = $env:WASMBRIDGE_TOOLCHAIN_SOURCE
    }
    else {
        $workspace = Split-Path (Split-Path $repo -Parent) -Parent
        $Source = Join-Path $workspace "DATA\WasmBridge"
    }
}
if ([String]::IsNullOrEmpty($Destination)) {
    $Destination = Join-Path $repo "Toolchain"
}

$backtick = [string][char]96
if ($Source.Trim() -eq $backtick -or $Destination.Trim() -eq $backtick) {
    throw "A literal backtick was passed as a path. From cmd.exe, run Import-Toolchain.ps1 on one line (or use ^ for cmd continuation), not PowerShell backticks."
}

# Only deterministic build/validation dependencies belong in the SDK toolchain.
# A live Firefox profile is intentionally not imported: it is mutable browser
# state (cookies/cache/history/locks), is not consumed by WasmBridge scripts,
# and the authoritative Firefox 52 acceptance run is performed on the XP host.
$requiredDirectories = @(
    "binaryen-version_133",
    "emsdk",
    "esbuild-0.28.2",
    "wabt-1.0.42"
)

$requiredFiles = @(
    "binaryen-version_133\bin\wasm-opt.exe",
    "binaryen-version_133\bin\wasm2js.exe",
    "esbuild-0.28.2\esbuild.exe",
    "wabt-1.0.42\bin\wasm-validate.exe"
)

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Toolchain source directory not found: $Source"
}
foreach ($relative in $requiredDirectories) {
    $path = Join-Path $Source $relative
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "Toolchain component missing: $path"
    }
}
foreach ($relative in $requiredFiles) {
    $path = Join-Path $Source $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required tool missing: $path"
    }
}

$readme = Join-Path $Destination "README.md"
$preservedReadme = $null
if (Test-Path -LiteralPath $readme -PathType Leaf) {
    $preservedReadme = Get-Content -LiteralPath $readme -Raw
}

if ($Clean -and (Test-Path -LiteralPath $Destination)) {
    $resolvedDestination = [IO.Path]::GetFullPath($Destination)
    $resolvedRepo = [IO.Path]::GetFullPath($repo)
    if (-not $resolvedDestination.StartsWith($resolvedRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a destination outside the repository: $resolvedDestination"
    }
    Remove-Item -LiteralPath $Destination -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

foreach ($relative in $requiredDirectories) {
    $from = Join-Path $Source $relative
    $to = Join-Path $Destination $relative
    New-Item -ItemType Directory -Force -Path $to | Out-Null

    # Keep everything required to execute the pinned toolchain, but omit
    # development-only/static-link artifacts that WasmBridge never consumes.
    # Binaryen's binaryen.lib is ~472 MiB and is not used because WasmBridge
    # invokes wasm-opt.exe and wasm2js.exe as external tools.
    & robocopy $from $to /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP `
        /XD .git .cache __pycache__ .pytest_cache node_modules `
        /XF .gitignore .gitattributes *.pyc *.tmp *.log binaryen.lib
    $code = $LASTEXITCODE
    if ($code -gt 7) {
        throw "robocopy failed for $relative with exit code $code."
    }
}

if ($preservedReadme -ne $null) {
    [IO.File]::WriteAllText($readme, $preservedReadme, (New-Object Text.UTF8Encoding($false)))
}
elseif (-not (Test-Path -LiteralPath $readme)) {
    @'
# WasmBridge bundled toolchain

This directory contains the pinned host-side dependencies used to build and validate WasmBridge.
'@ | Set-Content -LiteralPath $readme -Encoding UTF8
}

Write-Host "WasmBridge toolchain imported."
Write-Host "  Source:      $Source"
Write-Host "  Destination: $Destination"
Write-Host "Run Tools\Test-All.ps1 -SkipFirefox to validate the bundled host toolchain."
$global:LASTEXITCODE = 0
