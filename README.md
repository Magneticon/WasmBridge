# WasmBridge

Reusable WebAssembly compilation, packaging, and browser-runtime framework. The baseline browser is **Firefox 52 on Windows XP x64** (32-bit browser process), with additional support for newer browsers and a matching JavaScript fallback.

**Windows builds are XP-only.** Use Visual Studio 2022 with the traditional `WasmBridge.sln` (no .slnx), native `v141_xp`, .NET Framework 4.0, and x86/x64 configurations. The Windows 10 workstation is the build host; there is no separate W10 build/run configuration or repository-local build CMD script.

## Status

- The user verified the numeric `add(20,22) = 42` sample running on **Wasm** and with **forced JavaScript fallback** in Firefox 52 on Windows XP x64. On the tested installation, the page also loaded through `file://`. The user also verified the 256×160 RGBA demo with the Wasm backend, JS fallback, bytewise parity and unchanged input on XP Firefox 52.
- The XP x64 CLI build and managed header-parser self-test passed. The latest recorded XP CLI run could not load `WasmBridge.Native.dll` (0x8007007E); the native DLL's availability/dependencies on the XP machine require investigation. A v0.3 build/run is pending.
- The managed CLI `WasmBridge.exe` uses the managed API `WasmBridge.Core.dll` (namespace `WasmBridge`) to avoid the original CLR assembly-name collision. `WasmBridge.Native.dll` is the separate XP-native sample library.
- The fixed-buffer v0.2 RGBA browser test passed on XP Firefox 52 with both backends. The new v0.3 dynamic-memory sample is not yet XP-browser verified.

## v0.3 — dynamically managed independent buffers

- `Examples/BufferArena/index.html`: **new** Firefox 52 test for independently owned buffers, release/reuse, retained data across memory growth, 64–1024 pixel RGBA images, Wasm/JS parity, and end-to-end timing.
- `Runtime/buffers.js`: reusable JS API: `allocate(bytes)`, `write(handle, typedArray)`, `read(handle, bytes)`, `release(handle)`, `invertRGBA(source, destination, width, height)`, `processRGBA(pixels, width, height)`, and `statistics()`.
- `Core/buffers.c` and `Core/buffers.h`: shared native XP and wasm32 allocator/processing functions. `Examples/BufferArena/buffers.wasm` is the matching precompiled wasm32 module; `buffers-fallback.js` provides the same public C-level ABI in JavaScript.
- `Tests/test_buffers_node.js` and `Tests/test_buffers_native.c`: developer-host regression tests; the XP runner also attempts independent native buffer tests and an end-to-end native benchmark.

The current allocator is a deliberately **bounded prototype**, not a drop-in libc malloc: at most 128 tracked blocks, 32 MiB Wasm linear-memory budget (16 MiB maximum single JS buffer), first-fit free-block reuse without coalescing or shrinking, and synchronous access. Never retain views into Wasm memory across growth or reuse a released handle. Browser benchmarks measure allocation, memory copies, and processing; the XP-native CLI benchmark is reported separately and is not an apples-to-apples browser speed ranking.

## Samples and components

- `Examples/HelloWorld/index.html`: existing numeric Wasm/JS test.
- `Examples/ImageProcessing/index.html`: **new** RGBA8 → inverted image demo, generated test image or uploaded image (scaled to at most 512×512), two HTML canvases, comparison with a JS reference, backend/diagnostic display, and forced JS fallback.
- `Core/image.c`, `Core/image.h`: portable C RGBA8 algorithm used by both the native DLL and wasm32 module.
- `Runtime/rgba.js`: module-memory adapter exposing `processRGBA(pixelArray, width, height)` and returning an independent `Uint8ClampedArray`.
- `Examples/ImageProcessing/rgba-fallback.js`: JS backend with an equivalent bounded scratch-buffer ABI.
- `Runtime/wasmbridge.js`: existing Wasm loader, with optional `validateWasm` hook for memory/export ABI checks before choosing a backend.
- `Tests/test_rgba_node.js` and `Tests/test_native.c`: optional development-host correctness tests. These do not replace XP testing.

The RGBA demo supports tightly packed, row-major RGBA8 buffers, 1–512 pixels per dimension, in-place RGB inversion and unchanged alpha. The module owns one reusable scratch buffer (no malloc/free); the adapter copies input/output to avoid exposing mutable Wasm memory outside a synchronous call. Separate concurrent instances need their own memory or serialized calls.

See [Documentation/GETTING_STARTED.md](Documentation/GETTING_STARTED.md) for build prerequisites and manual XP/Firefox image tests. The operator's existing external AIEXE/MSBuild workflow handles compilation and XP runs; `AI_RUN_WXP.bat` requires the managed header parser, XP-native RGBA8 and independent-buffer test PASS markers.

WasmBridge is independent of MIRAE and ATALANTA WebUI.
