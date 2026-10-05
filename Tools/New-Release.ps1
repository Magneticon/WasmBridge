[CmdletBinding()]
param(
    [string]$Version,
    [string]$OutputDirectory,
    [ValidateSet("Both", "Complete", "Runtime")]
    [string]$Flavor = "Both",
    [switch]$SkipValidation,
    [switch]$RuntimeOnly
)

$ErrorActionPreference = "Stop"

# Do not use $PSScriptRoot in parameter default expressions. Windows PowerShell
# can evaluate those defaults before $PSScriptRoot has been populated, notably
# when the script is launched through powershell.exe -File from cmd.exe.
$scriptPath = $MyInvocation.MyCommand.Path
if ([String]::IsNullOrEmpty($scriptPath)) { throw "Unable to determine New-Release.ps1 path." }
$scriptDirectory = Split-Path -Parent $scriptPath
$repo = Split-Path -Parent $scriptDirectory
if ([String]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content -LiteralPath (Join-Path $repo "VERSION") -Raw).Trim()
}
if ([String]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repo "artifacts"
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must use major.minor.patch." }
if ($RuntimeOnly) {
    if ($PSBoundParameters.ContainsKey("Flavor") -and $Flavor -ne "Runtime") { throw "-RuntimeOnly cannot be combined with -Flavor $Flavor. Use -Flavor Runtime instead." }
    $Flavor = "Runtime"
}
if (-not $SkipValidation) {
    & (Join-Path $scriptDirectory "Test-All.ps1") -SkipFirefox
    if ($LASTEXITCODE -ne 0) { throw "Validation failed." }
}

$artifactRoot = [IO.Path]::GetFullPath($OutputDirectory)
$repoRoot = [IO.Path]::GetFullPath($repo)
if (-not $artifactRoot.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "OutputDirectory must be inside the repository." }
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
$sourceCommit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [String]::IsNullOrEmpty($sourceCommit)) { throw "Unable to determine the source Git commit." }
$requiredToolchain = @("binaryen-version_133", "emsdk", "esbuild-0.28.2", "wabt-1.0.42")

