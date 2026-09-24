# WasmBridge

Reusable WebAssembly build/packaging tools and an optional browser runtime for Firefox 52.9 ESR on Windows XP (32-bit browser), with JavaScript fallback and newer-browser support.

**Status:** early prototype. The native Windows build is a Visual Studio 2022 **.sln** (no .slnx). WXP uses `v141_xp`; W10 uses `v143`. The managed projects target **.NET Framework 4.0** for both. Building a Windows DLL is separate from building a portable wasm32 module with external LLVM/Clang.

See `Documentation/GETTING_STARTED.md` for build and smoke-test instructions. The baseline demo exports `add(i32, i32) -> i32`, including a JS fallback. Browser execution on actual XP/Firefox 52 is **not yet verified**.

## Layout

- `WasmBridge.sln`: managed API, CLI and optional native sample DLL.
- `Core/math.c`: same portable C algorithm for native DLL and wasm32.
- `Runtime/wasmbridge.js`: browser feature-detection, load, export validation and fallback.
- `Examples/HelloWorld/`: test harness and fallback implementation.
- `Tests/`: browser and managed tests.
- `build_x86.cmd`, `build_x64.cmd`: Windows build scripts.

The name **MIRAE** is reserved for the separate browser desktop project. WasmBridge is independent of MIRAE and ATALANTA WebUI.

