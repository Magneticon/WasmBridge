param(
    [ValidateSet('Debug','Release')][string]$Configuration = 'Release',
    [ValidateSet('x86','x64')][string]$Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'vswhere.exe was not found.' }
$vsRoot = & $vswhere -latest -products '*' -version '[17.0,18.0)' -property installationPath
$msbuild = Join-Path $vsRoot 'MSBuild\Current\Bin\MSBuild.exe'
if (-not (Test-Path -LiteralPath $msbuild)) { throw 'VS2022 MSBuild was not found.' }

& (Join-Path $PSScriptRoot 'Check-Environment.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Required WasmBridge build-host dependencies are incomplete.' }

$platform = $Architecture
$solution = Join-Path (Split-Path $PSScriptRoot -Parent) 'WasmBridge.sln'
& $msbuild $solution /m /nologo /t:Build /p:Configuration=$Configuration /p:Platform=$platform
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Built $Configuration|$platform with v141_xp/.NET Framework 4.0."
