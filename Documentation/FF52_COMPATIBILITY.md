# Firefox 52.9 ESR compatibility contract

WasmBridge's **legacy browser target is Firefox 52.9 ESR on Windows XP x64**
(typically a 32-bit browser process). Actual execution on that platform is
the acceptance criterion. A build-host validation PASS is only a preflight.

## Evidence and limits

On the user's installation, the earlier add(), fixed RGBA and dynamically
managed BufferArena samples all executed in the XP Firefox 52 browser with
WebAssembly selected and a separately forced handwritten JavaScript fallback.
The BufferArena test also exercised linear-memory growth. These observations
**do not** imply that arbitrary modern Wasm, generated JS or Emscripten output
runs on Firefox 52. In particular, the new Binaryen-generated fallback is a
candidate and has not yet passed the browser ABI/parity probe.

## JavaScript format and API baseline

- **Classic scripts only:** no `<script type="module">`, top-level `import` or
  `export`, dynamic import, async/await, optional chaining, BigInt or recent
  syntax in distributed legacy runtime files. ES6 modules emitted by wasm2js
  must be bundled for Firefox 52 before use.
- Use `var`, ordinary functions, Promise chains and TypedArrays in the
  handwritten runtime. Firefox 52 has native Promise, ArrayBuffer, typed
  arrays and (on the user's tested installation) fetch; do not load a
  large compatibility shim when these APIs already work.
- The **optional** `Runtime/legacy-compat.js` helper reports the available
  Promise, typed arrays, fetch, XHR and WebAssembly APIs and supplies a
  narrowly scoped `XMLHttpRequest` ArrayBuffer loader when `fetch` is absent.
  Include it **before** `wasmbridge.js`. It does not patch browser globals,
  replace the normal fetch path, override a real network/CORS error, or
  polyfill Promise/ArrayBuffer. Those remain prerequisites for this runtime.
- WebAssembly is a native execution engine, not a JavaScript convenience
  function that a small polyfill can realistically reproduce. When unavailable
  or disabled, use the corresponding **tested** JavaScript backend.
  `wasm2js` translates a particular Wasm module into JS; it is not an
  implementation of the browser WebAssembly API.
- If a later module needs TextEncoder, TextDecoder, SharedArrayBuffer,
  WebAssembly.Table, newer JS built-ins or other facilities, test them
  separately; add a *small opt-in* polyfill/adapter only when its semantics
  can be reproduced safely. Threading, SIMD and post-MVP Wasm instructions
  cannot be made available by JavaScript syntax polyfills.
- Do not assume a module works merely because `typeof WebAssembly !==
  "undefined"`. Instantiate it, check its function/memory exports and run
  module-specific ABI tests. `javascript.options.wasm` may differ by
  Firefox ESR installation. The user's earlier XP tests showed it working.
- The earlier user installation supported `file://` module loading. This
  is not guaranteed for every browser policy or deployment; also test over
  a trusted same-origin HTTP(S) server when relevant.

## Build-host pipeline (optional tools, never shipped to XP)

All three tools below run on the **Windows 10 build host**, as external
executables. They are not added to the VS2022 solution as Windows 10
application targets. XP output remains .NET Framework 4.0 and `v141_xp`,
with the existing traditional `.sln` and external AIEXE orchestrator.

1. **WABT `wasm-validate`:** the CLI's `validate-legacy` command explicitly
   disables non-MVP feature families rather than relying on validator
   defaults. It fails if a required flag is unsupported by the installed
   WABT version. This inspects the Wasm binary, *not* JS glue or complete
   browser execution.
2. **Binaryen `wasm-opt`:** optional `optimize-legacy` uses the MVP feature
   profile and validates the **output** again with WABT.
3. **Binaryen `wasm2js` + esbuild:** `generate-fallback` translates the
   validated Wasm file to an ES module, then esbuild bundles it as a
   **classic-script IIFE targeted at `firefox52`**, exposing the candidate
   under `window.WasmBridgeGeneratedCandidate`. Use standalone
   `esbuild.exe` on Windows rather than assuming a Node/npm launcher runs
   inside XP or works as a direct Process.Start executable.

For instance, once host tools are installed, the existing XP-targeted CLI
can be used *on the development host* with these optional commands.
Replace paths with actual installed executable paths; no repo-local build
CMD files are required:

    WasmBridge.exe validate-legacy --wasm Examples\BufferArena\buffers.wasm --validator C:\tools\wabt\bin\wasm-validate.exe

    WasmBridge.exe generate-fallback --wasm Examples\BufferArena\buffers.wasm --out Examples\BufferArena\buffers-generated-candidate.js --validator C:\tools\wabt\bin\wasm-validate.exe --wasm2js C:\tools\binaryen\bin\wasm2js.exe --esbuild C:\tools\esbuild\esbuild.exe

    WasmBridge.exe optimize-legacy --wasm Examples\BufferArena\buffers.wasm --out Examples\BufferArena\buffers-optimized.wasm --validator C:\tools\wabt\bin\wasm-validate.exe --optimizer C:\tools\binaryen\bin\wasm-opt.exe

The CLI intentionally **refuses to overwrite existing output paths**.
Generated candidates and optimized binaries should be tested before
replacing the known-good assets. No upstream source or compiler binaries
are included in this repository by this integration.

## Generated fallback: acceptance gate

The command emits a candidate, not a production-compatible guarantee.
WebAssembly and wasm2js may expose memory and imports differently;
wasm2js cannot necessarily preserve all trap/conversion corner cases.
Bundling JS syntax alone does **not** normalize the module's allocator ABI,
supply missing imports or establish full computational equivalence.

The known-good `buffers-fallback.js` stays in place. After generating
`Examples/BufferArena/buffers-generated-candidate.js`, open
`Examples/BufferArena/generated-fallback-probe.html` in Firefox 52.9 ESR.
It attempts to load the candidate via the **same** BufferArena adapter,
checks allocation/memory behavior and compares outputs against the
handwritten backend. It displays FAIL if the candidate lacks the expected
function exports or memory contract. Only after this passes on XP should
we consider a module-specific adapter and changing the default fallback.

For host regression, `node Tests/test_legacy_compat_node.js` exercises
native-fetch loading, optional XHR loading, and fallback when WebAssembly
is disabled. This Node check cannot establish FF52 compatibility.
Current versions of the external tools, the browser UI, and the generated
fallback should be recorded when debugging output differences.

## Compatibility and security cautions

Run only trusted modules and fallback scripts. A JavaScript fallback has the
origin and privileges of its embedding page; do not treat a Wasm-to-JS
translation as a sandbox or an API security boundary. Preserve CSP and
same-origin restrictions. Build-time validators can reject unsupported
feature families, but imports, ABI behavior, browser policies and numerical
corner cases still require explicit per-module tests.
