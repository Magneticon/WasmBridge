# Changelog

## 0.7.0 — 2026-09-28

- Added an optional `build-emscripten` backend that emits standalone Wasm for
  the existing runtime, supports Windows `emcc.bat` launchers, declares C
  exports explicitly, uses library-style `--no-entry` linking, and disables
  known post-MVP instruction families.
- Added a build-host contract test for Emscripten invocation, output/header
  verification and invalid export rejection. WABT validation and Firefox 52
  execution remain mandatory before an Emscripten-built module is shipped.
- Added a reproducible Emscripten 6.0.10 HelloWorld fixture and a dedicated
  Firefox 52 acceptance page that requires the native Wasm backend.
- Made the isolated Firefox acceptance profile explicitly enable WebAssembly,
  preventing intended Wasm cases from passing silently through JS fallback.
- Extended the Emscripten command to compile multiple C/C++ sources with
  include directories and preprocessor definitions, including robust Windows
  batch-launcher quoting for paths containing spaces.

## 0.6.0 — 2026-09-28

- Added a Firefox 52-compatible general multi-module runtime with owned byte,
  typed-array and UTF-8 buffers, scoped cleanup, disposal, imports, configurable
  limits, structured fallback diagnostics and typed function contracts.
- Added manifest-driven v0.2 package loading and strict offline package
  verification with containment, artifact, hash, schema and Wasm-header checks.
- Added WABT, Binaryen and esbuild host-toolchain integration plus a recorded,
  hash-checked generated BufferArena fallback candidate.
- Hardened the bounded Wasm/JavaScript allocator with adjacent-block coalescing,
  free-tail reclamation and allocation-churn tests.
- Added reproducible x86/x64 build helpers and a complete validation matrix for
  native, managed, Node, package, toolchain and Firefox 52 Wasm/fallback paths.
- Verified HelloWorld, ImageProcessing, BufferArena, generated fallback,
  GeneralModule and PackageLoader acceptance pages in 32-bit Firefox 52.9 ESR.

This is the first tagged WasmBridge development release. Windows outputs retain
the XP-compatible `v141_xp` and .NET Framework 4.0 targets.
