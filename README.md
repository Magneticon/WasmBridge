# WasmBridge

Reusable WebAssembly compilation, packaging, and browser-runtime framework. The baseline browser is **Firefox 52 on Windows XP x64** (32-bit browser process), with additional support for newer browsers and a matching JavaScript fallback.

**Windows builds are XP-only.** Use Visual Studio 2022 with the traditional `WasmBridge.sln` (no .slnx), native `v141_xp`, .NET Framework 4.0, and x86/x64 configurations. The Windows 10 workstation is the build host; there is no separate W10 build/run configuration or repository-local build CMD script.

## Status

- The user verified the numeric `add(20,22) = 42` sample running on **Wasm** and with **forced JavaScript fallback** in Firefox 52 on Windows XP x64. On the tested installation, the page also loaded through `file://`. This verifies the first numeric export, not the new RGBA pipeline.
- The XP x64 CLI build and managed self-test passed. The subsequent v0.2 native RGBA extension and browser memory tests still require a fresh XP cycle.
- The managed CLI `WasmBridge.exe` uses the managed API `WasmBridge.Core.dll` (namespace `WasmBridge`) to avoid the original CLR assembly-name collision. `WasmBridge.Native.dll` is the separate XP-native sample library.
- The checked-in `Examples/ImageProcessing/rgba.wasm` was compiled from the shared C source with freestanding wasm32 Clang 17 and is intended for a Firefox 52 MVP test. Its image-buffer API and JS fallback were exercised in a developer-host Node test, **not yet in the actual XP browser**.

## Samples and components

- `Examples/HelloWorld/index.html`: existing numeric Wasm/JS test.
- `Examples/ImageProcessing/index.html`: **new** RGBA8 → inverted image demo, generated test image or uploaded image (scaled to at most 512×512), two HTML canvases, comparison with a JS reference, backend/diagnostic display, and forced JS fallback.
- `Core/image.c`, `Core/image.h`: portable C RGBA8 algorithm used by both the native DLL and wasm32 module.
- `Runtime/rgba.js`: module-memory adapter exposing `processRGBA(pixelArray, width, height)` and returning an independent `Uint8ClampedArray`.
- `Examples/ImageProcessing/rgba-fallback.js`: JS backend with an equivalent bounded scratch-buffer ABI.
- `Runtime/wasmbridge.js`: existing Wasm loader, with optional `validateWasm` hook for memory/export ABI checks before choosing a backend.
- `Tests/test_rgba_node.js` and `Tests/test_native.c`: optional development-host correctness tests. These do not replace XP testing.

The RGBA demo supports tightly packed, row-major RGBA8 buffers, 1–512 pixels per dimension, in-place RGB inversion and unchanged alpha. The module owns one reusable scratch buffer (no malloc/free); the adapter copies input/output to avoid exposing mutable Wasm memory outside a synchronous call. Separate concurrent instances need their own memory or serialized calls.

See [Documentation/GETTING_STARTED.md](Documentation/GETTING_STARTED.md) for build prerequisites and manual XP/Firefox image tests. The operator's existing external AIEXE/MSBuild workflow handles compilation and XP runs; `AI_RUN_WXP.bat` tests the managed header parser and XP-native RGBA8 implementation.

WasmBridge is independent of MIRAE and ATALANTA WebUI.
