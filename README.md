# WasmBridge

WasmBridge is a reusable WebAssembly compilation, packaging and browser-runtime framework with an unusually old compatibility baseline: **Firefox 52.9 ESR on Windows XP**, while also supporting newer engines.

## Current release: 0.8.0

WasmBridge 0.8 removes the old prototype-wide 16 MiB buffer, 32 MiB linear-memory and 128-allocation ceilings. The general allocator/runtime now grows until the WebAssembly engine, browser process or optional application quota refuses further growth.

The runtime is address-width aware:

- **wasm32** — 32-bit linear-memory addresses. This is the Firefox 52 / Windows XP path.
- **memory64 / wasm64** — 64-bit addresses exposed to JavaScript as `BigInt` on modern engines that implement memory64.

Browser-process bitness and Wasm address width are separate properties. A 64-bit browser can still run wasm32.

## Self-contained SDK/toolchain

WasmBridge is designed to be a self-contained SDK tree. Pinned host-side dependencies live under `Toolchain\` instead of requiring a machine-specific `C:\CODEX\TOOLS\WasmBridge` installation.

Expected bundled layout:

```text
Toolchain\
  binaryen-version_133\
  emsdk\
  esbuild-0.28.2\
  Firefox52-TestProfile\
  wabt-1.0.42\
```

If you already have the prepared toolset elsewhere, import it once:

```powershell
powershell -ExecutionPolicy Bypass -File Tools\Import-Toolchain.ps1 -Source E:\GPT\CODEX\CODEX\DATA\WasmBridge -Clean
```

After import, normal build/test scripts automatically use `Toolchain\`. `WASMBRIDGE_TOOLS`, `WASMBRIDGE_LLVM`, `-ToolRoot` and related switches remain explicit overrides only.

The Windows XP runtime machine does not need Node, LLVM, Emscripten, WABT, Binaryen or esbuild; those are host-side SDK components.

## Build targets

Windows binaries remain XP-compatible:

- Visual Studio 2022 traditional `WasmBridge.sln`
- `v141_xp`
- .NET Framework 4.0
- x86 and x64 native/managed builds

The bundled `emsdk\upstream` LLVM is also used as the default direct Clang/wasm-ld toolchain when present.

## CLI examples

```text
WasmBridge.exe build --source Core\math.c --out add.wasm --export add
WasmBridge.exe build --source Core\buffers.c --out buffers.wasm --address-bits 32 --export wb_alloc,wb_free,wb_capacity,wb_active_count,wb_invert_rgba,wb_address_bits
WasmBridge.exe build --source Core\buffers.c --out buffers64.wasm --address-bits 64 --export wb_alloc,wb_free,wb_capacity,wb_active_count,wb_invert_rgba,wb_address_bits
```

`--address-bits 32` is the default. `validate-legacy` intentionally rejects memory64 and other post-MVP features because it is the Firefox 52 compatibility gate.

## Runtime layers

- `Runtime/wasmbridge.js` — low-level Wasm/fallback loader.
- `Runtime/module.js` — general module API with calls, owned buffers, typed arrays, strings, optional allocator, disposal and address-width awareness.
- `Runtime/buffers.js` — BufferArena specialized adapter.
- `Runtime/rgba.js` — intentionally bounded 512×512 scratch-buffer demo adapter.
- `Runtime/package.js` — manifest-driven package loader.
- `Runtime/legacy-compat.js` — optional XHR byte loader when `fetch` is unavailable.

## Memory policy

WasmBridge imposes **no memory or handle quota by default**. Applications can still sandbox a module deliberately:

```js
WasmBridgeModule.load({
    wasm: "module.wasm",
    fallback: fallback,
    exports: ["process"],
    allocator: {allocate: "wb_alloc", release: "wb_free", capacity: "wb_capacity"},
    maxBufferBytes: 64 * 1024 * 1024,
    maxMemoryBytes: 256 * 1024 * 1024,
    maxHandles: 1024
});
```

If those properties are omitted, the engine/address space is the limit.

## Validation

Run the complete host/browser matrix with:

```powershell
powershell -ExecutionPolicy Bypass -File Tools\Test-All.ps1
```

For a Windows 10 host that does not contain Firefox 52, run the host matrix with `-SkipFirefox`, then perform the browser acceptance test on XP.

For the XP browser over the LAN, run on the Windows 10 host:

```text
node Tools\Serve-Examples.js 8084 192.168.255.2
```

and open on XP:

```text
http://192.168.255.2:8084/Examples/WasmSelfTest/index.html
```

The native self-test verifies wasm32 addressing, growth beyond the former 32 MiB ceiling and more than 128 simultaneous allocations.

## Release archives

`Tools\New-Release.ps1` creates both release flavors by default:

```powershell
powershell -ExecutionPolicy Bypass -File Tools\New-Release.ps1
```

- `WasmBridge-0.8.0-Complete.zip` — preservation-grade SDK containing source, tests, examples, documentation, binaries and the pinned host toolchain.
- `WasmBridge-0.8.0-Runtime.zip` — smaller deployment package containing runtime binaries/scripts, public headers, documentation, selected examples and verified sample packages.

Use `-Flavor Complete` or `-Flavor Runtime` to generate only one flavor. The legacy `-RuntimeOnly` switch remains an alias for the Runtime flavor.

## Documentation

- [`Documentation/WasmBridge_0.8_Architecture_API_Programming_Reference.pdf`](Documentation/WasmBridge_0.8_Architecture_API_Programming_Reference.pdf) — black-and-white architecture, API and programming-reference manual.
- [`Documentation/PROGRAMMING_GUIDE.md`](Documentation/PROGRAMMING_GUIDE.md) — source-language migration and programming guide.
- [`Documentation/API_REFERENCE.md`](Documentation/API_REFERENCE.md) — runtime/CLI API reference.
- [`Documentation/MEMORY_AND_ADDRESSING.md`](Documentation/MEMORY_AND_ADDRESSING.md) — wasm32, memory64, process bitness, allocator and quota model.
- [`Documentation/FF52_COMPATIBILITY.md`](Documentation/FF52_COMPATIBILITY.md) — Firefox 52 syntax/toolchain profile.
- [`Documentation/GETTING_STARTED.md`](Documentation/GETTING_STARTED.md) — setup and first module.
- [`Documentation/XP_FIREFOX_TEST_ENDPOINT.md`](Documentation/XP_FIREFOX_TEST_ENDPOINT.md) — standard XP LAN test endpoint.
- [`Documentation/VALIDATION_0.8.0.md`](Documentation/VALIDATION_0.8.0.md) — release acceptance matrix including the real XP/Firefox 52 run.
- [`Toolchain/README.md`](Toolchain/README.md) — bundled toolchain layout and policy.
