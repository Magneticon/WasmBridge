# WasmBridge

Reusable WebAssembly build/packaging tools and an optional browser runtime for Firefox 52.9 ESR on Windows XP (32-bit browser), with JavaScript fallback and newer-browser support.

**Status:** early prototype. The native Windows build is a Visual Studio 2022 **.sln** (no .slnx). Windows binaries target **WXP only**, using native `v141_xp` and managed **.NET Framework 4.0**. Both x86 and x64 solution platforms are retained; the Windows 10 workstation may build the XP-targeted binaries, but there is no separate W10 target. Building a Windows DLL is separate from building a portable wasm32 module with external LLVM/Clang.

The managed CLI remains `WasmBridge.exe`; the managed API is now `WasmBridge.Core.dll` (namespace `WasmBridge`) to avoid a CLR assembly-name collision that caused `System.TypeLoadException` on XP. See `Documentation/GETTING_STARTED.md` for details and smoke-test instructions. The baseline demo exports `add(i32, i32) -> i32`, including a JS fallback. Browser execution on actual XP/Firefox 52 is **not yet verified**.

## Layout

- `WasmBridge.sln`: managed API (`WasmBridge.Core.dll`), CLI (`WasmBridge.exe`) and optional native sample DLL.
- `Core/math.c`: same portable C algorithm for native DLL and wasm32.
- `Runtime/wasmbridge.js`: browser feature-detection, load, export validation and fallback.
- `Examples/HelloWorld/`: test harness and fallback implementation.
- `Tests/`: browser and managed tests.
- Windows builds use the operator's existing external AIEXE/MSBuild workflow; there are no repository-local build scripts.

The existing external AIEXE workflow builds and tests the XP target; no repository-local build CMD scripts or W10 runner are required.

The name **MIRAE** is reserved for the separate browser desktop project. WasmBridge is independent of MIRAE and ATALANTA WebUI.

