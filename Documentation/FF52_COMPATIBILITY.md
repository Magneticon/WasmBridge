# Firefox 52.9 ESR compatibility contract

WasmBridge's legacy browser target is **Firefox 52.9 ESR on Windows XP x64**, normally as a 32-bit browser process. Actual execution on that browser is the acceptance criterion; host-side validation is only a preflight.

## Addressing

Firefox 52 uses the original **wasm32** WebAssembly model. This remains true even when Firefox runs on a 64-bit operating system. WasmBridge 0.8 can also load memory64 modules on modern engines, but memory64/BigInt is not part of the Firefox 52 path and must never be required by the distributed legacy runtime.

`Core/buffers.c` exports `wb_address_bits()`. The Firefox 52 BufferArena fixture must report 32. The 0.8 native browser self-test also verifies that the old WasmBridge 32 MiB and 128-allocation framework ceilings are gone; practical growth is still limited by the 32-bit browser's available address space and the WebAssembly engine.

## JavaScript baseline

- Classic scripts only: no `<script type="module">`, top-level `import`/`export`, dynamic import, async/await, optional chaining or BigInt literals in files loaded by Firefox 52.
- Use ordinary functions, Promise chains and TypedArrays. Runtime code may contain memory64 branches which reference `BigInt` only indirectly and are never executed on Firefox 52.
- `Runtime/legacy-compat.js` provides an optional XHR ArrayBuffer loader when `fetch` is unavailable. It does not fake or polyfill WebAssembly.
- Do not infer compatibility from `typeof WebAssembly`. Instantiate the actual module, validate its required exports/memory contract and run module-specific tests.
- `file://` worked on the original test installation, but HTTP is the reproducible acceptance route.

## Build-host pipeline

Development-host tools do not ship to XP. VS2022/v141_xp builds the Windows components; Clang/Emscripten, WABT, Binaryen, esbuild and Node are host-side tools only.

`validate-legacy`, `optimize-legacy` and generated-fallback validation intentionally use the wasm32/MVP-oriented Firefox 52 profile. A memory64 module is a modern-engine artifact and should not be passed through the legacy gate expecting success.

Examples:

```text
WasmBridge.exe validate-legacy --wasm Examples\BufferArena\buffers.wasm --validator C:\tools\wabt\bin\wasm-validate.exe
WasmBridge.exe generate-fallback --wasm Examples\BufferArena\buffers.wasm --out candidate.js --validator C:\tools\wabt\bin\wasm-validate.exe --wasm2js C:\tools\binaryen\bin\wasm2js.exe --esbuild C:\tools\esbuild\esbuild.exe
```

## XP browser test endpoint

On the Windows 10 development host:

```text
node Tools\Serve-Examples.js 8084 192.168.255.2
```

On Windows XP / Firefox 52.9 ESR:

```text
http://192.168.255.2:8084/Examples/WasmSelfTest/index.html
```

The XP machine needs Firefox only. It does not need Node, npm, LLVM, Emscripten, WABT, Binaryen or the Visual Studio toolchain.

## Acceptance matrix

`Tools\Test-All.ps1` runs managed/native builds, host Node regressions, toolchain checks and a local Firefox 52 matrix when Firefox is present. The browser pages cover HelloWorld, Emscripten standalone Wasm, RGBA, BufferArena, general modules, package loading, fallbacks and the raw native-WASM self-test.

The generated Binaryen fallback remains a module-specific candidate until its ABI/parity probe passes. A wasm2js translation is not a general WebAssembly polyfill and does not automatically reproduce every trap/import/memory behavior.

## Security

Run only trusted Wasm modules and fallback scripts. JavaScript fallbacks execute with the privileges of the embedding origin. Build-time validators can reject unsupported feature families, but imports, ABI behavior, browser policies and numerical corner cases still require explicit per-module testing.
