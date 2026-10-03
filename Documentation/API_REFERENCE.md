# WasmBridge 0.8 API reference

## `WasmBridge.load(options)`

Low-level loader in `Runtime/wasmbridge.js`.

Important options: `wasm`, `fallback`, `fallbackGlobal`, `imports`, `exports`, `preferWasm`, `validateWasm`.

Resolves to an adapter containing `backend`, `diagnostic`, `failurePhase`, `wasmFailure`, `instance`, `exports`, and direct wrappers for declared exports. Failure phases include `load`, `instantiate`, `exports`, `abi`, `unavailable`, `configuration` and `disabled`.

## `WasmBridgeModule.load(options)`

General API in `Runtime/module.js`.

Options include:

- `exports`: public callable exports.
- `allocator`: `{allocate, release, capacity?}`.
- `memoryExport`: defaults to `memory`.
- `signatures`: optional i32/i64/f32/f64/void contracts.
- `addressBits`: optional `32` or `64`; normally auto-detected through `wb_address_bits()` and otherwise defaults to legacy wasm32.
- `growMemory`: set `false` to disable host-side growth/retry.
- `maxBufferBytes`, `maxMemoryBytes`, `maxHandles`: optional caller quotas. No quota is imposed when omitted.

Returned methods: `call`, `allocate`, `release`, `write`, `read`, `writeTyped`, `readTyped`, `writeString`, `readString`, `allocateString`, `withBuffer`, `dispose`, `statistics`.

A buffer handle contains `pointer` (Number for wasm32, BigInt for memory64), checked numeric `byteOffset`, `capacity`, `byteLength` and `addressBits`. Handles are owned by one module instance. Released or foreign handles are rejected.

`dispose()` is retryable: if a backend release fails, successfully released handles stay released but failed handles remain active and the module is not marked disposed.

## `WasmBridgeBuffers.load(options)`

Specialized BufferArena adapter providing allocation, copies, typed copies, `invertRGBA`, `processRGBA` and statistics. It has no built-in 16/32 MiB or 128-handle ceilings.

## `WasmBridgeRGBA.load(options)`

Scratch-buffer demo adapter. Its 512×512 limit is intentional because `Core/image.c` exports one fixed-size scratch buffer. It is separate from the general allocator.

## `WasmBridgePackage.load(options)`

Loads v0.1/v0.2 manifests, required runtime scripts, optional `adapter`, optional module runtime, then creates the low-level or general module. Returns the module with `packageManifest`, `packageUrl` and `packageAdapterLoaded`.

## Buffer C ABI

```c
unsigned char *wb_alloc(wb_size_t bytes);
int wb_free(unsigned char *pointer);
wb_size_t wb_capacity(unsigned char *pointer);
wb_size_t wb_invert_rgba(unsigned char *source, unsigned char *destination, wb_size_t bytes);
uint32_t wb_active_count(void);
uint32_t wb_address_bits(void);
```

wasm32 uses 32-bit `wb_size_t`; wasm64 uses 64-bit. `wb_address_bits()` reports the compiled pointer width.

## CLI

```text
build --source FILE --out FILE [--clang FILE] [--export A,B] [--address-bits 32|64]
build-emscripten --source FILE --out FILE [--emcc FILE] [--export A,B] [--address-bits 32|64]
validate-legacy --wasm FILE --validator FILE
generate-fallback --wasm FILE --out FILE --validator FILE --wasm2js FILE --esbuild FILE [--global NAME]
optimize-legacy --wasm FILE --out FILE --validator FILE --optimizer FILE
package --wasm FILE --fallback FILE --runtime FILE --out DIR [...]
verify --wasm FILE
verify-package --manifest FILE
self-test
```

Unknown command-line switches are rejected rather than silently ignored.
