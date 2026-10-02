# WasmBridge 0.7: build, package, and validate

For the public runtime and CLI surface, see [API_REFERENCE.md](API_REFERENCE.md).

## Windows XP-only build and compatibility

- Visual Studio 2022 uses the traditional `WasmBridge.sln`, not `.slnx`.
- Windows executables and libraries target **XP only**: native `v141_xp`, managed **.NET Framework 4.0**, x86 and x64 solution configurations. The Windows 10 machine is a **build host**, not a separate W10 build/run target.
- The operator's existing external AIEXE/MSBuild workflow builds the solution; there are no repository-local build CMD scripts or `AI_RUN_W10.bat`.
- For ordinary non-administrator development-host checks, run
  `powershell -ExecutionPolicy Bypass -File Tools\Check-Environment.ps1`.
  `Tools\Build-Host.ps1` is a thin PowerShell convenience wrapper around the
  traditional solution; it does not add a Windows 10 product configuration or
  replace the operator's AIEXE/XP validation workflow. Both scripts use explicit
  installed paths and make no machine-wide changes.
- Managed API: `WasmBridge.Core.dll` (C# namespace `WasmBridge`); managed CLI: `WasmBridge.exe`; optional native sample: `WasmBridge.Native.dll`. Native and managed architectures are matched per solution platform.
- The CLI and managed DLL previously both had the CLR assembly name `WasmBridge`. The XP run in `WasmBridge_out.txt` crashed with `System.TypeLoadException` for `WasmBridge.CompileOptions` in assembly `WasmBridge, Version=0.0.0.0`. The project now gives the API the distinct assembly name `WasmBridge.Core` to prevent the CLI EXE from being resolved in place of the API DLL. The next XP run passed: the CLI loaded the managed API and its header parser returned exit code 0.
- Final Release binaries are staged together under `bin\Release\WXP\x86\` or `bin\Release\WXP\x64\`, with per-project intermediate directories. No W10 output tree is maintained.
- The native DLL requires matching process bitness; the managed CLI does not load it for build/package operations.
- The browser target is Firefox 52.9 ESR (32-bit browser process) on XP x64, with WebAssembly enabled in `about:config` when supported. The user's Firefox 52 screenshots verified execution of `add(20,22) = 42` using the Wasm backend **and** with forced JavaScript fallback. The new RGBA memory demo has not yet been verified on XP Firefox.
## Compiling a freestanding WebAssembly C module

An external Clang with wasm32 target and wasm-ld is required, with both on PATH or supplied via `--clang`. The checked-in `Examples/HelloWorld/add.wasm` is an initial small demonstration fixture. The user verified its exported `add()` execution on Firefox 52 on XP.

Run from the repository root with a WASM-capable Clang installed:

    bin\Release\WXP\x64\WasmBridge.exe build --source Core\math.c --out Examples\HelloWorld\add.wasm --export add

For a compiler not on PATH, append `--clang C:\path\to\clang.exe`. The
portable LLVM root can also be passed to the environment checker as
`-LlvmRoot`, or supplied through the optional user variable
`WASMBRIDGE_LLVM`. No system PATH change is required. The CLI invokes a minimal freestanding compile using `--target=wasm32 -O2 -nostdlib -Wl,--no-entry -Wl,--export-memory -Wl,--export=add -Wl,--strip-all`. Use comma-separated names with `--export` for multiple function exports. These flags request a minimal build; they do **not** prove that an arbitrary module uses only MVP features. Compiler version, supported flags, imports and export signatures must be checked on each target. Do not attempt to compile Win32, CUDA or other platform-specific calls into a browser module.

For a deployable bundle:

    bin\Release\WXP\x64\WasmBridge.exe package --wasm Examples\HelloWorld\add.wasm --fallback Examples\HelloWorld\add.js --runtime Runtime\wasmbridge.js --out dist

The bundle contains a module, fallback, loader and informational JSON manifest with SHA-256 hashes. The manifest does not authenticate untrusted data or validate Wasm feature requirements. The v0.1 API is currently focused on a single numeric export, not a generic C++ runtime, binary-buffer ABI or complete import parser.

To package a general v0.5 module with an allocator ABI:

    bin\Release\WXP\x64\WasmBridge.exe package --wasm Examples\BufferArena\buffers.wasm --fallback Examples\BufferArena\buffers-fallback.js --runtime Runtime\wasmbridge.js --module-runtime Runtime\module.js --out dist\buffers --export wb_active_count,wb_invert_rgba --allocator wb_alloc,wb_free,wb_capacity --memory-export memory --fallback-global WasmBridgeBuffersFallback

Supplying `--module-runtime` selects manifest format `wasmbridge-package-0.2`.
The manifest records the public exports, optional `allocate,release[,capacity]`
ABI, memory export, fallback global and SHA-256 for each copied artifact. These
hashes detect accidental changes; they are not a signature or trust mechanism.
Omitting `--module-runtime` retains the original v0.1 package shape.

Verify a completed package before deployment:

    bin\Release\WXP\x64\WasmBridge.exe verify-package --manifest dist\buffers\manifest.json

This validates the manifest format, keeps every artifact path inside the
package directory, checks required files and hashes, verifies the Wasm header,
and rejects duplicate exports and unexpected files. It detects corruption and
packaging mistakes but does not establish publisher authenticity.

To consume a trusted package manifest directly in a classic-script browser,
include `Runtime/package.js` and call:

    WasmBridgePackage.load({manifest: "dist/buffers/manifest.json"}).then(function (module) {
        console.log(module.backend, module.packageManifest.format);
    });

The package loader fetches the JSON manifest, resolves every artifact relative
to it, loads `wasmbridge.js` and (for v0.2) `module.js` in order, then delegates
to the appropriate runtime API. A v0.2 manifest should name `fallbackGlobal` so
the fallback script can be resolved if Wasm is disabled or rejected. Only load
packages and fallback scripts from trusted locations. Recorded SHA-256 values
are useful for deployment auditing but are not signatures and are not enforced
by the browser loader.

For the general v0.5 API, include `Runtime/module.js` immediately after
`Runtime/wasmbridge.js`. `WasmBridgeModule.load()` accepts declared exports,
imports, a JS fallback, and optional allocator export names. It provides direct
function calls plus owned byte, typed-array and UTF-8 string copies. It never
returns a live Wasm-memory view. See `Tests/test_module_node.js` for complete
multi-instance and allocator examples.

Use `allocateString(text)` when a null-terminated UTF-8 allocation is needed,
or `withBuffer(bytes, callback)` for temporary work. `withBuffer` releases its
handle after a synchronous callback or after a returned Promise settles. Call
`dispose()` when an instance is no longer needed; it releases all remaining
owned handles, is safe to call again, and prevents later module operations.
Pass `--signatures path\\to\\signatures.json` while packaging to embed optional
function contracts. Each export maps to `parameters` and `result`; supported
types are `i32`, `f32`, `f64`, and `void` for results. The runtime checks arity
and JavaScript values before invoking the backend and validates its result.
`i64` is intentionally excluded from this Firefox 52 numeric interface.

To exercise the optional host toolchain without modifying checked-in fixtures:

    powershell -ExecutionPolicy Bypass -File Tools\Test-ExternalToolchain.ps1

Portable tools default to `C:\CODEX\TOOLS\WasmBridge`; use `-ToolRoot` or the
optional `WASMBRIDGE_TOOLS` user variable for a different location.

## Actual XP Firefox execution test (manual)

1. The user's Firefox 52 XP installation successfully loaded the numeric test from `file://`. Try the same for the image demo; if local fetching is blocked on another installation, serve the repository using a trusted LAN HTTP server.
2. Open `http://<server>:8080/Examples/HelloWorld/` in Firefox 52.9 ESR on XP. In `about:config`, check `javascript.options.wasm` is enabled.
3. Check `PASS: add(20,22) = 42` and `Backend: wasm`. This proves that a **non-empty export executes** for this browser/fixture combination.
4. Tick **Force JavaScript fallback** and rerun: expect PASS, backend javascript, and diagnostic indicating Wasm was disabled.
5. Disable WebAssembly in about:config, restart Firefox and rerun with Force JS **unchecked**: expect the loader to fall back to JavaScript. Restore the original preference afterward.
6. Record the exact Firefox version, OS, console messages and result text; a W10/modern browser PASS cannot substitute for this XP browser test.

The loader tries fetch + `WebAssembly.instantiate(new Uint8Array(bytes), imports)`, checks callable exports, and switches to an independently provided JS implementation on failure. The fallback URL must point to a trusted script; do not accept arbitrary untrusted URLs. Script-URL fallback currently assumes a DOM; worker consumers can pass an implementation object directly. This first milestone does not implement pointer/length memory adapters, SIMD, threads or arbitrary JS-to-Wasm compilation.

## CLI sanity check

    bin\Release\WXP\x64\WasmBridge.exe self-test
    bin\Release\WXP\x64\WasmBridge.exe verify --wasm Examples\HelloWorld\add.wasm

`self-test` exercises the managed header parser **and** performs an XP-native P/Invoke RGBA8 check (RGB inversion, unchanged alpha, invalid-dimension rejection). Both the managed DLL and matching-architecture `WasmBridge.Native.dll` must be present alongside the CLI. `verify` checks **only** the eight-byte Wasm magic/version header; it does not prove that the module is safe, import-free, MVP-only or compatible with Firefox 52. Actual XP runtime and browser testing remain manual until an appropriate test harness exists.

Do not modify the operator's external AIEXE build orchestration. The XP runner covers the managed CLI and native RGBA8 test, not the Firefox browser. The repository's `AI_RUN_WXP.bat` runs CLI `self-test` under the operator's DBGRun convention and requires both the managed and native PASS markers plus a successful exit status. This does **not** execute a Wasm module in the browser. There is no W10 build/run target; the browser smoke test above remains manual on XP.


## RGBA8 shared-memory milestone (v0.2 prototype)

The new image-processing demonstration is at `Examples/ImageProcessing/index.html`. It includes a freestanding wasm32 fixture (`rgba.wasm`), its shared portable C source (`Core/image.c`), a matching JS fallback (`rgba-fallback.js`) and the browser adapter (`Runtime/rgba.js`). The same C source now builds into the native XP DLL. The WebAssembly fixture was compiled with Clang 17 for wasm32 with `-nostdlib`, `--no-entry`, the three function exports and `--export-memory`. These are static-MVP-oriented settings; successful FF52 execution remains to be tested.

### Memory and function contract

- Exports: `memory`, `wb_rgba_buffer() -> i32` (Wasm byte offset), `wb_rgba_capacity() -> i32` (byte count), `wb_rgba_invert(width:i32, height:i32) -> i32` (processed bytes or -1 on invalid dimensions). The native XP DLL exports the same C functions, with a native pointer from `wb_rgba_buffer()`.
- Tightly packed, row-major RGBA8; 4 bytes per pixel; dimensions 1 through 512 per axis; buffer capacity 1,048,576 bytes. Processing inverts RGB values and preserves alpha byte-for-byte. It neither reads nor writes outside the specified pixel count.
- The module owns a single static scratch buffer, reused by synchronous calls; there is no allocation/free and no special requirement for modern Wasm extensions. The JS adapter checks dimensions, buffer capacity and memory bounds, copies the input into the module-owned buffer, invokes the C operation, and copies the output into a fresh `Uint8ClampedArray`. Consumers must not retain a view into Wasm memory or assume the backing buffer remains unchanged after growth.
- JS fallback implements the same exported functions and scratch-buffer semantics. The loader validates the Wasm exports and linear-memory contract before choosing the Wasm backend; unsupported/malformed Wasm falls back to JS. This prototype does not yet provide a generic allocator, arbitrary pointer-oriented APIs, asynchronous access to shared scratch memory, or automatic binding of all native C APIs.

### Test the image demo on your actual XP Firefox

1. Update the repository and open `Examples/ImageProcessing/index.html` on the XP machine. Your existing `file://` access may work as it did for the numeric test; a trusted LAN HTTP server is an alternative if module loading is blocked.
2. The page draws an original 256×160 synthetic image and its inverted output in adjacent Canvas elements. Expect `PASS`, `Selected backend: wasm`, `Wasm vs JS identical: PASS`, `Wasm/JS vs reference: PASS`, and `Input unchanged: PASS`.
3. Enable **Force JavaScript fallback**, rerun, and expect `Selected backend: javascript`, the same inverted image and reference check. The diagnostic should say that Wasm was disabled by the caller.
4. Optionally load a local image. The browser scales oversized images to fit within 512×512. Confirm that transparent areas retain their alpha. Try a small 1×1 or an image with transparency if desired.
5. Capture the resulting screenshot or any `FAIL`/diagnostics. The repository's unattended XP CLI test validates the native DLL, not this browser behavior.

For an optional development-host regression test, `node Tests/test_rgba_node.js` covers five RGBA sizes, alpha preservation, Wasm/JS bitwise agreement, invalid dimensions and corrupted-Wasm fallback. `Tests/test_native.c` independently tests the shared C source with a standard C compiler. These development-host checks do not establish actual Firefox 52 compatibility.

On a development machine with a Wasm-capable external Clang and wasm-ld, the CLI can rebuild the checked-in sample with:

    bin\Release\WXP\x64\WasmBridge.exe build --source Core\image.c --out Examples\ImageProcessing\rgba.wasm --export wb_rgba_buffer,wb_rgba_capacity,wb_rgba_invert

The CLI's XP-targeted managed binary may be run on the Windows 10 *build host* if the matching .NET Framework is installed; there is no separate W10 product build. The native Windows toolset `v141_xp` cannot compile wasm32. Do not require an XP-hosted LLVM toolchain just to exercise Wasm in Firefox on XP.

## v0.3 independent-buffer and memory-growth prototype

The previous 256×160 RGBA test was verified in the user's actual Firefox 52 on XP, with the Wasm backend, forced JS fallback, reference agreement, and unchanged input. The new **dynamic** buffer test is at `Examples/BufferArena/index.html` and has **not** yet been tested in that browser.

### Native and WebAssembly ABI

`Core/buffers.c` and `Core/buffers.h` compile into the XP-native DLL using `v141_xp` and into `Examples/BufferArena/buffers.wasm` using external freestanding wasm32 Clang. The five exported C functions are:

- `wb_alloc(bytes:int32) -> pointer`: reserve an independently owned buffer; returns null/offset 0 on failure.
- `wb_capacity(pointer) -> int32`: actual live block capacity, or 0 for an invalid/released pointer.
- `wb_free(pointer) -> int32`: release a live allocation (1 successful, 0 invalid/already released).
- `wb_invert_rgba(src:pointer, dst:pointer, bytes:int32) -> int32`: invert RGB, preserve alpha; returns byte count or -1 on bounds/size errors. Exact in-place aliasing is supported.
- `wb_active_count() -> int32`: currently live blocks.

Pointers from Wasm are **32-bit byte offsets into the module's exported linear memory**. Pointers from the XP DLL are **native process addresses** and use `IntPtr` in C# P/Invoke. Do not pass pointer values between different backends or DLLs.

The Wasm module uses an eight-byte-aligned bump allocator starting at linker-provided `__heap_base`, a bounded 128-entry metadata table, and first-fit freed-block reuse. If there is insufficient linear memory, the *JavaScript adapter* grows `exports.memory` by 64 KiB pages and retries; C functions never silently access beyond available memory. The native DLL uses CRT `malloc/free`, tracked through the same slot table. The JS fallback implements the equivalent API with a growable `ArrayBuffer`.

**Limits:** 32 MiB linear-memory budget in the adapter/allocator, 16 MiB maximum individual JS allocation, 128 tracked allocations, at most 2048 pixels per RGBA dimension. Freed Wasm blocks are reused, adjacent free blocks are coalesced, and free tail address space is reclaimed. WebAssembly linear memory cannot shrink after growth. The raw C ABI cannot reliably detect every stale pointer after address reuse; the JS adapter enforces handle identity and rejects use-after-release. `writeTyped(handle, type, typedArray)` and `readTyped(handle, type, count)` additionally copy u8/u8c/i8/u16/i16/u32/i32/f32/f64 data; they never return a live view into module memory.

### Browser API and lifetime

Include `Runtime/wasmbridge.js` followed by `Runtime/buffers.js`. Call `WasmBridgeBuffers.load({wasm:"buffers.wasm",fallback:"buffers-fallback.js"})`; the loader validates the functions and tests the memory ABI before selecting Wasm. An unsupported/broken Wasm module selects the matching JS implementation instead. From the loaded manager:

    var src = manager.allocate(pixelBytes);
    var dst = manager.allocate(pixelBytes);
    try {
        manager.write(src, imageData.data);
        manager.invertRGBA(src, dst, width, height);
        var pixels = manager.read(dst); // independent Uint8Array copy
    } finally {
        manager.release(dst);
        manager.release(src);
    }

For the common case, `manager.processRGBA(imageData.data, width, height)` handles both allocations, processing, copying and release automatically, returning an independent `Uint8ClampedArray`. `manager.statistics()` exposes currently allocated block count and linear-memory size. The JS adapter reacquires a typed-array view **after each potential memory growth**, never returns a borrowed view, checks byte lengths, and rejects released or foreign buffer handles. All calls are synchronous; no shared-memory threading is implied.

### Manual XP Firefox acceptance test

Open `Examples/BufferArena/index.html` on the XP machine in Firefox 52 from the unchanged repository tree (the earlier demos worked from `file://` on this installation). The page tests two *simultaneously live* allocations, verifies previously written bytes remain correct after a potential memory growth, frees both, rejects a stale handle, and runs the RGBA sample.

With **Force JavaScript fallback** unchecked, expect `Selected backend: wasm`, `Reference byte parity: PASS`, and `Wasm / JS byte parity: PASS`. Switch to forced JS and expect `Selected backend: javascript` with unchanged output. Try 64, 256, 512 and 1024 pixel sizes and record the backend, before/after memory size, diagnostics and any FAIL errors. The first large-image test should require the exported memory to grow; subsequent tests may reuse already expanded memory. The page distinguishes a JS-vs-JS comparison from actual cross-backend parity if WebAssembly is unavailable.

The page also reports a short (3-iteration) end-to-end mean for each backend, including *allocation + copies + processing* and separately labels module startup/validation. These measurements are illustrative, vary with browser JIT, warm-up, image size and clock resolution, and do not by themselves establish a general Wasm advantage. The XP native CLI self-test reports a **separate** 512×512 mean using `Marshal.Copy` input/output and native allocation; native and browser times involve different workloads/harnesses and must not be treated as directly interchangeable.

For an optional development-host regression, `Tests/test_buffers_node.js` checks Wasm/JS agreement across six image sizes, independent live allocations, memory growth, stale/foreign handles, bounds, and invalid-Wasm fallback. `Tests/test_buffers_native.c` checks the portable C allocator separately. These do not replace the user's actual XP browser results.

### XP native DLL deployment

The latest repository XP run log available before v0.3 shows **build success but a runtime error**: `Unable to load DLL 'WasmBridge.Native.dll' (0x8007007E)`. That error can indicate that the DLL itself, or a dependent runtime DLL, is missing from the XP environment. The native-library loading and end-to-end XP test have **not** yet been verified for this cycle. The DLL must be built with the matching x64 `v141_xp` configuration and deployed alongside `WasmBridge.exe` and `WasmBridge.Core.dll` in the XP `bin\Release\WXP\x64\` application directory; all of its XP-compatible dependencies must also be present. The native Release project now statically links its MSVC CRT to reduce external runtime dependencies; this does **not** replace deploying `WasmBridge.Native.dll` itself. The repository's XP runner now checks for the presence of the native DLL and requires all three native/managed PASS markers instead of silently treating a managed-only success as complete.

No separate W10 binaries/runners and no project-local build CMD scripts are introduced. The existing external AIEXE workflow remains the build orchestrator.
