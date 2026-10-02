param(
    [switch]$SkipFirefox,
    [string]$Firefox = "C:\CODEX\Mozilla Firefox\firefox.exe",
    [string]$ToolRoot = "C:\CODEX\TOOLS\WasmBridge",
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("wasmbridge-validation-" + [Guid]::NewGuid().ToString("N"))
$server = $null
$startedFirefox = $false

function Assert-Exit([string]$Label) {
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
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

    & (Join-Path $PSScriptRoot "Test-ExternalToolchain.ps1") -ToolRoot $ToolRoot -OutputDirectory (Join-Path $temporary "external")
    Assert-Exit "External toolchain tests"

    $esbuild = Join-Path $ToolRoot "esbuild-0.28.2\esbuild.exe"
    Get-ChildItem -LiteralPath (Join-Path $repo "Runtime") -Filter "*.js" | Sort-Object Name | ForEach-Object {
        $output = Join-Path $temporary ($_.Name + ".firefox52.js")
        & $esbuild $_.FullName --bundle --target=firefox52 "--outfile=$output"
        Assert-Exit ("Firefox 52 syntax: " + $_.Name)
    }

    if (-not $SkipFirefox) {
        if (-not (Test-Path -LiteralPath $Firefox)) { throw "Firefox executable not found: $Firefox" }
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
            "Examples/BufferArena/generated-fallback-probe.html",
            "Examples/GeneralModule/index.html",
            "Examples/GeneralModule/index.html?fallback=1",
            "Examples/PackageLoader/index.html",
            "Examples/PackageLoader/index.html?fallback=1"
        )
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