function Assert-SafeTarget([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe release target: $resolved" }
    return $resolved
}
function Copy-ReleaseFile([string]$Stage, [string]$Source, [string]$RelativeDestination) {
    $sourcePath = Join-Path $repo $Source
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Release input missing: $Source" }
    $destination = Join-Path $Stage $RelativeDestination
    $parent = Split-Path $destination -Parent
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Copy-Item -LiteralPath $sourcePath -Destination $destination -Force
}
function Copy-TrackedTree([string]$Stage, [string]$Tree) {
    $paths = @(& git -C $repo -c core.quotepath=false ls-files -- $Tree)
    if ($LASTEXITCODE -ne 0) { throw "git ls-files failed for $Tree." }
    if ($paths.Count -eq 0) { throw "Tracked release tree is empty or missing: $Tree" }
    foreach ($relative in $paths) {
        if ([String]::IsNullOrWhiteSpace($relative)) { continue }
        $normalized = $relative.Replace('\', '/')
        # A historical CODEX tools directory contained a live Firefox profile.
        # It is mutable browser state, is not consumed by WasmBridge, and must
        # never enter release archives even if an older checkout tracks it.
        if ($normalized.StartsWith("Toolchain/Firefox52-TestProfile/", [StringComparison]::OrdinalIgnoreCase)) { continue }
        Copy-ReleaseFile $Stage $relative $relative
    }
}
function Copy-RuntimeBinaries([string]$Stage, [bool]$IncludeDevelopmentFiles) {
    foreach ($architecture in @("x86", "x64")) {
        $sourceDirectory = Join-Path $repo ("bin\Release\WXP\" + $architecture)
        if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) { throw "Built $architecture output is missing: $sourceDirectory" }
        foreach ($file in @("WasmBridge.exe", "WasmBridge.Core.dll", "WasmBridge.Native.dll")) { Copy-ReleaseFile $Stage ("bin\Release\WXP\$architecture\$file") ("bin\$architecture\$file") }
        if ($IncludeDevelopmentFiles) {
            Get-ChildItem -LiteralPath $sourceDirectory -File | Sort-Object Name | ForEach-Object {
                if ($_.Name -notin @("WasmBridge.exe", "WasmBridge.Core.dll", "WasmBridge.Native.dll")) {
                    $destination = Join-Path $Stage ("bin\$architecture\" + $_.Name)
                    New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
                    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
                }
            }
        }
    }
}
function Add-SamplePackages([string]$Stage) {
    $cli = Join-Path $repo "bin\Release\WXP\x64\WasmBridge.exe"
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw "x64 WasmBridge.exe is required to create release sample packages." }
    $bufferPackage = Join-Path $Stage "packages\BufferArena"
    & $cli package --wasm (Join-Path $repo "Examples\BufferArena\buffers.wasm") --fallback (Join-Path $repo "Examples\BufferArena\buffers-fallback.js") --runtime (Join-Path $repo "Runtime\wasmbridge.js") --module-runtime (Join-Path $repo "Runtime\module.js") --out $bufferPackage --export "wb_active_count,wb_invert_rgba" --allocator "wb_alloc,wb_free,wb_capacity" --memory-export "memory" --fallback-global "WasmBridgeBuffersFallback" --signatures (Join-Path $repo "Examples\BufferArena\signatures.json") | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "BufferArena package creation failed." }
    & $cli verify-package --manifest (Join-Path $bufferPackage "manifest.json") | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "BufferArena package verification failed." }
    $helloPackage = Join-Path $Stage "packages\HelloWorld"
    & $cli package --wasm (Join-Path $repo "Examples\HelloWorld\add.wasm") --fallback (Join-Path $repo "Examples\HelloWorld\add.js") --runtime (Join-Path $repo "Runtime\wasmbridge.js") --out $helloPackage --export "add" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "HelloWorld package creation failed." }
    & $cli verify-package --manifest (Join-Path $helloPackage "manifest.json") | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "HelloWorld package verification failed." }
}
function Add-ReleaseManifest([string]$Stage, [string]$ReleaseFlavor, [bool]$BundledToolchain) {
    $files = @()
    Get-ChildItem -LiteralPath $Stage -File -Recurse | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($Stage.Length + 1).Replace('\', '/')
        $files += [ordered]@{ path=$relative; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
    }
    [ordered]@{ version=$Version; flavor=$ReleaseFlavor; target="Windows XP x86/x64; .NET Framework 4.0; Firefox 52.9 ESR wasm32; optional modern memory64"; bundledToolchain=$BundledToolchain; sourceCommit=$sourceCommit; validationRecord="Documentation/VALIDATION_0.8.0.md"; files=$files } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Stage "release-manifest.json") -Encoding UTF8
}
function Write-DeterministicZip([string]$Stage, [string]$Name, [string]$ZipPath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fixedTime = [DateTimeOffset]::new(2026, 10, 4, 0, 0, 0, [TimeSpan]::Zero)
    $stream = [IO.File]::Create($ZipPath)
    try {
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            Get-ChildItem -LiteralPath $Stage -File -Recurse | Sort-Object FullName | ForEach-Object {
                $relative = $_.FullName.Substring($Stage.Length + 1).Replace('\', '/')
                $entry = $archive.CreateEntry(($Name + "/" + $relative), [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $fixedTime
                $input = [IO.File]::OpenRead($_.FullName); $output = $entry.Open()
                try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
}
function Initialize-Stage([string]$Name) {
    $stage = Assert-SafeTarget (Join-Path $artifactRoot $Name)
    $zip = Assert-SafeTarget (Join-Path $artifactRoot ($Name + ".zip"))
    $checksum = Assert-SafeTarget ($zip + ".sha256")
    foreach ($target in @($stage, $zip, $checksum)) { if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force } }
    New-Item -ItemType Directory -Path $stage | Out-Null
    return [ordered]@{ stage=$stage; zip=$zip; checksum=$checksum; name=$Name }
}
function Add-CommonMetadata([string]$Stage) {
    foreach ($file in @("README.md", "CHANGELOG.md", "VERSION", "LICENSE", "THIRD_PARTY_NOTICES.md")) { Copy-ReleaseFile $Stage $file $file }
    Copy-TrackedTree $Stage "Documentation"
}
function Build-CompleteRelease {
    foreach ($relative in $requiredToolchain) {
        $path = Join-Path (Join-Path $repo "Toolchain") $relative
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Bundled toolchain is incomplete: Toolchain\$relative." }
    }
    $r = Initialize-Stage ("WasmBridge-" + $Version + "-Complete")
    Add-CommonMetadata $r.stage
    Copy-ReleaseFile $r.stage "WasmBridge.sln" "WasmBridge.sln"
    foreach ($tree in @("CLI", "Compiler", "Core", "Native", "Runtime", "Tests", "Tools", "Examples", "Toolchain")) { Copy-TrackedTree $r.stage $tree }
    Copy-RuntimeBinaries $r.stage $true
    Add-SamplePackages $r.stage | Out-Host
    Add-ReleaseManifest $r.stage "Complete" $true
    Write-DeterministicZip $r.stage $r.name $r.zip
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $r.zip).Hash.ToLowerInvariant()
    ("$hash  " + (Split-Path $r.zip -Leaf)) | Set-Content -LiteralPath $r.checksum -Encoding ASCII
    return [ordered]@{ flavor="Complete"; zip=$r.zip; checksum=$r.checksum; sha256=$hash }
}
function Build-RuntimeRelease {
    $r = Initialize-Stage ("WasmBridge-" + $Version + "-Runtime")
    Add-CommonMetadata $r.stage
    Copy-TrackedTree $r.stage "Runtime"
    Get-ChildItem -LiteralPath (Join-Path $repo "Core") -Filter "*.h" -File | Sort-Object Name | ForEach-Object { Copy-ReleaseFile $r.stage ("Core\" + $_.Name) ("include\" + $_.Name) }
    foreach ($tree in @("Examples/HelloWorld", "Examples/BufferArena", "Examples/PackageLoader", "Examples/WasmSelfTest")) { Copy-TrackedTree $r.stage $tree }
    Copy-ReleaseFile $r.stage "Tools\Serve-Examples.js" "Tools\Serve-Examples.js"
    Copy-RuntimeBinaries $r.stage $false
    Add-SamplePackages $r.stage | Out-Host
    Add-ReleaseManifest $r.stage "Runtime" $false
    Write-DeterministicZip $r.stage $r.name $r.zip
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $r.zip).Hash.ToLowerInvariant()
    ("$hash  " + (Split-Path $r.zip -Leaf)) | Set-Content -LiteralPath $r.checksum -Encoding ASCII
    return [ordered]@{ flavor="Runtime"; zip=$r.zip; checksum=$r.checksum; sha256=$hash }
}

$results = @()
if ($Flavor -eq "Both" -or $Flavor -eq "Complete") { $results += Build-CompleteRelease }
if ($Flavor -eq "Both" -or $Flavor -eq "Runtime") { $results += Build-RuntimeRelease }
$sumsPath = Join-Path $artifactRoot ("WasmBridge-" + $Version + "-SHA256SUMS.txt")
if (Test-Path -LiteralPath $sumsPath) { Remove-Item -LiteralPath $sumsPath -Force }
$results | ForEach-Object { ($_.sha256 + "  " + (Split-Path $_.zip -Leaf)) } | Set-Content -LiteralPath $sumsPath -Encoding ASCII
Write-Host ""
Write-Host "WasmBridge $Version release artifacts:"
foreach ($result in $results) { Write-Host ("  " + $result.flavor + ": " + $result.zip); Write-Host ("    SHA-256: " + $result.sha256) }
Write-Host ("  Combined checksums: " + $sumsPath)
