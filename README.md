# WasmBridge

Reusable WebAssembly compilation, packaging, and browser-runtime framework. The baseline browser is **Firefox 52 on Windows XP x64** (32-bit browser process), with additional support for newer browsers and a matching JavaScript fallback.

**Windows builds are XP-only.** Use Visual Studio 2022 with the traditional `WasmBridge.sln` (no .slnx), native `v141_xp`, .NET Framework 4.0, and x86/x64 configurations. The Windows 10 workstation is the build host; there is no separate W10 build/run configuration or repository-local build CMD script.

## Documentation

- [Programmer's Guide](Documentation/PROGRAMMING_GUIDE.md) — end-to-end programming model, ABI design, C/C++ builds, JavaScript integration/fallbacks, C# migration guidance, memory ownership, packaging, validation, testing, and troubleshooting.
- [API Reference](Documentation/API_REFERENCE.md) — concise browser API and CLI reference.
- [Getting Started](Documentation/GETTING_STARTED.md) — build-host prerequisites and setup.
- [Firefox 52 Compatibility](Documentation/FF52_COMPATIBILITY.md) — legacy JavaScript/WebAssembly compatibility rules and toolchain gates.
- [XP Firefox Test Endpoint](Documentation/XP_FIREFOX_TEST_ENDPOINT.md) — standard `192.168.255.2:8084` browser-test configuration.

## Status

- The user verified the numeric `add(20,22) = 42` sample running on **Wasm** and with **forced JavaScript fallback** in Firefox 52 on Windows XP x64. On the tested installation, the page also loaded through `file://`. The user also verified the 256×160 RGBA demo with the Wasm backend, JS fallback, bytewise parity and unchanged input on XP Firefox 52.
- A historical XP runner failed to load `WasmBridge.Native.dll` from a stale
  deployment path. The direct CODEX workflow now builds Release x86 and x64 from the controlled
  worktree, and both host-side CLI `self-test` runs load the matching native DLL
  and pass all managed/native checks. This resolves the stale deployment-path
  failure in the historical runner without using AIEXE/AI_RUN.
- The managed CLI `WasmBridge.exe` uses the managed API `WasmBridge.Core.dll` (namespace `WasmBridge`) to avoid the original CLR assembly-name collision. `WasmBridge.Native.dll` is the separate XP-native sample library.
- The v0.3 BufferArena screenshot from Firefox 52 on XP verified Wasm execution, JS parity, independent buffers, allocation release, and memory growth for the 256×256 sample. Other image sizes, new generated fallback candidates and toolchain commands remain to be tested there.

## v0.3 — dynamically managed independent buffers

- `Examples/BufferArena/index.html`: **new** Firefox 52 test for independently owned buffers, release/reuse, retained data across memory growth, 64–1024 pixel RGBA images, Wasm/JS parity, and end-to-end timing.
- `Examples/GeneralModule/index.html`: Firefox 52-facing v0.5 smoke page for
  multiple module instances, direct calls, UTF-8 strings, typed numeric copies,
  handle ownership and forced fallback.
- `Runtime/buffers.js`: reusable JS API: `allocate(bytes)`, `write(handle, typedArray)`, `read(handle, bytes)`, `writeTyped(handle, type, array)`, `readTyped(handle, type, count)`, `release(handle)`, `invertRGBA(source, destination, width, height)`, `processRGBA(pixels, width, height)`, and `statistics()`.
- `Core/buffers.c` and `Core/buffers.h`: shared native XP and wasm32 allocator/processing functions. `Examples/BufferArena/buffers.wasm` is the matching precompiled wasm32 module; `buffers-fallback.js` provides the same public C-level ABI in JavaScript.
- `Tests/test_buffers_node.js` and `Tests/test_buffers_native.c`: developer-host regression tests; the XP runner also attempts independent native buffer tests and an end-to-end native benchmark.

Typed copy access supports u8/u8c/i8/u16/i16/u32/i32/f32/f64 without handing callers a view into mutable Wasm memory. Native Release builds link the XP-compatible CRT statically to reduce external DLL dependencies; the native DLL itself must still be deployed.

The current allocator is a deliberately **bounded prototype**, not a drop-in libc malloc: at most 128 native/Wasm block descriptors, a configurable general-API live-handle limit (128 by default), 32 MiB Wasm linear-memory budget (16 MiB maximum single JS buffer), first-fit reuse with adjacent-free-block coalescing and tail reclamation, and synchronous access. Linear memory itself cannot shrink, but reclaimed address space and descriptor slots can be reused. Never retain views into Wasm memory across growth or reuse a released handle. Browser benchmarks measure allocation, memory copies, and processing; the XP-native CLI benchmark is reported separately and is not an apples-to-apples browser speed ranking.

## v0.4 — optional external toolchain and Firefox 52.9 ESR compatibility

- `Compiler/ExternalToolchain.cs` and CLI commands `validate-legacy`, `generate-fallback`, `optimize-legacy` integrate **host-installed** WABT (`wasm-validate`), Binaryen (`wasm2js`/`wasm-opt`), and standalone esbuild. They run on the Windows 10 **build host** using the existing XP/.NET 4.0 CLI. These tools are not bundled, and no repo-local build CMD scripts have been added.
- Generated JS is bundled as a classic-script IIFE for `--target=firefox52`, but **does not automatically replace the verified handwritten fallback**. ABI equivalence, memory behavior and FF52 execution must be checked with `Examples/BufferArena/generated-fallback-probe.html` before switching modules over.
- `Runtime/legacy-compat.js` is an **optional** helper with capability reporting and a narrowly scoped XHR byte-loader if `fetch` is absent; it does not override working Firefox 52 APIs or attempt to polyfill native WebAssembly.
- `Tests/test_legacy_compat_node.js` exercises the normal fetch path, optional XHR loader, and JS fallback without Wasm.

Read [Documentation/FF52_COMPATIBILITY.md](Documentation/FF52_COMPATIBILITY.md) for supported syntax, polyfill policy, toolchain setup, browser acceptance tests and the current limits of auto-generated fallbacks. The toolchain integration now passes on the development host with WABT 1.0.42, Binaryen version_133 and esbuild 0.28.2. The generated BufferArena candidate passes both its Node ABI/parity preflight and the dedicated Firefox 52 probe. It remains a recorded candidate rather than replacing the smaller reviewed fallback automatically.

## v0.5 — general multi-module API

- `Runtime/module.js` adds a reusable classic-script API over the low-level
  loader: declared function invocation, configurable allocator exports,
  independent module instances, owned handles, byte/typed copies, UTF-8
  strings, memory growth and explicit release.
- The API never returns a live view into Wasm memory. Handles are instance-owned
  and reject cross-instance use and use after release.
- Loader diagnostics now distinguish `load`, `instantiate`, `exports`, `abi`,
  `unavailable`, `configuration` and deliberately `disabled` Wasm paths while
  preserving the existing diagnostic string.
- `Tests/test_module_node.js` covers real Wasm instances, imported functions,
  direct calls, independent instances, UTF-8 strings, typed numeric buffers,
  stale/foreign handles and fallback phases.
- `Tests/test_generated_fallback_node.js` checks the recorded Binaryen/esbuild
  candidate against the handwritten BufferArena fallback. This remains a host
  preflight; `generated-fallback-probe.html` is still the Firefox 52 gate.
- The CLI `package` command now emits `wasmbridge-package-0.2` when
  `--module-runtime` is supplied. General packages record the module runtime,
  allocator/memory ABI, fallback global and SHA-256 hashes while the original
  v0.1 package command remains compatible.
- `Tests/test_package.ps1` creates a disposable general BufferArena package and
  verifies its metadata and every recorded hash. The CLI `verify-package`
  command additionally rejects missing, modified, escaping, duplicate or
  unexpected artifacts before deployment.

## v0.6 — manifest-driven package loading

- `Runtime/package.js` loads trusted v0.1/v0.2 manifests, resolves package-relative
  assets, loads the required classic-script runtime layers in order, and returns
  either a low-level v0.1 processor or a general v0.2 module instance.
- Package-loader errors expose a `phase` (`configuration`, `manifest`, `scripts`,
  or `package`) so deployment failures are distinguishable from Wasm backend
  failures. Manifest hashes remain informational rather than executable trust.
- `Examples/PackageLoader/index.html` exercises the complete v0.2 flow in Firefox
  52 and changes its window title to an unambiguous PASS/FAIL result.
- `Tests/test_package_loader_node.js` covers runtime-layer loading, Wasm and forced
  JavaScript execution, relative package assets, ownership cleanup and malformed
  manifests.
- The general module API now provides `allocateString`, `withBuffer`, and
  idempotent `dispose` lifecycle helpers. Scoped synchronous or Promise-returning
  callbacks release their handles automatically; disposal releases every live
  owned handle and rejects later calls on that instance.
- Optional manifest `signatures` describe Firefox-52-callable `i32`, `f32`,
  `f64`, and `void` contracts. The general runtime validates argument count,
  argument values and results around every declared call; `i64` is deliberately
  rejected because Firefox 52 cannot expose it safely through this numeric API.

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

See [Documentation/API_REFERENCE.md](Documentation/API_REFERENCE.md) for the
browser APIs, ownership rules, package loader, compiler commands and examples.

WasmBridge is independent of MIRAE and ATALANTA WebUI.

## Complete validation

Run `Tools\Test-All.ps1` from the repository root for the release matrix. It
checks the host, builds and self-tests x86/x64, verifies both package formats,
runs every Node regression, replays the external toolchain, syntax-checks every
runtime for Firefox 52, and executes all example pages with native Wasm and
forced JavaScript fallbacks where applicable. Browser tests use an isolated
profile and always close Firefox and the localhost server. Use `-SkipFirefox`
only for a host-only preflight.

`Tools\New-Release.ps1` runs that matrix by default, assembles verified v0.1
and v0.2 example packages with both XP architectures, records per-file hashes,
and writes a deterministic `artifacts\WasmBridge-<version>.zip` plus its SHA-256
sidecar. Pass `-SkipValidation` only when the same commit has already completed
`Test-All.ps1` successfully.

## v0.7 — optional Emscripten compiler backend

The CLI now provides `build-emscripten` for larger C/C++-oriented toolchains.
It invokes a host-installed `emcc`, requests a standalone `.wasm` without JS
glue, exports the named C functions, and disables known post-MVP instruction
families. Emscripten remains an optional build-host dependency: it is not
shipped with WasmBridge and is not required on Windows XP.

```text
WasmBridge.exe build-emscripten --source library.c --out library.wasm --emcc C:\path\to\emcc.bat --export function1,function2
```

The result must still pass `validate-legacy` and execute in Firefox 52.9 ESR;
compiler flags alone are not treated as proof of legacy-browser compatibility.
Run the portable SDK's `emsdk_env.bat` in the build shell before invoking an
SDK whose `emcc.exe` launcher depends on its private Python and Node runtimes.
`Tools\Build-EmscriptenFixture.ps1` reproduces the dedicated
`Examples\EmscriptenHelloWorld` acceptance module with pinned Emscripten 6.0.10
and validates it using the same restricted WABT profile as release builds.
For library builds, `--sources` accepts semicolon-separated C/C++ files;
`--include` accepts include directories and `--define` accepts preprocessor
definitions using the same list syntax. Paths are passed as distinct compiler
arguments, including paths containing spaces.