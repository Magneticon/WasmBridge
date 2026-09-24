/* Optional development-host Node test. The actual XP Firefox test remains manual. */
"use strict";
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "Examples/ImageProcessing/rgba.wasm"));
const ctx = {
    WebAssembly, Promise, ArrayBuffer, Uint8Array, Uint8ClampedArray,
    Math, RangeError, Error, TypeError,
    fetch: async () => ({
        ok: true,
        arrayBuffer: async () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
    })
};
vm.createContext(ctx);
for (const rel of ["Runtime/wasmbridge.js", "Runtime/rgba.js", "Examples/ImageProcessing/rgba-fallback.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), ctx, {filename: rel});
}
(async () => {
    const options = {wasm: "rgba.wasm", fallback: ctx.WasmBridgeRGBAFallback};
    const native = await ctx.WasmBridgeRGBA.load(options);
    const js = await ctx.WasmBridgeRGBA.load({...options, preferWasm: false});
    assert.strictEqual(native.backend, "wasm");
    assert.strictEqual(js.backend, "javascript");
    let cases = 0;
    for (const [width, height] of [[1, 1], [2, 2], [13, 7], [256, 128], [512, 512]]) {
        const input = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < input.length; i++) input[i] = (i * 7 + 31) & 255;
        const actual = native.processRGBA(input, width, height);
        const fallback = js.processRGBA(input, width, height);
        assert.deepStrictEqual(Array.from(actual), Array.from(fallback));
        for (let i = 0; i < input.length; i += 4) {
            assert.strictEqual(actual[i], 255 - input[i]);
            assert.strictEqual(actual[i + 1], 255 - input[i + 1]);
            assert.strictEqual(actual[i + 2], 255 - input[i + 2]);
            assert.strictEqual(actual[i + 3], input[i + 3]);
        }
        assert.strictEqual(input[0], 31, "input was modified");
        cases++;
    }
    assert.throws(() => native.processRGBA(new Uint8Array(4), 513, 1), RangeError);
    assert.throws(() => native.processRGBA(new Uint8Array(3), 1, 1), RangeError);
    assert.throws(() => native.processRGBA(new Uint8Array(4), 0, 1), RangeError);
    ctx.fetch = async () => ({ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer});
    const recovered = await ctx.WasmBridgeRGBA.load({
        wasm: "broken.wasm", fallback: ctx.WasmBridgeRGBAFallback
    });
    assert.strictEqual(recovered.backend, "javascript");
    assert.ok(recovered.diagnostic.length > 0);
    assert.deepStrictEqual(
        Array.from(recovered.processRGBA(new Uint8Array([7, 8, 9, 10]), 1, 1)),
        [248, 247, 246, 10]
    );
    console.log("PASS: " + cases + " RGBA vectors: Wasm equals JS; alpha preserved; " +
                "invalid sizes rejected; corrupt Wasm uses JS fallback.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
