param(
    [string]$Version = $(Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) "VERSION") -Raw).Trim(),
    [string]$OutputDirectory = $(Join-Path (Split-Path $PSScriptRoot -Parent) "artifacts"),
    [switch]$SkipValidation
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must use major.minor.patch." }
if (-not $SkipValidation) { & (Join-Path $PSScriptRoot "Test-All.ps1") }

$artifactRoot = [IO.Path]::GetFullPath($OutputDirectory)
$repoRoot = [IO.Path]::GetFullPath($repo)
if (-not $artifactRoot.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must be inside the repository."
}

$name = "WasmBridge-$Version"
$stage = Join-Path $artifactRoot $name
$zip = Join-Path $artifactRoot ($name + ".zip")
$checksum = $zip + ".sha256"
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
foreach ($target in @($stage, $zip, $checksum)) {
    $resolved = [IO.Path]::GetFullPath($target)
    if (-not $resolved.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe release target: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
New-Item -ItemType Directory -Path $stage | Out-Null

function Copy-ReleaseFile([string]$Source, [string]$RelativeDestination) {
    $sourcePath = Join-Path $repo $Source
    if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Release input missing: $Source" }
    $destination = Join-Path $stage $RelativeDestination
    New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destination -Force
}

foreach ($architecture in @("x86", "x64")) {
    foreach ($file in @("WasmBridge.exe", "WasmBridge.Core.dll", "WasmBridge.Native.dll")) {
        Copy-ReleaseFile "bin\Release\WXP\$architecture\$file" "bin\$architecture\$file"
    }
}
Get-ChildItem -LiteralPath (Join-Path $repo "Runtime") -Filter "*.js" | Sort-Object Name | ForEach-Object {
    Copy-ReleaseFile ("Runtime\" + $_.Name) ("Runtime\" + $_.Name)
}
foreach ($file in @(
    "README.md", "CHANGELOG.md", "VERSION", "LICENSE", "THIRD_PARTY_NOTICES.md",
    "Documentation\GETTING_STARTED.md", "Documentation\FF52_COMPATIBILITY.md", "Documentation\API_REFERENCE.md",
    "Examples\HelloWorld\index.html", "Examples\HelloWorld\add.wasm", "Examples\HelloWorld\add.js",
    "Examples\EmscriptenHelloWorld\index.html", "Examples\EmscriptenHelloWorld\add.wasm",
    "Examples\ImageProcessing\index.html", "Examples\ImageProcessing\rgba.wasm", "Examples\ImageProcessing\rgba-fallback.js",
    "Examples\BufferArena\index.html", "Examples\BufferArena\generated-fallback-probe.html",
    "Examples\BufferArena\buffers.wasm", "Examples\BufferArena\buffers-fallback.js",
    "Examples\BufferArena\buffers-generated-candidate.js", "Examples\BufferArena\buffers-generated-candidate.json",
    "Examples\BufferArena\signatures.json", "Examples\GeneralModule\index.html",
    "Examples\PackageLoader\index.html", "Examples\PackageLoader\manifest.json"
)) { Copy-ReleaseFile $file $file }

$cli = Join-Path $repo "bin\Release\WXP\x64\WasmBridge.exe"
$bufferPackage = Join-Path $stage "packages\BufferArena"
& $cli package `
    --wasm (Join-Path $repo "Examples\BufferArena\buffers.wasm") `
    --fallback (Join-Path $repo "Examples\BufferArena\buffers-fallback.js") `
    --runtime (Join-Path $repo "Runtime\wasmbridge.js") `
    --module-runtime (Join-Path $repo "Runtime\module.js") `
    --out $bufferPackage `
    --export "wb_active_count,wb_invert_rgba" `
    --allocator "wb_alloc,wb_free,wb_capacity" `
    --memory-export "memory" `
    --fallback-global "WasmBridgeBuffersFallback" `
    --signatures (Join-Path $repo "Examples\BufferArena\signatures.json")
if ($LASTEXITCODE -ne 0) { throw "BufferArena package creation failed." }
& $cli verify-package --manifest (Join-Path $bufferPackage "manifest.json")
if ($LASTEXITCODE -ne 0) { throw "BufferArena release package verification failed." }

$helloPackage = Join-Path $stage "packages\HelloWorld"
& $cli package `
    --wasm (Join-Path $repo "Examples\HelloWorld\add.wasm") `
    --fallback (Join-Path $repo "Examples\HelloWorld\add.js") `
    --runtime (Join-Path $repo "Runtime\wasmbridge.js") `
    --out $helloPackage --export "add"
if ($LASTEXITCODE -ne 0) { throw "HelloWorld package creation failed." }
& $cli verify-package --manifest (Join-Path $helloPackage "manifest.json")
if ($LASTEXITCODE -ne 0) { throw "HelloWorld release package verification failed." }

$files = @()
Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    $files += [ordered]@{path=$relative; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()}
}
$releaseManifest = [ordered]@{
    version = $Version
    target = "Windows XP x86/x64; .NET Framework 4.0; Firefox 52.9 ESR"
    sourceCommit = (& git -C $repo rev-parse HEAD).Trim()
    files = $files
}
$releaseManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage "release-manifest.json") -Encoding UTF8

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fixedTime = [DateTimeOffset]::new(2026, 9, 28, 0, 0, 0, [TimeSpan]::Zero)
$stream = [IO.File]::Create($zip)
try {
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
    try {
        Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
            $relative = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
            $entry = $archive.CreateEntry(($name + "/" + $relative), [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $fixedTime
            $input = [IO.File]::OpenRead($_.FullName)
            $output = $entry.Open()
            try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
        }
    }
    finally { $archive.Dispose() }
}
finally { $stream.Dispose() }

$zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
("$zipHash  " + (Split-Path $zip -Leaf)) | Set-Content -LiteralPath $checksum -Encoding ASCII
Write-Host "Release archive: $zip"
Write-Host "SHA-256: $zipHash"
