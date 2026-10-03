# WasmBridge memory and addressing model

## Address width is not browser-process bitness

WasmBridge distinguishes two independent properties:

- **host/browser process width** — 32-bit or 64-bit native process;
- **WebAssembly memory address width** — wasm32 (`i32` addresses) or memory64 (`i64` addresses).

Firefox 52 on Windows XP uses wasm32 even when the operating system itself is XP x64. Modern 64-bit browsers may run either wasm32 or memory64 modules.

## wasm32

wasm32 pointers are 32-bit values. JavaScript engines expose Wasm `i32` results as signed Numbers, so addresses above `0x7fffffff` may arrive as negative values. WasmBridge canonicalizes pointer/capacity values to the unsigned range before validating or indexing memory.

The theoretical linear-address range is 4 GiB. The practical amount available in a 32-bit Firefox process can be much lower because JavaScript, JIT code, browser structures and other allocations share the native process address space.

## memory64

A memory64 module uses `i64` memory addresses. JavaScript exposes those address values as `BigInt`. WasmBridge 0.8 detects `wb_address_bits()` when the module exports it, or accepts `addressBits: 64` explicitly.

The general runtime preserves the BigInt pointer in `handle.pointer` and also stores a checked numeric `handle.byteOffset` for `ArrayBuffer`/typed-array access. Addresses that cannot be represented safely by JavaScript's numeric indexing model are rejected instead of silently rounded.

Firefox 52 does not support memory64; memory64 is a modern-engine path only.

## No arbitrary framework ceilings

WasmBridge 0.8 has no default maximum linear-memory byte count, individual buffer size or live-handle count.

The runtime asks the allocator to allocate. If it reports failure, WasmBridge grows exported memory and retries. If `memory.grow()` or the allocator ultimately fails, the allocation fails.

Applications may deliberately configure quotas through `maxBufferBytes`, `maxMemoryBytes` and `maxHandles`. Those are opt-in policy controls, not WasmBridge defaults.

## Allocator

`Core/buffers.c` no longer uses a fixed 128-entry descriptor table. wasm builds keep allocation headers inside linear memory; native builds keep dynamically allocated metadata. Free blocks are split when a smaller request reuses them, adjacent free blocks are coalesced, and free tail address space is reclaimed for later allocations. WebAssembly linear memory itself does not shrink after `memory.grow()`.

The raw ABI cannot distinguish every stale pointer after an address has been freed and later reused. The JavaScript runtime therefore wraps raw addresses in instance-owned handles and rejects released/foreign handles before reaching the raw ABI.

## ABI

`Core/buffers.h` defines `wb_size_t` as 32-bit for wasm32 and 64-bit for wasm64. `wb_address_bits()` reports the actual pointer width of the compiled target.

For modern packages, function signatures may include `i64`; those calls require JavaScript BigInt support. Firefox 52 packages should stay with `i32`, `f32`, `f64` and `void` contracts.

## Demo-specific bounds

The old `Runtime/rgba.js` / `Core/image.c` example still uses a fixed 512×512 scratch buffer by design. That is an ABI property of that example, not a WasmBridge memory limit. Use the general allocator API for arbitrary-size data.
