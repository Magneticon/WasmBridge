# Changelog

## 0.8.0 — 2026-10-02

- Removed the framework-wide 16 MiB per-buffer, 32 MiB linear-memory and 128-allocation ceilings. Limits are now supplied only when an application explicitly configures quotas; otherwise allocation is bounded by the Wasm engine/browser/address space.
- Replaced the fixed Wasm allocator descriptor table with dynamic in-memory block metadata, free-block splitting, adjacent coalescing and tail reclamation. Native metadata is dynamic as well.
- Added `wb_address_bits()` and dual wasm32/memory64 runtime handling. wasm32 pointer results are normalized as unsigned values; memory64 pointers remain BigInt values on modern engines.
- Added CLI `--address-bits 32|64` for Clang and Emscripten builds. Firefox 52 remains wasm32; `validate-legacy` continues to reject memory64.
- Removed stale JavaScript handle-record accumulation and made `dispose()` retryable after backend release failures.
- Made BufferArena cleanup attempt both source and destination releases even when one cleanup fails.
- Fixed packaged adapter loading, synchronous instantiate failure classification, cross-realm RGBA typed arrays, malformed test-server URLs, v141_xp toolset discovery and native-only environment checks.
- Unknown CLI options now fail instead of being silently ignored.
- Added direct tests for >32 MiB memory, >128 live allocations, block splitting/coalescing, 2048×2048 RGBA, retryable disposal and optional memory64/BigInt operation.
- Refreshed the programming/API/getting-started documentation for the new memory/addressing model.

## 0.7.0 — 2026-09-28

- Added optional standalone Emscripten C/C++ compilation, reproducible fixture tests and Firefox 52 acceptance.
- Added multi-source/include/define support and robust Windows batch-launcher handling.

## 0.6.0 — 2026-09-28

- Added the general multi-module runtime, package loading/verification, host toolchain integration and complete validation matrix.

Windows outputs retain the XP-compatible `v141_xp` and .NET Framework 4.0 targets.
