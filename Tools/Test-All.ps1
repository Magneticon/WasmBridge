param(
    [switch]$SkipFirefox,
    [string]$Firefox,
    [string]$ToolRoot,
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if ([String]::IsNullOrEmpty($ToolRoot)) {
    $ToolRoot = $(if ($env:WASMBRIDGE_TOOLS) { $env:WASMBRIDGE_TOOLS } else { Join-Path $repo "Toolchain" })
}
if ([String]::IsNullOrEmpty($Firefox)) {
    $bundledFirefox = Join-Path $ToolRoot "Firefox52\firefox.exe"
    $Firefox = $(if (Test-Path -LiteralPath $bundledFirefox) { $bundledFirefox } else { "C:\CODEX\Mozilla Firefox\firefox.exe" })
}
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("wasmbridge-validation-" + [Guid]::NewGuid().ToString("N"))
$server = $null
$startedFirefox = $false

function Assert-Exit([string]$Label) {
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

function Resolve-WasmBridgeTool([string]$Name, [string]$RelativePath) {
    $portable = Join-Path $ToolRoot $RelativePath
    if (Test-Path -LiteralPath $portable) { return $portable }
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}

function Get-FirefoxMajorVersion([string]$Path) {
    $info = (Get-Item -LiteralPath $Path).VersionInfo
    $versionText = $info.ProductVersion
    if ([String]::IsNullOrEmpty($versionText)) { $versionText = $info.FileVersion }
    $match = [regex]::Match(($versionText + ""), '^\s*(\d+)')
    if (-not $match.Success) { return -1 }
    return [int]$match.Groups[1].Value
}

function Invoke-FirefoxPage([string]$RelativeUrl) {
    $url = "http://127.0.0.1:$Port/$RelativeUrl"
    & $Firefox -no-remote -profile (Join-Path $ToolRoot "Firefox52-TestProfile") -new-window $url
    $script:startedFirefox = $true
    $deadline = (Get-Date).AddSeconds(30)
    $match = $null
    do {
        Start-Sleep -Milliseconds 500
        $titles = @(Get-Process firefox -ErrorAction SilentlyContinue | Select-Object -ExpandProperty MainWindowTitle)
        $match = $titles | Where-Object { $_ -like "PASS -*" -or $_ -like "FAIL -*" -or $_ -like "PENDING -*" } | Select-Object -First 1
    } while (-not $match -and (Get-Date) -lt $deadline)
    if (-not $match) { throw "Firefox page timed out: $url; titles: $($titles -join ' | ')" }
    Write-Host $match
    Get-Process firefox -ErrorAction SilentlyContinue | Stop-Process
    $script:startedFirefox = $false
    Start-Sleep -Milliseconds 500
    if ($match -notlike "PASS -*") { throw "Firefox acceptance failed: $match" }
}

try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    & (Join-Path $PSScriptRoot "Check-Environment.ps1") -ToolRoot $ToolRoot
    Assert-Exit "Environment check"

    foreach ($architecture in @("x64", "x86")) {
        & (Join-Path $PSScriptRoot "Build-Host.ps1") -Architecture $architecture
        Assert-Exit "$architecture build"
        $cli = Join-Path $repo "bin\Release\WXP\$architecture\WasmBridge.exe"
        & $cli self-test
        Assert-Exit "$architecture self-test"
        & (Join-Path $repo "Tests\test_package.ps1") -Cli $cli
    }

    & (Join-Path $repo "Tests\test_emscripten_backend.ps1") `
        -Cli (Join-Path $repo "bin\Release\WXP\x64\WasmBridge.exe")
    Assert-Exit "Emscripten backend contract"

    Get-ChildItem -LiteralPath (Join-Path $repo "Tests") -Filter "test_*_node.js" | Sort-Object Name | ForEach-Object {
        & node $_.FullName
        Assert-Exit $_.Name
    }

    $validator = Resolve-WasmBridgeTool 'wasm-validate.exe' 'wabt-1.0.42\bin\wasm-validate.exe'
    $optimizer = Resolve-WasmBridgeTool 'wasm-opt.exe' 'binaryen-version_133\bin\wasm-opt.exe'
    $wasm2js = Resolve-WasmBridgeTool 'wasm2js.exe' 'binaryen-version_133\bin\wasm2js.exe'
    $esbuild = Resolve-WasmBridgeTool 'esbuild.exe' 'esbuild-0.28.2\esbuild.exe'

    if ($validator -and $optimizer -and $wasm2js -and $esbuild) {
        & (Join-Path $PSScriptRoot "Test-ExternalToolchain.ps1") -ToolRoot $ToolRoot -OutputDirectory (Join-Path $temporary "external")
        Assert-Exit "External toolchain tests"
    }
    else {
        $missing = @()
        if (-not $validator) { $missing += 'wasm-validate.exe' }
        if (-not $optimizer) { $missing += 'wasm-opt.exe' }
        if (-not $wasm2js) { $missing += 'wasm2js.exe' }
        if (-not $esbuild) { $missing += 'esbuild.exe' }
        Write-Host ("SKIP: bundled WABT/Binaryen/esbuild validation unavailable: " + ($missing -join ', ') +
            ". Run Tools\Import-Toolchain.ps1 or supply -ToolRoot explicitly.")
    }

    if ($esbuild) {
        Get-ChildItem -LiteralPath (Join-Path $repo "Runtime") -Filter "*.js" | Sort-Object Name | ForEach-Object {
            $output = Join-Path $temporary ($_.Name + ".firefox52.js")
            & $esbuild $_.FullName --bundle --target=firefox52 "--outfile=$output"
            Assert-Exit ("Firefox 52 syntax: " + $_.Name)
        }
    }
    else {
        Write-Host "SKIP: Firefox 52 esbuild syntax gate unavailable because bundled esbuild.exe was not found."
    }

    if (-not $SkipFirefox) {
        if (-not (Test-Path -LiteralPath $Firefox)) { throw "Firefox executable not found: $Firefox" }
        $firefoxMajor = Get-FirefoxMajorVersion $Firefox
        if ($firefoxMajor -ne 52) {
            $versionInfo = (Get-Item -LiteralPath $Firefox).VersionInfo
            $detected = $versionInfo.ProductVersion
            if ([String]::IsNullOrEmpty($detected)) { $detected = $versionInfo.FileVersion }
            throw "Legacy browser acceptance requires Firefox 52.x, but '$Firefox' is version $detected. Run this host matrix with -SkipFirefox, then run the browser acceptance pages on the XP Firefox 52.9 ESR machine via the documented 192.168.255.2:8084 endpoint."
        }
        if (Get-Process firefox -ErrorAction SilentlyContinue) {
            throw "Firefox is already running; close it before the isolated acceptance matrix."
        }
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $Port is already in use."
        }
        $profile = Join-Path $ToolRoot "Firefox52-TestProfile"
        New-Item -ItemType Directory -Force -Path $profile | Out-Null
        @(
            'user_pref("javascript.options.wasm", true);',
            'user_pref("browser.sessionstore.resume_from_crash", false);',
            'user_pref("toolkit.startup.max_resumed_crashes", -1);',
            'user_pref("browser.shell.checkDefaultBrowser", false);',
            'user_pref("browser.tabs.warnOnClose", false);'
        ) | Set-Content -LiteralPath (Join-Path $profile "user.js") -Encoding ASCII

        $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
        $server = Start-Process -FilePath $nodePath `
            -ArgumentList (Join-Path $PSScriptRoot "Serve-Examples.js"),$Port `
            -WorkingDirectory $repo -WindowStyle Hidden -PassThru
        Start-Sleep -Milliseconds 750
        if ($server.HasExited) { throw "Example server exited before browser tests." }

        $pages = @(
            "Examples/WasmSelfTest/index.html",
            "Examples/HelloWorld/index.html",
            "Examples/HelloWorld/index.html?fallback=1",
            "Examples/EmscriptenHelloWorld/index.html",
            "Examples/ImageProcessing/index.html",
            "Examples/ImageProcessing/index.html?fallback=1",
            "Examples/BufferArena/index.html",
            "Examples/BufferArena/index.html?fallback=1",
            "Examples/GeneralModule/index.html",
            "Examples/GeneralModule/index.html?fallback=1",
            "Examples/PackageLoader/index.html",
            "Examples/PackageLoader/index.html?fallback=1"
        )

        $candidateMetadataPath = Join-Path $repo "Examples\BufferArena\buffers-generated-candidate.json"
        $bufferWasmPath = Join-Path $repo "Examples\BufferArena\buffers.wasm"
        if ((Test-Path -LiteralPath $candidateMetadataPath) -and (Test-Path -LiteralPath $bufferWasmPath)) {
            $candidateMetadata = Get-Content -LiteralPath $candidateMetadataPath -Raw | ConvertFrom-Json
            $currentWasmHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $bufferWasmPath).Hash.ToLowerInvariant()
            if ($candidateMetadata.inputSha256 -eq $currentWasmHash) {
                $pages += "Examples/BufferArena/generated-fallback-probe.html"
            }
            else {
                Write-Host "SKIP: checked-in generated-fallback browser probe is stale for the current buffers.wasm."
            }
        }

        foreach ($page in $pages) { Invoke-FirefoxPage $page }
    }

    Write-Host "PASS: complete WasmBridge validation matrix."
}
finally {
    if ($startedFirefox -or (Get-Process firefox -ErrorAction SilentlyContinue)) {
        Get-Process firefox -ErrorAction SilentlyContinue | Stop-Process
    }
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
    $resolvedTemp = [System.IO.Path]::GetFullPath($temporary)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $resolvedTemp)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}
