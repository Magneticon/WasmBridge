# WasmBridge bundled toolchain

WasmBridge is intended to be a self-contained SDK tree. Host-side compiler and validation tools live under this `Toolchain` directory so build/test scripts do not depend on machine-specific paths such as `C:\CODEX\TOOLS\WasmBridge`.

Expected pinned layout:

```text
Toolchain/
  binaryen-version_133/
  emsdk/
  esbuild-0.28.2/
  Firefox52-TestProfile/
  wabt-1.0.42/
```

The Windows XP runtime/browser machine does **not** need this toolchain. It is for building, validating and packaging WasmBridge on the development host.

Use `Tools\Import-Toolchain.ps1` to copy an existing prepared toolset into this directory. The importer deliberately omits nested source-control metadata and transient caches.

The third-party projects remain under their own licenses. Keep their original license/notice files with the copied tool directories and see `THIRD_PARTY_NOTICES.md` for WasmBridge's notices.
