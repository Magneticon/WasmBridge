# WasmBridge 0.8.0 validation record

This file records the acceptance state used to prepare the WasmBridge 0.8.0 release.

## Host validation

The complete Windows 10 host matrix passed with the repository-local bundled toolchain:

- Windows XP-targeted native/managed x86 build: **PASS**
- Windows XP-targeted native/managed x64 build: **PASS**
- native allocator/self-tests: **PASS**
- package 0.1 and 0.2 creation/verification: **PASS**
- tampered package rejection: **PASS**
- Emscripten backend contract: **PASS**
- direct wasm32 binary tests: **PASS**
- memory64/i64/BigInt modern-engine path: **PASS**
- allocator growth beyond former 32 MiB limit: **PASS**
- more than 128 simultaneous handles: **PASS**
- block splitting/coalescing/reuse: **PASS**
- 2048x2048 BufferArena RGBA processing: **PASS**
- retryable disposal/lifecycle regressions: **PASS**
- package adapter loading: **PASS**
- malformed module rejection: **PASS**
- WABT Firefox-52/MVP validation: **PASS**
- Binaryen legacy optimization: **PASS**
- Binaryen wasm2js + esbuild generated fallback parity: **PASS**
- Firefox-52 JavaScript syntax gate: **PASS**

Bundled tools used by the successful matrix include WABT 1.0.42, Binaryen 133 and esbuild 0.28.2, together with the repository-local Emscripten/LLVM toolchain.

## Actual legacy-browser acceptance

Date: **October 4, 2026**

Target:

```text
Windows NT 5.2 / Windows XP x64
Firefox 52.9 ESR (32-bit/WOW64 browser process)
WebAssembly address model: wasm32
```

Acceptance page:

```text
http://192.168.255.2:8084/Examples/WasmSelfTest/index.html
```

Observed result:

```text
PASS
HelloWorld: PASS
Emscripten standalone: PASS
RGBA: PASS
BufferArena wasm32, >128 handles and >32 MiB: PASS
Malformed WASM rejection: PASS
```

This confirms that the removal of the old 32 MiB memory and 128-handle framework ceilings is effective on the real Firefox 52 / Windows XP target, not only in modern host tests.

## Release interpretation

The legacy compatibility gate is the actual Firefox 52 run. Host-side validators are preflight checks and do not replace target-browser execution.

The memory64 path is a separate modern-engine capability and is not required by Firefox 52. A 64-bit native browser process does not imply memory64.
