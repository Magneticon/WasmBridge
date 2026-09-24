# WasmBridge 0.1: build and smoke test

## Windows XP-only build and compatibility

- Visual Studio 2022 uses the traditional `WasmBridge.sln`, not `.slnx`.
- Windows executables and libraries target **XP only**: native `v141_xp`, managed **.NET Framework 4.0**, x86 and x64 solution configurations. The Windows 10 machine is a **build host**, not a separate W10 build/run target.
- The operator's existing external AIEXE/MSBuild workflow builds the solution; there are no repository-local build CMD scripts or `AI_RUN_W10.bat`.
- Managed API: `WasmBridge.Core.dll` (C# namespace `WasmBridge`); managed CLI: `WasmBridge.exe`; optional native sample: `WasmBridge.Native.dll`. Native and managed architectures are matched per solution platform.
- The CLI and managed DLL previously both had the CLR assembly name `WasmBridge`. The XP run in `WasmBridge_out.txt` crashed with `System.TypeLoadException` for `WasmBridge.CompileOptions` in assembly `WasmBridge, Version=0.0.0.0`. The project now gives the API the distinct assembly name `WasmBridge.Core` to prevent the CLI EXE from being resolved in place of the API DLL. The next XP run passed: the CLI loaded the managed API and its header parser returned exit code 0.
- Final Release binaries are staged together under `bin\Release\WXP\x86\` or `bin\Release\WXP\x64\`, with per-project intermediate directories. No W10 output tree is maintained.
- The native DLL requires matching process bitness; the managed CLI does not load it for build/package operations.
- The browser target is Firefox 52.9 ESR (32-bit browser process) on XP x64, with WebAssembly enabled in `about:config` when supported. The user's Firefox 52 screenshots verified execution of `add(20,22) = 42` using the Wasm backend **and** with forced JavaScript fallback. The new RGBA memory demo has not yet been verified on XP Firefox.
## Compiling a freestanding WebAssembly C module

An external Clang with wasm32 target and wasm-ld is required, with both on PATH or supplied via `--clang`. The checked-in `Examples/HelloWorld/add.wasm` is an initial small demonstration fixture. The user verified its exported `add()` execution on Firefox 52 on XP.

Run from the repository root with a WASM-capable Clang installed:

    bin\Release\WXP\x64\WasmBridge.exe build --source Core\math.c --out Examples\HelloWorld\add.wasm --export add

For a compiler not on PATH, append `--clang C:\path\to\clang.exe`. The CLI invokes a minimal freestanding compile using `--target=wasm32 -O2 -nostdlib -Wl,--no-entry -Wl,--export-memory -Wl,--export=add -Wl,--strip-all`. Use comma-separated names with `--export` for multiple function exports. These flags request a minimal build; they do **not** prove that an arbitrary module uses only MVP features. Compiler version, supported flags, imports and export signatures must be checked on each target. Do not attempt to compile Win32, CUDA or other platform-specific calls into a browser module.

For a deployable bundle:

    bin\Release\WXP\x64\WasmBridge.exe package --wasm Examples\HelloWorld\add.wasm --fallback Examples\HelloWorld\add.js --runtime Runtime\wasmbridge.js --out dist

The bundle contains a module, fallback, loader and informational JSON manifest with SHA-256 hashes. The manifest does not authenticate untrusted data or validate Wasm feature requirements. The v0.1 API is currently focused on a single numeric export, not a generic C++ runtime, binary-buffer ABI or complete import parser.

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
