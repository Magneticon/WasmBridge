# WasmBridge 0.1: build and smoke test

## Windows XP-only build and compatibility

- Visual Studio 2022 uses the traditional `WasmBridge.sln`, not `.slnx`.
- Windows executables and libraries target **XP only**: native `v141_xp`, managed **.NET Framework 4.0**, x86 and x64 solution configurations. The Windows 10 machine is a **build host**, not a separate W10 build/run target.
- The operator's existing external AIEXE/MSBuild workflow builds the solution; there are no repository-local build CMD scripts or `AI_RUN_W10.bat`.
- Managed API: `WasmBridge.Core.dll` (C# namespace `WasmBridge`); managed CLI: `WasmBridge.exe`; optional native sample: `WasmBridge.Native.dll`. Native and managed architectures are matched per solution platform.
- The CLI and managed DLL previously both had the CLR assembly name `WasmBridge`. The XP run in `WasmBridge_out.txt` crashed with `System.TypeLoadException` for `WasmBridge.CompileOptions` in assembly `WasmBridge, Version=0.0.0.0`. The project now gives the API the distinct assembly name `WasmBridge.Core` to prevent the CLI EXE from being resolved in place of the API DLL. This still requires a fresh XP build/run to confirm the fix.
- Final Release binaries are staged together under `bin\Release\WXP\x86\` or `bin\Release\WXP\x64\`, with per-project intermediate directories. No W10 output tree is maintained.
- The native DLL requires matching process bitness; the managed CLI does not load it for build/package operations.
- The browser target is Firefox 52.9 ESR (32-bit browser process) on XP x64, with WebAssembly enabled in `about:config` when supported. The previous user test verified compilation of an **empty** module, not actual execution of this example.
## Compiling a freestanding WebAssembly C module

An external Clang with wasm32 target and wasm-ld is required, with both on PATH or supplied via `--clang`. The checked-in `Examples/HelloWorld/add.wasm` is an initial small demonstration fixture. It has not been verified to execute on Firefox 52 on XP.

Run from the repository root with a WASM-capable Clang installed:

    bin\Release\WXP\x64\WasmBridge.exe build --source Core\math.c --out Examples\HelloWorld\add.wasm --export add

For a compiler not on PATH, append `--clang C:\path\to\clang.exe`. The CLI invokes a minimal freestanding compile using `--target=wasm32 -O2 -nostdlib -Wl,--no-entry -Wl,--export=add -Wl,--strip-all`. These flags request a minimal build; they do **not** prove that an arbitrary module uses only MVP features. Compiler version, supported flags, imports and export signatures must be checked on each target. Do not attempt to compile Win32, CUDA or other platform-specific calls into a browser module.

For a deployable bundle:

    bin\Release\WXP\x64\WasmBridge.exe package --wasm Examples\HelloWorld\add.wasm --fallback Examples\HelloWorld\add.js --runtime Runtime\wasmbridge.js --out dist

The bundle contains a module, fallback, loader and informational JSON manifest with SHA-256 hashes. The manifest does not authenticate untrusted data or validate Wasm feature requirements. The v0.1 API is currently focused on a single numeric export, not a generic C++ runtime, binary-buffer ABI or complete import parser.

## Actual XP Firefox execution test (manual)

1. Serve the repository via an HTTP server accessible to the XP machine, using the repository root as document root (e.g. on the W10 machine: `python -m http.server 8080 --bind 0.0.0.0` on a trusted LAN; restrict firewall access appropriately). `file://` loads may fail due to fetch/CORS restrictions.
2. Open `http://<server>:8080/Examples/HelloWorld/` in Firefox 52.9 ESR on XP. In `about:config`, check `javascript.options.wasm` is enabled.
3. Check `PASS: add(20,22) = 42` and `Backend: wasm`. This proves that a **non-empty export executes** for this browser/fixture combination.
4. Tick **Force JavaScript fallback** and rerun: expect PASS, backend javascript, and diagnostic indicating Wasm was disabled.
5. Disable WebAssembly in about:config, restart Firefox and rerun with Force JS **unchecked**: expect the loader to fall back to JavaScript. Restore the original preference afterward.
6. Record the exact Firefox version, OS, console messages and result text; a W10/modern browser PASS cannot substitute for this XP browser test.

The loader tries fetch + `WebAssembly.instantiate(new Uint8Array(bytes), imports)`, checks callable exports, and switches to an independently provided JS implementation on failure. The fallback URL must point to a trusted script; do not accept arbitrary untrusted URLs. Script-URL fallback currently assumes a DOM; worker consumers can pass an implementation object directly. This first milestone does not implement pointer/length memory adapters, SIMD, threads or arbitrary JS-to-Wasm compilation.

## CLI sanity check

    bin\Release\WXP\x64\WasmBridge.exe self-test
    bin\Release\WXP\x64\WasmBridge.exe verify --wasm Examples\HelloWorld\add.wasm

`self-test` exercises managed header parsing. `verify` checks **only** the eight-byte Wasm magic/version header; it does not prove that the module is safe, import-free, MVP-only or compatible with Firefox 52. Actual XP runtime and browser testing remain manual until an appropriate test harness exists.

Do not modify the operator's external AIEXE build orchestration. The XP runner covers the managed CLI self-test, not the Firefox browser. The repository's existing `AI_RUN_WXP.bat` has been adapted to run the managed CLI `self-test` under the operator's DBGRun convention, verify its PASS marker, and return a nonzero exit status if verification fails. This test does **not** exercise the browser or native WASM. There is no W10 build/run target; the browser smoke test above remains manual on XP.
