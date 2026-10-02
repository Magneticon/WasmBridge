/* Direct WebAssembly binary regression tests.
 * These deliberately bypass WasmBridge's JavaScript adapters so that broken
 * module exports, allocator state or linear-memory behavior cannot be hidden
 * by a wrapper/fallback implementation. Firefox 52 has a separate browser
 * acceptance page under Examples/WasmSelfTest. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function loadModule(relativePath) {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    assert.strictEqual(WebAssembly.validate(bytes), true,
        relativePath + " is not a valid WebAssembly module");
    const module = new WebAssembly.Module(bytes);
    assert.strictEqual(WebAssembly.Module.imports(module).length, 0,
        relativePath + " must remain standalone (no imports)");
    return {module, instance: new WebAssembly.Instance(module, {})};
}

function requireExports(module, names, label) {
    const available = WebAssembly.Module.exports(module).map(function (entry) { return entry.name; });
    names.forEach(function (name) {
        assert.ok(available.indexOf(name) >= 0, label + " is missing export " + name);
    });
}

function bytesAt(memory, pointer, count) {
    return Array.from(new Uint8Array(memory.buffer, pointer, count));
}

(function testHelloWorld() {
    const loaded = loadModule("Examples/HelloWorld/add.wasm");
    requireExports(loaded.module, ["add"], "HelloWorld");
    const add = loaded.instance.exports.add;
    assert.strictEqual(add(20, 22), 42);
    assert.strictEqual(add(-10, 3), -7);
    assert.strictEqual(add(2147483647, 1), -2147483648, "i32 addition must wrap");
}());

(function testEmscriptenStandaloneFixture() {
    const loaded = loadModule("Examples/EmscriptenHelloWorld/add.wasm");
    requireExports(loaded.module, ["memory", "add"], "Emscripten fixture");
    assert.strictEqual(loaded.instance.exports.add(123, -23), 100);
    assert.ok(loaded.instance.exports.memory.buffer.byteLength >= 65536,
        "Emscripten standalone fixture must export linear memory");
}());

(function testRgbaModuleDirectly() {
    const loaded = loadModule("Examples/ImageProcessing/rgba.wasm");
    requireExports(loaded.module,
        ["memory", "wb_rgba_buffer", "wb_rgba_capacity", "wb_rgba_invert"],
        "RGBA module");
    const api = loaded.instance.exports;
    const pointer = api.wb_rgba_buffer();
    const capacity = api.wb_rgba_capacity();
    assert.strictEqual(capacity, 512 * 512 * 4);
    assert.ok(pointer > 0 && pointer + capacity <= api.memory.buffer.byteLength,
        "RGBA scratch buffer must lie inside exported memory");

    const input = [1, 2, 3, 4, 20, 40, 80, 160, 255, 128, 0, 33, 9, 10, 11, 12];
    const memory = new Uint8Array(api.memory.buffer);
    memory.set(input, pointer);
    memory[pointer + input.length] = 0x5a;
    assert.strictEqual(api.wb_rgba_invert(2, 2), input.length);
    assert.deepStrictEqual(bytesAt(api.memory, pointer, input.length),
        [254, 253, 252, 4, 235, 215, 175, 160, 0, 127, 255, 33, 246, 245, 244, 12]);
    assert.strictEqual(new Uint8Array(api.memory.buffer)[pointer + input.length], 0x5a,
        "RGBA processing wrote beyond the selected image");

    assert.strictEqual(api.wb_rgba_invert(2, 2), input.length, "second inversion should succeed");
    assert.deepStrictEqual(bytesAt(api.memory, pointer, input.length), input,
        "two inversions must restore the original RGBA bytes");

    assert.strictEqual(api.wb_rgba_invert(0, 1), -1);
    assert.strictEqual(api.wb_rgba_invert(1, 0), -1);
    assert.strictEqual(api.wb_rgba_invert(-1, 1), -1);
    assert.strictEqual(api.wb_rgba_invert(513, 1), -1);
    assert.strictEqual(api.wb_rgba_invert(1, 513), -1);

    const maximum = new Uint8Array(api.memory.buffer, pointer, capacity);
    for (let i = 0; i < maximum.length; i += 4) {
        maximum[i] = 0;
        maximum[i + 1] = 17;
        maximum[i + 2] = 255;
        maximum[i + 3] = (i >>> 2) & 255;
    }
    assert.strictEqual(api.wb_rgba_invert(512, 512), capacity);
    assert.deepStrictEqual(Array.from(maximum.subarray(0, 4)), [255, 238, 0, 0]);
    assert.deepStrictEqual(Array.from(maximum.subarray(capacity - 4)), [255, 238, 0, 255]);
}());

(function testBufferAllocatorDirectly() {
    const loaded = loadModule("Examples/BufferArena/buffers.wasm");
    requireExports(loaded.module,
        ["memory", "wb_alloc", "wb_free", "wb_capacity", "wb_active_count", "wb_invert_rgba"],
        "BufferArena module");
    const api = loaded.instance.exports;

    assert.strictEqual(api.wb_active_count(), 0);
    assert.strictEqual(api.wb_alloc(0), 0);
    assert.strictEqual(api.wb_alloc(-1), 0);
    assert.strictEqual(api.wb_alloc(32 * 1024 * 1024), 0,
        "a single allocation cannot consume the complete 32 MiB address budget");

    const first = api.wb_alloc(1);
    const second = api.wb_alloc(9);
    assert.ok(first > 0 && second > 0 && first !== second);
    assert.strictEqual(first & 7, 0, "allocator pointers must be 8-byte aligned");
    assert.strictEqual(second & 7, 0, "allocator pointers must be 8-byte aligned");
    assert.strictEqual(api.wb_capacity(first), 8);
    assert.strictEqual(api.wb_capacity(second), 16);
    assert.strictEqual(api.wb_active_count(), 2);

    new Uint8Array(api.memory.buffer, second, 8).set([1, 2, 3, 4, 200, 100, 0, 128]);
    assert.strictEqual(api.wb_invert_rgba(second, second, 8), 8,
        "exact in-place RGBA processing must be supported");
    assert.deepStrictEqual(bytesAt(api.memory, second, 8), [254, 253, 252, 4, 55, 155, 255, 128]);
    assert.strictEqual(api.wb_invert_rgba(second, second, 7), -1);
    assert.strictEqual(api.wb_invert_rgba(second + 1, second, 4), -1,
        "interior pointers must not be accepted as allocation handles");

    assert.strictEqual(api.wb_free(first), 1);
    assert.strictEqual(api.wb_capacity(first), 0);
    assert.strictEqual(api.wb_free(first), 0, "double free must be rejected");
    assert.strictEqual(api.wb_free(second), 1);
    assert.strictEqual(api.wb_active_count(), 0);
}());

(function testMemoryGrowthRetention() {
    const api = loadModule("Examples/BufferArena/buffers.wasm").instance.exports;
    const pointer = api.wb_alloc(64);
    assert.ok(pointer > 0);
    new Uint8Array(api.memory.buffer, pointer, 8).set([9, 8, 7, 6, 5, 4, 3, 2]);
    const before = api.memory.buffer.byteLength;
    api.memory.grow(1);
    assert.strictEqual(api.memory.buffer.byteLength, before + 65536,
        "one memory.grow page must add exactly 64 KiB");
    assert.deepStrictEqual(bytesAt(api.memory, pointer, 8), [9, 8, 7, 6, 5, 4, 3, 2],
        "live allocation data must survive memory.grow");
    assert.strictEqual(api.wb_capacity(pointer), 64);
    assert.strictEqual(api.wb_free(pointer), 1);
}());

(function testDescriptorLimitAndReuse() {
    const api = loadModule("Examples/BufferArena/buffers.wasm").instance.exports;
    const pointers = [];
    for (let i = 0; i < 128; ++i) {
        const pointer = api.wb_alloc(8);
        assert.ok(pointer > 0, "allocation slot " + i + " unexpectedly failed");
        pointers.push(pointer);
    }
    assert.strictEqual(api.wb_active_count(), 128);
    assert.strictEqual(api.wb_alloc(8), 0, "129th descriptor must be rejected");

    const middle = pointers[64];
    assert.strictEqual(api.wb_free(middle), 1);
    assert.strictEqual(api.wb_active_count(), 127);
    assert.strictEqual(api.wb_alloc(8), middle,
        "first-fit allocator should reuse a released exact-size middle block");
    assert.strictEqual(api.wb_active_count(), 128);

    for (let i = 0; i < pointers.length; ++i)
        assert.strictEqual(api.wb_free(pointers[i]), 1, "cleanup free failed at slot " + i);
    assert.strictEqual(api.wb_active_count(), 0);
}());

(function testCoalescingAndSeparateBuffers() {
    const api = loadModule("Examples/BufferArena/buffers.wasm").instance.exports;
    const a = api.wb_alloc(64), b = api.wb_alloc(64), guard = api.wb_alloc(64);
    assert.ok(a && b && guard);
    assert.strictEqual(api.wb_free(a), 1);
    assert.strictEqual(api.wb_free(b), 1);
    const combined = api.wb_alloc(120);
    assert.strictEqual(combined, a, "adjacent free blocks should coalesce and be reused");
    assert.ok(api.wb_capacity(combined) >= 120);
    assert.strictEqual(api.wb_free(combined), 1);
    assert.strictEqual(api.wb_free(guard), 1);

    const source = api.wb_alloc(8), destination = api.wb_alloc(8);
    new Uint8Array(api.memory.buffer, source, 8).set([12, 100, 200, 9, 0, 255, 127, 77]);
    assert.strictEqual(api.wb_invert_rgba(source, destination, 8), 8);
    assert.deepStrictEqual(bytesAt(api.memory, destination, 8), [243, 155, 55, 9, 255, 0, 128, 77]);
    assert.deepStrictEqual(bytesAt(api.memory, source, 8), [12, 100, 200, 9, 0, 255, 127, 77],
        "separate-buffer processing must leave the source unchanged");
    assert.strictEqual(api.wb_free(destination), 1);
    assert.strictEqual(api.wb_free(source), 1);
    assert.strictEqual(api.wb_active_count(), 0);
}());

(function testMalformedWasmRejection() {
    const invalid = [
        new Uint8Array([1, 2, 3, 4]),
        new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 255])
    ];
    invalid.forEach(function (bytes, index) {
        assert.strictEqual(WebAssembly.validate(bytes), false, "malformed case " + index + " validated");
        assert.throws(function () { return new WebAssembly.Module(bytes); }, WebAssembly.CompileError);
    });
}());

console.log("PASS: direct WASM binaries, exports, i32 semantics, RGBA bounds/max size, " +
    "allocator alignment/reuse/coalescing/slot limit, memory growth retention, Emscripten standalone ABI, " +
    "and malformed-module rejection.");
