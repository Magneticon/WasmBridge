# WasmBridge API reference

This reference describes the public browser APIs and build-host commands in
WasmBridge 0.7. Runtime files are classic scripts and are compatible with the
Firefox 52.9 ESR baseline. Load scripts in the order shown; every operation is
asynchronous at module load time and synchronous after a module is returned.

For the full programming model, source-language porting guidance (JavaScript,
C, C++, C#), ABI design, memory ownership, packaging workflow, validation,
Firefox 52 deployment, and troubleshooting, read
[PROGRAMMING_GUIDE.md](PROGRAMMING_GUIDE.md).

## Low-level loader: `WasmBridge`

```html
<script src="Runtime/wasmbridge.js"></script>
```

Call `WasmBridge.load(options)`. It returns a `Promise` for an adapter with
`backend` (`"wasm"` or `"javascript"`), `exports`, `diagnostic`, and one
callable method for every declared export.

```js
WasmBridge.load({
    wasm: "add.wasm",
    fallback: "add.js",             // optional if fallback is not wanted
    fallbackGlobal: "WasmBridgeFallback",
    exports: ["add"],
    imports: {},                      // optional WebAssembly imports
    preferWasm: true,                // false forces the fallback
    validateWasm: function (exports, instance) {
        if (!exports.memory) throw new Error("memory export required");
    }
}).then(function (module) {
    console.log(module.backend, module.add(20, 22));
});
```

If Wasm is unavailable, cannot be fetched, fails instantiation, has missing
exports, or fails `validateWasm`, the loader selects the supplied fallback.
`module.failurePhase` and `module.wasmFailure.phase` identify `unavailable`,
`load`, `instantiate`, `exports`, `abi`, `disabled`, or `configuration`.
The loader never returns a borrowed view into Wasm memory.

## RGBA adapter: `WasmBridgeRGBA`

Load `wasmbridge.js` followed by `rgba.js`. `WasmBridgeRGBA.load(options)`
returns a Promise for an adapter with `processRGBA(pixels, width, height)`.
The adapter copies input and output, preserves alpha, and accepts dimensions
from 1 through 512 pixels per side.

```js
WasmBridgeRGBA.load({
    wasm: "rgba.wasm",
    fallback: "rgba-fallback.js",
    fallbackGlobal: "WasmBridgeRGBAFallback"
}).then(function (rgba) {
    var output = rgba.processRGBA(imageData.data, 256, 160);
});
```

## Buffer adapter: `WasmBridgeBuffers`

Load `wasmbridge.js` followed by `buffers.js`. The adapter owns handles and
copies data in both directions. Handles are invalid after `release`; memory
growth is handled internally and callers must never retain Wasm-memory views.

```js
WasmBridgeBuffers.load({
    wasm: "buffers.wasm",
    fallback: "buffers-fallback.js",
    fallbackGlobal: "WasmBridgeBuffersFallback"
}).then(function (buffers) {
    var source = buffers.allocate(8);
    var destination = buffers.allocate(8);
    try {
        buffers.write(source, new Uint8Array([1, 2, 3, 4, 200, 100, 0, 128]));
        buffers.invertRGBA(source, destination, 2, 1);
        var result = buffers.read(destination);
    } finally {
        buffers.release(destination);
        buffers.release(source);
    }
});
```

The public methods are `allocate`, `release`, `write`, `read`, `writeTyped`,
`readTyped`, `invertRGBA`, `processRGBA`, and `statistics`. Typed names are
`u8`, `u8c`, `i8`, `u16`, `i16`, `u32`, `i32`, `f32`, and `f64`.

## General module API: `WasmBridgeModule`

Load `wasmbridge.js` followed by `module.js`, then call
`WasmBridgeModule.load(options)`. The returned instance provides direct
declared calls plus owned buffers, typed copies, UTF-8 strings, scoped cleanup,
and disposal.

```js
WasmBridgeModule.load({
    wasm: "module.wasm",
    fallback: fallbackObjectOrUrl,
    exports: ["add", "wb_invert_rgba"],
    allocator: { allocate: "wb_alloc", release: "wb_free", capacity: "wb_capacity" },
    memoryExport: "memory",
    signatures: {
        add: { parameters: ["i32", "i32"], result: "i32" }
    }
}).then(function (module) {
    var handle = module.allocateString("hello", true);
    try {
        console.log(module.call("add", 20, 22));
        console.log(module.readString(handle));
    } finally {
        module.release(handle);
        module.dispose();
    }
});
```

Useful lifecycle helpers are `withBuffer(bytes, callback)`,
`allocateString(text, nullTerminate)`, `writeString`, `readString`, and
`dispose()`. `withBuffer` releases its handle after synchronous callbacks or
after returned Promises settle. Disposal is idempotent and rejects later
operations. Signature types are `i32`, `f32`, `f64`, and `void`; `i64` is not
supported by this Firefox-52 numeric API.

## Package loader: `WasmBridgePackage`

Load `package.js` after the runtime files, then load a trusted manifest:

```js
WasmBridgePackage.load({manifest: "dist/manifest.json"})
    .then(function (module) { console.log(module.backend); });
```

The loader resolves all assets relative to the manifest, loads runtime layers
in order, and delegates to the low-level or general module API according to
the manifest format (`wasmbridge-package-0.1` or `wasmbridge-package-0.2`).
Manifest hashes are audit metadata; `verify-package` must be run before
deployment and the package source must be trusted.

## Build-host CLI

After building the solution, `WasmBridge.exe` supports:

```text
build --source file.c --out file.wasm --export add
build-emscripten --sources a.c;b.cpp --out file.wasm --export add --include inc --define FEATURE
package --wasm file.wasm --fallback fallback.js --runtime Runtime\wasmbridge.js --out dist
verify-package --manifest dist\manifest.json
validate-legacy --wasm file.wasm --validator path\wasm-validate.exe
optimize-legacy --wasm file.wasm --out optimized.wasm --optimizer path\wasm-opt.exe --validator path\wasm-validate.exe
generate-fallback --wasm file.wasm --out candidate.js --validator path --wasm2js path --esbuild path
```

The Emscripten command is an optional build-host dependency. It emits
standalone Wasm without JavaScript glue, rejects invalid export names, and
disables known post-MVP feature families. Always run restricted WABT
validation and the Firefox 52 acceptance page before shipping its output.

## Compatibility and ownership rules

Use classic scripts only: no modules, async/await, optional chaining, BigInt,
threads, SIMD, or post-MVP Wasm instructions in the legacy path. Load only
trusted Wasm, fallback scripts, and manifests. Browser tests use an isolated
profile with `javascript.options.wasm` explicitly enabled; a modern-browser
PASS does not replace Firefox 52 acceptance.
