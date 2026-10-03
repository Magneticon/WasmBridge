/* Host-side preflight for the optional Binaryen/esbuild BufferArena candidate.
   It does not replace the Firefox 52 generated-fallback-probe.html gate.

   With no arguments this validates the checked-in candidate and its metadata.
   If the checked-in candidate was generated from an older buffers.wasm, the
   test reports SKIP instead of falsely certifying it against the new binary.

   Passing a candidate path (and optionally a wasm path) tests a freshly
   generated candidate directly, without relying on checked-in metadata. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), crypto = require("crypto");
const root = path.resolve(__dirname, "..");
const checkedInCandidate = path.join(root, "Examples/BufferArena/buffers-generated-candidate.js");
const checkedInWasm = path.join(root, "Examples/BufferArena/buffers.wasm");
const explicitCandidate = process.argv[2] ? path.resolve(process.argv[2]) : null;
const candidatePath = explicitCandidate || checkedInCandidate;
const inputPath = process.argv[3] ? path.resolve(process.argv[3]) : checkedInWasm;

if (!fs.existsSync(candidatePath)) throw new Error("Generated fallback candidate not found: " + candidatePath);
if (!fs.existsSync(inputPath)) throw new Error("Input wasm not found: " + inputPath);
function sha256(filename) { return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex"); }

if (!explicitCandidate) {
    const metadataPath = path.join(root, "Examples/BufferArena/buffers-generated-candidate.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const inputHash = sha256(inputPath);
    const candidateHash = sha256(candidatePath);
    if (inputHash !== metadata.inputSha256 || candidateHash !== metadata.outputSha256) {
        console.log("SKIP: checked-in generated fallback belongs to an older buffers.wasm; fresh candidate is validated by Test-ExternalToolchain.ps1.");
        process.exit(0);
    }
}

const ctx = {
    Promise, ArrayBuffer, Uint8Array, Uint8ClampedArray, Int8Array,
    Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
    Math, Object, Number, String, RangeError, Error, TypeError
};
ctx.window = ctx;
vm.createContext(ctx);
for (const relative of ["Runtime/wasmbridge.js", "Runtime/module.js", "Examples/BufferArena/buffers-fallback.js"])
    vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), ctx, {filename: relative});
vm.runInContext(fs.readFileSync(candidatePath, "utf8"), ctx, {filename: candidatePath});

const allocator = {allocate: "wb_alloc", release: "wb_free", capacity: "wb_capacity"};
const base = {wasm: "unused.wasm", exports: ["wb_active_count", "wb_invert_rgba"], allocator, preferWasm: false};
function same(a, b) { assert.deepStrictEqual(Array.from(a), Array.from(b)); }

(async () => {
    const generated = await ctx.WasmBridgeModule.load({...base, fallback: ctx.WasmBridgeGeneratedCandidate});
    const reference = await ctx.WasmBridgeModule.load({...base, fallback: ctx.WasmBridgeBuffersFallback});
    for (const size of [1, 16, 256, 512]) {
        const count = size * size * 4, input = new Uint8Array(count);
        for (let i = 0; i < count; ++i) input[i] = (i * 17 + 13) & 255;
        const source = generated.allocate(count), output = generated.allocate(count);
        generated.write(source, input);
        assert.strictEqual(generated.call("wb_invert_rgba", source.pointer, output.pointer, count), count);
        const actual = generated.read(output), expectedSource = reference.allocate(count), expectedOutput = reference.allocate(count);
        reference.write(expectedSource, input);
        assert.strictEqual(reference.call("wb_invert_rgba", expectedSource.pointer, expectedOutput.pointer, count), count);
        same(actual, reference.read(expectedOutput));
        generated.release(output); generated.release(source);
        reference.release(expectedOutput); reference.release(expectedSource);
    }
    assert.strictEqual(generated.statistics().activeHandles, 0);
    assert.strictEqual(generated.call("wb_active_count"), 0);
    for (const module of [generated, reference]) {
        const a = module.allocate(64), b = module.allocate(64), guard = module.allocate(64);
        const firstPointer = a.pointer;
        module.release(a); module.release(b);
        const combined = module.allocate(120);
        assert.strictEqual(combined.pointer, firstPointer);
        module.release(combined); module.release(guard);
        assert.strictEqual(module.statistics().activeHandles, 0);
    }
    console.log("PASS: generated Binaryen/esbuild candidate matches the handwritten fallback for 1, 16, 256 and 512 pixel RGBA cases.");
})().catch(error => { console.error(error); process.exitCode = 1; });
