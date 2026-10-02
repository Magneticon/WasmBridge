/* Host regression for Runtime/package.js. The Firefox 52 example is the
   browser acceptance test for dynamic classic-script loading. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = path.resolve(__dirname, "..");
const binary = fs.readFileSync(path.join(root, "Examples/BufferArena/buffers.wasm"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "Examples/PackageLoader/manifest.json"), "utf8"));

function makeContext() {
    const loaded = [];
    const ctx = {
        WebAssembly, Promise, ArrayBuffer, Uint8Array, Uint8ClampedArray,
        Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
        Float32Array, Float64Array, Math, Object, Number, String, JSON,
        RangeError, Error, TypeError,
        fetch: () => Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(binary.buffer.slice(
                binary.byteOffset, binary.byteOffset + binary.byteLength))
        })
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, "Examples/BufferArena/buffers-fallback.js"), "utf8"), ctx);
    vm.runInContext(fs.readFileSync(path.join(root, "Runtime/package.js"), "utf8"), ctx);
    ctx.loadScript = url => {
        loaded.push(url);
        let file;
        if (url.indexOf("wasmbridge.js") >= 0) file = "Runtime/wasmbridge.js";
        else if (url.indexOf("module.js") >= 0) file = "Runtime/module.js";
        else throw new Error("Unexpected script URL: " + url);
        vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, {filename: file});
        return Promise.resolve();
    };
    ctx.loaded = loaded;
    return ctx;
}

async function load(ctx, preferWasm) {
    return ctx.WasmBridgePackage.load({
        manifest: "http://localhost/Examples/PackageLoader/manifest.json",
        jsonLoader: () => Promise.resolve(manifest),
        scriptLoader: ctx.loadScript,
        fallback: ctx.WasmBridgeBuffersFallback,
        preferWasm
    });
}

(async () => {
    const wasmContext = makeContext();
    const wasm = await load(wasmContext, true);
    assert.strictEqual(wasm.backend, "wasm");
    assert.strictEqual(wasm.packageManifest.format, "wasmbridge-package-0.2");
    assert.strictEqual(wasmContext.loaded.length, 2);
    assert.throws(() => wasm.call("wb_active_count", 1), /expects 0 arguments/);
    const input = wasm.allocate(8), output = wasm.allocate(8);
    wasm.write(input, new Uint8Array([1, 2, 3, 4, 200, 100, 0, 128]));
    assert.strictEqual(wasm.call("wb_invert_rgba", input.pointer, output.pointer, 8), 8);
    assert.deepStrictEqual(Array.from(wasm.read(output)), [254, 253, 252, 4, 55, 155, 255, 128]);
    wasm.release(output); wasm.release(input);
    assert.strictEqual(wasm.statistics().activeHandles, 0);

    const fallbackContext = makeContext();
    const fallback = await load(fallbackContext, false);
    assert.strictEqual(fallback.backend, "javascript");
    assert.strictEqual(fallback.failurePhase, "disabled");

    await assert.rejects(
        fallbackContext.WasmBridgePackage.load({manifest: "bad", jsonLoader: () => Promise.resolve({format: "unknown"})}),
        error => error.phase === "manifest"
    );
    console.log("PASS: v0.2 package loading, relative assets, Wasm/fallback execution and manifest failures.");
})().catch(error => { console.error(error); process.exitCode = 1; });
