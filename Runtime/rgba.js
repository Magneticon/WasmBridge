/* WasmBridge RGBA8 adapter; classic script, Firefox 52 compatible.
   Accepts a typed pixel array; returns a separate Uint8ClampedArray. */
(function (root) {
    "use strict";
    var NAMES = ["wb_rgba_buffer", "wb_rgba_capacity", "wb_rgba_invert"];
    var MAX_SIDE = 512;
    var MAX_BYTES = MAX_SIDE * MAX_SIDE * 4;

    function checkMemory(exportsObject) {
        if (!exportsObject.memory || !exportsObject.memory.buffer ||
            !(exportsObject.memory.buffer instanceof ArrayBuffer)) {
            throw new Error("RGBA module must export linear memory.");
        }
    }

    function validDimensions(width, height, input) {
        if (typeof width !== "number" || typeof height !== "number" ||
            width !== Math.floor(width) || height !== Math.floor(height) ||
            width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
            throw new RangeError("RGBA dimensions must be integers from 1 to 512.");
        }
        if (!(input instanceof Uint8Array) && !(input instanceof Uint8ClampedArray)) {
            throw new TypeError("RGBA input must be Uint8Array or Uint8ClampedArray.");
        }
        if (input.length !== width * height * 4) {
            throw new RangeError("RGBA input length must equal width * height * 4.");
        }
    }

    function load(options) {
        options = options || {};
        if (!root.WasmBridge || typeof root.WasmBridge.load !== "function") {
            return Promise.reject(new Error("Load wasmbridge.js before rgba.js."));
        }
        return root.WasmBridge.load({
            wasm: options.wasm,
            fallback: options.fallback,
            fallbackGlobal: options.fallbackGlobal || "WasmBridgeRGBAFallback",
            preferWasm: options.preferWasm,
            imports: options.imports || {},
            exports: NAMES,
            validateWasm: function (exportsObject) {
                checkMemory(exportsObject);
                if (exportsObject.wb_rgba_capacity() < MAX_BYTES) {
                    throw new Error("RGBA module buffer capacity is too small.");
                }
            }
        }).then(function (processor) {
            var exportsObject = processor.exports;
            checkMemory(exportsObject);
            return {
                backend: processor.backend,
                diagnostic: processor.diagnostic,
                capacity: exportsObject.wb_rgba_capacity(),
                processRGBA: function (pixels, width, height) {
                    validDimensions(width, height, pixels);
                    var bytes = pixels.length;
                    var capacity = exportsObject.wb_rgba_capacity();
                    var offset = exportsObject.wb_rgba_buffer();
                    var memory = exportsObject.memory;
                    /* Obtain the current buffer on every call; growth detaches old views. */
                    var buffer = memory.buffer;
                    if (capacity < bytes || capacity > buffer.byteLength ||
                        offset < 0 || offset !== Math.floor(offset) ||
                        offset + capacity > buffer.byteLength) {
                        throw new RangeError("RGBA module returned invalid buffer bounds.");
                    }
                    var view = new Uint8Array(buffer, offset, bytes);
                    view.set(pixels);
                    if (exportsObject.wb_rgba_invert(width, height) !== bytes) {
                        throw new Error("RGBA module rejected the image or returned wrong byte count.");
                    }
                    if (buffer !== memory.buffer) {
                        buffer = memory.buffer;
                        if (offset + bytes > buffer.byteLength) {
                            throw new RangeError("RGBA output lies outside grown memory.");
                        }
                        view = new Uint8Array(buffer, offset, bytes);
                    }
                    var result = new Uint8ClampedArray(bytes);
                    result.set(view);
                    return result;
                }
            };
        });
    }

    root.WasmBridgeRGBA = { load: load, version: "0.2.0", maxSide: MAX_SIDE };
}(this));
