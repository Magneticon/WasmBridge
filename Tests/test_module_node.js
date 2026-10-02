/* Host regression for the general v0.5 module API. Actual Firefox 52 remains
   the legacy browser acceptance target. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = path.resolve(__dirname, "..");
const buffersBinary = fs.readFileSync(path.join(root, "Examples/BufferArena/buffers.wasm"));
const importBinary = Buffer.from([
    0,97,115,109,1,0,0,0,1,6,1,96,1,127,1,127,2,18,1,4,104,111,115,116,9,
    105,110,99,114,101,109,101,110,116,0,0,3,2,1,0,7,18,1,14,99,97,108,
    108,95,105,110,99,114,101,109,101,110,116,0,1,10,8,1,6,0,32,0,16,0,11
]);
let activeBinary = buffersBinary;
const ctx = {
    WebAssembly, Promise, ArrayBuffer, Uint8Array, Uint8ClampedArray,
    Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
    Float32Array, Float64Array, Math, Object, Number, String,
    RangeError, Error, TypeError,
    fetch: () => Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(activeBinary.buffer.slice(
            activeBinary.byteOffset, activeBinary.byteOffset + activeBinary.byteLength))
    })
};
ctx.window = ctx;
vm.createContext(ctx);
for (const relative of ["Runtime/wasmbridge.js", "Runtime/module.js",
                        "Examples/BufferArena/buffers-fallback.js"])
    vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), ctx, {filename: relative});

const allocator = {allocate: "wb_alloc", release: "wb_free", capacity: "wb_capacity"};
const bufferOptions = {
    wasm: "buffers.wasm",
    fallback: ctx.WasmBridgeBuffersFallback,
    exports: ["wb_active_count", "wb_invert_rgba"],
    allocator,
    signatures: {
        wb_active_count: {parameters: [], result: "i32"},
        wb_invert_rgba: {parameters: ["i32", "i32", "i32"], result: "i32"}
    }
};

function bytes(value) { return Array.from(value); }

(async () => {
    const first = await ctx.WasmBridgeModule.load(bufferOptions);
    const second = await ctx.WasmBridgeModule.load(bufferOptions);
    assert.strictEqual(first.backend, "wasm");
    assert.strictEqual(second.backend, "wasm");
    assert.strictEqual(first.call("wb_active_count"), 0);
    assert.throws(() => first.call("wb_active_count", 1), /expects 0 arguments/);
    assert.throws(() => first.call("wb_invert_rgba", "bad", 1, 4), /i32-compatible/);

    const limited = await ctx.WasmBridgeModule.load({...bufferOptions, maxHandles: 2});
    const limitedA = limited.allocate(4), limitedB = limited.allocate(4);
    assert.throws(() => limited.allocate(4), /active-handle limit/);
    assert.strictEqual(limited.statistics().maxHandles, 2);
    assert.strictEqual(limited.dispose(), 2);

    const text = "WasmBridge \u2713 \u03a9 \ud83d\ude80";
    const textBytes = ctx.WasmBridgeModule.encodeUTF8(text);
    const textHandle = first.allocate(textBytes.length + 1);
    assert.strictEqual(first.writeString(textHandle, text), textBytes.length + 1);
    assert.strictEqual(first.readString(textHandle), text);
    assert.throws(() => second.read(textHandle), /another module instance/);
    first.release(textHandle);
    assert.throws(() => first.read(textHandle), /released/);

    const typed = first.allocate(64);
    first.writeTyped(typed, "f64", new Float64Array([1.25, -19.5, 0.125]));
    assert.deepStrictEqual(Array.from(first.readTyped(typed, "f64", 3)), [1.25, -19.5, 0.125]);
    first.write(typed, new Uint8Array([9, 8, 7]), 40);
    assert.deepStrictEqual(bytes(first.read(typed, 3, 40)), [9, 8, 7]);
    first.release(typed);
    assert.strictEqual(first.statistics().activeHandles, 0);

    const allocatedText = first.allocateString("scoped \u2713");
    assert.strictEqual(first.readString(allocatedText), "scoped \u2713");
    first.release(allocatedText);
    assert.strictEqual(first.withBuffer(12, handle => {
        first.write(handle, new Uint8Array([4, 5, 6]));
        return first.read(handle, 3)[2];
    }), 6);
    assert.strictEqual(await first.withBuffer(4, handle => Promise.resolve(handle.byteLength)), 4);
    assert.throws(() => first.withBuffer(4, () => { throw new Error("callback failure"); }), /callback failure/);
    await assert.rejects(first.withBuffer(4, () => Promise.reject(new Error("async failure"))), /async failure/);
    assert.strictEqual(first.statistics().activeHandles, 0);

    const leakedOne = first.allocate(4), leakedTwo = first.allocate(8);
    assert.strictEqual(first.dispose(), 2);
    assert.strictEqual(first.statistics().disposed, true);
    assert.strictEqual(first.statistics().activeHandles, 0);
    assert.strictEqual(first.dispose(), 0);
    assert.throws(() => first.read(leakedOne), /disposed/);
    assert.throws(() => first.release(leakedTwo), /disposed/);
    assert.throws(() => first.call("wb_active_count"), /disposed/);

    activeBinary = importBinary;
    const imported = await ctx.WasmBridgeModule.load({
        wasm: "import.wasm",
        fallback: {call_increment: value => value + 1000},
        exports: ["call_increment"],
        imports: {host: {increment: value => value + 1}}
    });
    assert.strictEqual(imported.backend, "wasm");
    assert.strictEqual(imported.call("call_increment", 41), 42);
    assert.strictEqual(imported.statistics().bytesInLinearMemory, 0);
    assert.strictEqual(imported.dispose(), 0);
    assert.throws(() => imported.call("call_increment", 1), /disposed/);

    activeBinary = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 255]);
    const instantiateFallback = await ctx.WasmBridgeModule.load({
        wasm: "broken.wasm", fallback: {answer: () => 42}, exports: ["answer"]
    });
    assert.strictEqual(instantiateFallback.backend, "javascript");
    assert.strictEqual(instantiateFallback.failurePhase, "instantiate");
    assert.strictEqual(instantiateFallback.call("answer"), 42);

    activeBinary = importBinary;
    const exportFallback = await ctx.WasmBridgeModule.load({
        wasm: "import.wasm", fallback: {missing: () => 7}, exports: ["missing"],
        imports: {host: {increment: value => value}}
    });
    assert.strictEqual(exportFallback.failurePhase, "exports");

    activeBinary = buffersBinary;
    const abiFallback = await ctx.WasmBridgeModule.load({
        wasm: "buffers.wasm", fallback: ctx.WasmBridgeBuffersFallback,
        exports: ["wb_active_count"], allocator,
        validateWasm: () => { throw new Error("deliberate ABI rejection"); }
    });
    assert.strictEqual(abiFallback.failurePhase, "abi");

    const disabled = await ctx.WasmBridgeModule.load({...bufferOptions, preferWasm: false});
    assert.strictEqual(disabled.backend, "javascript");
    assert.strictEqual(disabled.failurePhase, "disabled");

    ctx.fetch = () => Promise.reject(new Error("deliberate load failure"));
    const loadFallback = await ctx.WasmBridgeModule.load(bufferOptions);
    assert.strictEqual(loadFallback.failurePhase, "load");

    console.log("PASS: general modules, imports, direct calls, independent instances, strings, typed buffers, stale handles and fallback phases.");
})().catch(error => { console.error(error); process.exitCode = 1; });
