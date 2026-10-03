# WasmBridge 0.8 Programmer's Guide

WasmBridge helps move portable computational code into WebAssembly while retaining a Firefox 52 / Windows XP-compatible browser path and an optional JavaScript fallback.

## 1. Choose what belongs in Wasm

Keep DOM/UI/network/storage code in JavaScript. Move self-contained algorithms—parsers, codecs, image/audio processing, math, binary transformations—into C/C++ or another toolchain that can produce a compatible `.wasm` module.

WasmBridge is not a universal JavaScript or C# transpiler. Existing JavaScript generally remains the host/fallback. Existing C# code should either have its portable algorithmic core moved to C/C++, or be compiled by an external C#→Wasm toolchain whose output is then treated like any other third-party Wasm module.

## 2. C and C++

Expose a flat C ABI. For C++ keep classes/templates internally and export wrappers:

```cpp
extern "C" int filter_apply(unsigned char *data, unsigned int bytes) {
    return engine::Filter::apply(data, bytes);
}
```

Prefer numbers plus pointer/length pairs. Avoid exposing C++ object layouts, exceptions, STL containers or OS handles across the JS/Wasm boundary.

Compile wasm32 for Firefox 52:

```text
WasmBridge.exe build --source filter.c --out filter.wasm --address-bits 32 --export filter_apply
```

Compile memory64 for a modern engine:

```text
WasmBridge.exe build --source filter.c --out filter64.wasm --address-bits 64 --export filter_apply
```

Emscripten may be used for larger C/C++ projects with `build-emscripten`; memory64 requests add `MEMORY64=1`.

## 3. wasm32 versus memory64

wasm32 addresses are i32. A returned i32 pointer may look negative in JavaScript above `0x7fffffff`; WasmBridge normalizes it to an unsigned address before bounds checks.

memory64 addresses are i64 and cross the JavaScript boundary as BigInt. A 64-bit native browser process does not imply memory64; the module itself determines the Wasm memory address type.

Export `wb_address_bits()` when using the WasmBridge allocator. The runtime detects it automatically. Third-party memory64 modules that do not expose that function can pass `addressBits: 64` explicitly.

## 4. Memory ownership

The general API never returns a persistent typed-array view into Wasm memory. `memory.grow()` can detach/replace the backing buffer, so WasmBridge creates fresh views for each operation and returns copies to callers.

Allocate and release explicitly:

```js
var h = module.allocate(4096);
try {
    module.write(h, inputBytes);
    var output = module.read(h);
} finally {
    module.release(h);
}
```

Use `withBuffer()` for scoped ownership:

```js
var result = module.withBuffer(4096, function (h) {
    module.write(h, input);
    module.call("process", h.pointer, h.byteLength);
    return module.read(h);
});
```

Released records are removed from active bookkeeping, so long-running allocate/free workloads do not accumulate stale JS records. Released and foreign handles are rejected if reused.

## 5. Memory limits

WasmBridge 0.8 does not impose a default maximum buffer size, memory size or handle count. The allocator/runtime grow until the engine/address space refuses further allocation.

Optional policy limits remain available:

```js
maxBufferBytes: 64 * 1024 * 1024,
maxMemoryBytes: 256 * 1024 * 1024,
maxHandles: 1024
```

These are application quotas, not compatibility limits.

## 6. General module loading

```html
<script src="Runtime/wasmbridge.js"></script>
<script src="Runtime/module.js"></script>
```

```js
WasmBridgeModule.load({
    wasm: "module.wasm",
    fallback: MyFallback,
    fallbackGlobal: "MyFallback",
    exports: ["process", "active_count"],
    allocator: {
        allocate: "wb_alloc",
        release: "wb_free",
        capacity: "wb_capacity"
    },
    signatures: {
        process: {parameters: ["i32", "i32"], result: "i32"},
        active_count: {parameters: [], result: "i32"}
    }
}).then(function (module) {
    // use module
});
```

For memory64 contracts use `i64` and BigInt values in modern engines. Do not put `i64` contracts into a Firefox 52 package.

## 7. Strings and typed arrays

