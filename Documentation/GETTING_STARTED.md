# WasmBridge 0.1: build and smoke test

## Scope and compatibility

- This repository uses a **Visual Studio 2022 .sln**, not .slnx.
- WXP builds use native MSVC **v141_xp** and .NET Framework **4.0**. W10 builds use native **v143** with the same managed framework. The custom MSBuild property \`AtaTargetOS\` selects the Windows target.
- Solution x86 maps native projects to Win32 and managed projects to x86; x64 maps x64 to x64.
- Native \`WasmBridge.Native.dll\` is an optional sample of shared portable C code. The command-line program \`WasmBridge.exe\` and \`WasmBridge.dll\` are **managed build/packaging utilities**, not native WebAssembly execution engines.
- The portable wasm32 output is produced **separately** by external LLVM/Clang, initially on the Windows 10 build host. v141_xp cannot produce a .wasm module.
- The browser target is Firefox 52.9 ESR (32-bit process) on Windows XP x64 with WebAssembly enabled in about:config, plus modern browsers. User's prior Firefox test verified compilation of an empty module, **not execution of this example**.
- No claim that native XP binaries, FF52 behavior, or advanced Wasm feature validation have been tested by this repo yet.

## Build the VS2022 solution

On a Windows 10 machine with Visual Studio 2022, install the C++ workload, v141_xp toolset, Windows XP build support and .NET Framework 4.0 targeting pack/reference assemblies. In a **VS2022 Developer Command Prompt**, run:

    build_x86.cmd WXP
    build_x64.cmd WXP
    build_x86.cmd W10
    build_x64.cmd W10

Or open \`WasmBridge.sln\` in VS2022 and build Release/x86 or Release/x64; set \`AtaTargetOS=WXP\` (the default) or \`W10\` for a different target. All final artifacts are staged together in \`bin\\Release\\WXP\\x86\\\`, \`bin\\Release\\WXP\\x64\\\`, etc. Managed and native intermediate directories stay separate for OS, architecture and configuration.

The native DLL can only be loaded by a process of matching bitness. The managed CLI does not need the native DLL for its build/package commands.

## Compiling a freestanding WebAssembly C module

An external Clang with wasm32 target and wasm-ld is required, with both on PATH or supplied via \`--clang\`. The checked-in \`Examples/HelloWorld/add.wasm\` is a small, import-free fixture compiled from \`Core/math.c\` using Clang 17 in an isolated development environment and executed with Node 22; that does **not** establish Firefox 52 compatibility.

Run from the repository root with a WASM-capable Clang installed:

    bin\\Release\\W10\\x64\\WasmBridge.exe build --source Core\\math.c --out Examples\\HelloWorld\\add.wasm --export add

For a compiler not on PATH, append \`--clang C:\\path\\to\\clang.exe\`. The CLI invokes a minimal freestanding compile using \`--target=wasm32 -O2 -nostdlib -Wl,--no-entry -Wl,--export=add -Wl,--strip-all\`. These flags request a minimal build; they do **not** prove that an arbitrary module uses only MVP features. Compiler version, supported flags, imports and export signatures must be checked on each target. Do not attempt to compile Win32, CUDA or other platform-specific calls into a browser module.

For a deployable bundle:

    bin\\Release\\W10\\x64\\WasmBridge.exe package --wasm Examples\\HelloWorld\\add.wasm --fallback Examples\\HelloWorld\\add.js --runtime Runtime\\wasmbridge.js --out dist

The bundle contains a module, fallback, loader and informational JSON manifest with SHA-256 hashes. The manifest does not authenticate untrusted data or validate Wasm feature requirements. The v0.1 API is currently focused on a single numeric export, not a generic C++ runtime, binary-buffer ABI or complete import parser.

## Actual XP Firefox execution test (manual)

1. Serve the repository via an HTTP server accessible to the XP machine, using the repository root as document root (e.g. on the W10 machine: \`python -m http.server 8080 --bind 0.0.0.0\` on a trusted LAN; restrict firewall access appropriately). \`file://\` loads may fail due to fetch/CORS restrictions.
2. Open \`http://<server>:8080/Examples/HelloWorld/\` in Firefox 52.9 ESR on XP. In \`about:config\`, check \`javascript.options.wasm\` is enabled.
3. Check \`PASS: add(20,22) = 42\` and \`Backend: wasm\`. This proves that a **non-empty export executes** for this browser/fixture combination.
4. Tick **Force JavaScript fallback** and rerun: expect PASS, backend javascript, and diagnostic indicating Wasm was disabled.
5. Disable WebAssembly in about:config, restart Firefox and rerun with Force JS **unchecked**: expect the loader to fall back to JavaScript. Restore the original preference afterward.
6. Record the exact Firefox version, OS, console messages and result text; a W10/modern browser PASS cannot substitute for this XP browser test.

The loader tries fetch + \`WebAssembly.instantiate(new Uint8Array(bytes), imports)\`, checks callable exports, and switches to an independently provided JS implementation on failure. The fallback URL must point to a trusted script; do not accept arbitrary untrusted URLs. Script-URL fallback currently assumes a DOM; worker consumers can pass an implementation object directly. This first milestone does not implement pointer/length memory adapters, SIMD, threads or arbitrary JS-to-Wasm compilation.

## CLI sanity check

    bin\\Release\\WXP\\x64\\WasmBridge.exe self-test
    bin\\Release\\WXP\\x64\\WasmBridge.exe verify --wasm Examples\\HelloWorld\\add.wasm

\`self-test\` exercises managed header parsing. \`verify\` checks **only** the eight-byte Wasm magic/version header; it does not prove that the module is safe, import-free, MVP-only or compatible with Firefox 52. Actual XP runtime and browser testing remain manual until an appropriate test harness exists.

Do not modify the operator's external AIEXE build orchestration. No placeholder \`AI_RUN_WXP.bat\` or \`AI_RUN_W10.bat\` is included, because a managed self-test alone cannot establish the required Firefox browser behavior.
