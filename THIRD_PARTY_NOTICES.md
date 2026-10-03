# Third-party notices

WasmBridge is distributed under the MIT License in `LICENSE`. The following third-party projects are used by the build and validation workflow. WasmBridge SDK releases may bundle the pinned toolchain under `Toolchain/`; the original upstream license/notice files copied with those distributions must be preserved.

## WebAssembly Binary Toolkit (WABT) 1.0.42

Apache License 2.0. Preserve the upstream copyright, license text, and any applicable NOTICE attributions when redistributing WABT or modified files.

https://github.com/WebAssembly/wabt/blob/main/LICENSE

## Binaryen version_133

Apache License 2.0. Preserve the upstream copyright, license text, and any applicable NOTICE attributions when redistributing Binaryen or modified files.

https://github.com/WebAssembly/binaryen

## esbuild 0.28.2

MIT License. Preserve the upstream copyright and permission notice when redistributing esbuild.

https://github.com/evanw/esbuild/blob/main/LICENSE.md

## Emscripten 6.0.10 / emsdk payload

Emscripten contains code under the MIT License and the University of Illinois/NCSA Open Source License. The emsdk payload can also contain LLVM/Clang, Node.js, Python and other third-party components under their own licenses. WasmBridge does not replace or supersede those terms; the exact upstream license and notice files contained in the imported `Toolchain/emsdk` distribution must remain with the bundled SDK.

https://github.com/emscripten-core/emscripten/blob/main/LICENSE

## Firefox 52 test profile

`Toolchain/Firefox52-TestProfile` contains WasmBridge test-profile configuration only. A Firefox executable is not required on the XP runtime distribution unless a distributor deliberately includes one; any redistributed Mozilla binaries remain subject to Mozilla's applicable licenses and trademark policies.

## Generated output

Generated `.wasm` and JavaScript examples should be reviewed against the compiler/toolchain used to produce them. This project does not claim ownership of third-party source or runtime code that may be embedded by a toolchain.