Supported typed-copy names are `u8`, `u8c`, `i8`, `u16`, `i16`, `u32`, `i32`, `f32`, `f64`.

```js
module.writeTyped(h, "f32", new Float32Array([1, 2, 3]));
var copy = module.readTyped(h, "f32", 3);
```

UTF-8 helpers:

```js
var text = module.allocateString("hello");
module.call("consume_string", text.pointer);
module.release(text);
```

`writeString` uses UTF-8 and null-terminates by default.

## 8. JavaScript fallback

A fallback should expose the same callable export names and equivalent memory/allocator semantics if the higher-level adapter expects them. WasmBridge chooses fallback when Wasm is unavailable, disabled, fails to load/instantiate, lacks required exports, or fails an ABI validator.

Keep the fallback independent enough that it can catch errors in the native implementation rather than reproducing the same bug mechanically.

## 9. Packages

A v0.2 package can record the Wasm binary, fallback, low-level runtime, module runtime, allocator metadata, signatures and hashes. `verify-package` checks containment, expected artifacts, hashes and the Wasm header. Function contracts may use `i64` for modern memory64 modules.

Optional packaged adapters are loaded by `Runtime/package.js` before the module is created.

Manifest hashes detect accidental modification; they are not publisher signatures. Serve packages only from trusted locations.

## 10. Firefox 52 compatibility

Firefox 52 is the legacy acceptance gate and uses wasm32. Keep browser JavaScript as classic scripts and avoid modern syntax unsupported by that browser. `validate-legacy` disables post-MVP Wasm features including memory64.

The definitive XP test is:

```text
node Tools\Serve-Examples.js 8084 192.168.255.2
```

then open:

```text
http://192.168.255.2:8084/Examples/WasmSelfTest/index.html
```

on XP Firefox 52.9 ESR.

## 11. JavaScript migration

Do not try to translate an entire web app into Wasm. Identify hot pure functions. Keep the original JS implementation as reference/fallback, port the algorithm to C/C++, then compare output byte-for-byte. WasmBridge's BufferArena tests use this pattern.

## 12. C# migration

WasmBridge itself does not compile C# or ship a CLR in the browser. For legacy Firefox the reliable approach is to extract portable algorithms from C# and port them to C/C++. Replace object references with handles/IDs, arrays with pointer+length pairs, delegates with numeric callback IDs/imports, and exceptions with explicit error codes.

A modern external C#→Wasm compiler may also be used, but its output must satisfy the target engine and WasmBridge ABI. A runtime-heavy managed Wasm stack is unlikely to be appropriate for Firefox 52.

## 13. Allocator ABI

`Core/buffers.c` uses dynamic metadata rather than a fixed descriptor array. Wasm free blocks split on reuse, adjacent blocks coalesce, and free tail space is reclaimed. Native builds allocate metadata dynamically around the CRT heap.

`wb_free` rejects unknown/double-free raw pointers. The JS layer adds stronger stale/foreign-handle ownership checking.

## 14. Disposal

`dispose()` releases all active owned handles. If a backend release fails, the module remains usable for cleanup and reports `remainingHandles`; a later `dispose()` may retry. Successful releases are not repeated.

## 15. Testing

Use three layers:

1. direct binary tests (`Tests/test_wasm_binary_node.js`);
2. adapter/runtime regressions (`Tests/test_*_node.js`);
3. actual Firefox 52 acceptance (`Examples/WasmSelfTest`).

The 0.8 suite specifically checks the removal of the former 16/32 MiB and 128-handle ceilings. `test_memory64_node.js` additionally exercises i64/BigInt addressing when the installed Node/V8 supports memory64 and otherwise reports SKIP.

## 16. Release checklist

- Build XP x86/x64.
- Run CLI native self-tests.
- Rebuild/validate Wasm fixtures.
- Run every Node regression.
- Run Firefox 52 acceptance on XP.
- Verify packages.
- Create release archive and SHA-256 sidecar with `Tools/New-Release.ps1`.

For exact method names and command syntax, see `API_REFERENCE.md`; for address-space details see `MEMORY_AND_ADDRESSING.md`.
