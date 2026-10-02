param(
    [string]$LlvmRoot = $(if ($env:WASMBRIDGE_LLVM) { $env:WASMBRIDGE_LLVM } else { 'C:\clang+llvm-18.1.8-x86_64-pc-windows-msvc' }),
    [string]$ToolRoot = $(if ($env:WASMBRIDGE_TOOLS) { $env:WASMBRIDGE_TOOLS } else { 'C:\CODEX\TOOLS\WasmBridge' }),
    [switch]$Json
)

$ErrorActionPreference = 'Stop'

function Find-Vs2022 {
    $vswhere = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { return $null }
    & $vswhere -latest -products '*' -version '[17.0,18.0)' -property installationPath 2>$null
}

function Get-PeArchitecture([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        $stream.Position = 0x3c
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset + 4
        switch ($reader.ReadUInt16()) {
            0x014c { 'x86' }
            0x8664 { 'x64' }
            default { 'unknown' }
        }
    } finally {
        $stream.Dispose()
    }
}

$vsRoot = Find-Vs2022
$msbuild = if ($vsRoot) { Join-Path $vsRoot 'MSBuild\Current\Bin\MSBuild.exe' } else { $null }
$clang = Join-Path $LlvmRoot 'bin\clang.exe'
$wasmLd = Join-Path $LlvmRoot 'bin\wasm-ld.exe'
$net40 = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Reference Assemblies\Microsoft\Framework\.NETFramework\v4.0\mscorlib.dll'
$firefoxCandidates = @(
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Mozilla Firefox\firefox.exe'),
    $(if ($env:ProgramW6432) { Join-Path $env:ProgramW6432 'Mozilla Firefox\firefox.exe' }
      else { Join-Path $env:ProgramFiles 'Mozilla Firefox\firefox.exe' })
)
$firefox = $firefoxCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
$optional = [ordered]@{}
$portableTools = @{
    'wasm-validate.exe' = (Join-Path $ToolRoot 'wabt-1.0.42\bin\wasm-validate.exe')
    'wasm2js.exe' = (Join-Path $ToolRoot 'binaryen-version_133\bin\wasm2js.exe')
    'wasm-opt.exe' = (Join-Path $ToolRoot 'binaryen-version_133\bin\wasm-opt.exe')
    'esbuild.exe' = (Join-Path $ToolRoot 'esbuild-0.28.2\esbuild.exe')
}
foreach ($name in @('wasm-validate.exe','wasm2js.exe','wasm-opt.exe','esbuild.exe')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    $optional[$name] = if ($command) { $command.Source }
        elseif (Test-Path -LiteralPath $portableTools[$name]) { $portableTools[$name] }
        else { $null }
}

$wasm32 = $false
if (Test-Path -LiteralPath $clang) {
    $wasm32 = [bool]((& $clang --print-targets 2>$null) -match '^\s*wasm32\s')
}

$report = [ordered]@{
    VisualStudio2022 = [ordered]@{ Found=[bool]$vsRoot; Root=$vsRoot; MSBuild=$(if ($msbuild -and (Test-Path -LiteralPath $msbuild)) { $msbuild } else { $null }) }
    V141Xp = [ordered]@{
        Found=$(if ($vsRoot) { Test-Path -LiteralPath (Join-Path $vsRoot 'VC\Tools\MSVC\14.16.27023\bin\Hostx64\x64\cl.exe') } else { $false })
        Windows71A=$(Test-Path -LiteralPath 'C:\Program Files (x86)\Microsoft SDKs\Windows\v7.1A\Include\Windows.h')
    }
    NetFramework40 = [ordered]@{ Found=$(Test-Path -LiteralPath $net40); ReferenceAssembly=$net40 }
    LLVM = [ordered]@{ Found=((Test-Path -LiteralPath $clang) -and (Test-Path -LiteralPath $wasmLd) -and $wasm32); Root=$LlvmRoot; Clang=$clang; WasmLd=$wasmLd; Wasm32=$wasm32 }
    Firefox = [ordered]@{
        Found=[bool]$firefox
        Path=$firefox
        Version=$(if ($firefox) { (Get-Item -LiteralPath $firefox).VersionInfo.ProductVersion } else { $null })
        Architecture=$(if ($firefox) { Get-PeArchitecture $firefox } else { $null })
    }
    Node = [ordered]@{ Found=[bool]$node; Path=$(if ($node) { $node.Source } else { $null }) }
    OptionalV04Tools = $optional
}

$requiredReady = $report.VisualStudio2022.MSBuild -and $report.V141Xp.Found -and
    $report.V141Xp.Windows71A -and $report.NetFramework40.Found -and $report.LLVM.Found

if ($Json) {
    $report['RequiredReady'] = [bool]$requiredReady
    $report | ConvertTo-Json -Depth 5
} else {
    Write-Host 'WasmBridge build-host environment'
    Write-Host ('  VS2022/MSBuild: ' + $(if ($report.VisualStudio2022.MSBuild) { 'OK' } else { 'MISSING' }))
    Write-Host ('  v141_xp + SDK 7.1A: ' + $(if ($report.V141Xp.Found -and $report.V141Xp.Windows71A) { 'OK' } else { 'MISSING' }))
    Write-Host ('  .NET Framework 4.0 references: ' + $(if ($report.NetFramework40.Found) { 'OK' } else { 'MISSING' }))
    Write-Host ('  LLVM wasm32: ' + $(if ($report.LLVM.Found) { 'OK - ' + $report.LLVM.Root } else { 'MISSING' }))
    Write-Host ('  Firefox: ' + $(if ($report.Firefox.Found) { $report.Firefox.Version + ' ' + $report.Firefox.Architecture } else { 'not found' }))
    Write-Host ('  Node host tests: ' + $(if ($report.Node.Found) { 'available' } else { 'not found' }))
    foreach ($entry in $optional.GetEnumerator()) {
        Write-Host ('  ' + $entry.Key + ': ' + $(if ($entry.Value) { $entry.Value } else { 'optional/not installed' }))
    }
}

if (-not $requiredReady) { exit 1 }
