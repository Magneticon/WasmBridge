/* BufferArena adapter: owned handles, typed-array copies and dynamic memory growth.
 * Firefox 52 remains wasm32; modern memory64 modules can opt in through an
 * exported wb_address_bits() or addressBits:64. No arbitrary memory limits are
 * imposed unless the caller explicitly configures them. */
(function (root) {
    "use strict";
    var PAGE = 65536, MAX_SAFE_INTEGER = 9007199254740991;
    var EXPORTS = ["wb_alloc", "wb_free", "wb_capacity", "wb_invert_rgba", "wb_active_count"];
    var TYPES = {
        u8: Uint8Array, u8c: Uint8ClampedArray, i8: Int8Array,
        u16: Uint16Array, i16: Int16Array,
        u32: Uint32Array, i32: Int32Array,
        f32: Float32Array, f64: Float64Array
    };

    function arrayType(name) {
        if (!Object.prototype.hasOwnProperty.call(TYPES, name))
            throw new TypeError("Unsupported buffer element type: " + name);
        return TYPES[name];
    }

    function matchesTypedArray(value, Constructor) {
        return value && Object.prototype.toString.call(value) ===
            Object.prototype.toString.call(new Constructor(0));
    }

    function requireInteger(value, minimum, maximum, label) {
        if (typeof value !== "number" || value !== Math.floor(value) ||
            value < minimum || value > maximum)
            throw new RangeError(label + " must be an integer from " + minimum + " to " + maximum + ".");
    }

    function optionalPositiveInteger(value, label) {
        if (typeof value === "undefined" || value === null) return null;
        requireInteger(value, 1, MAX_SAFE_INTEGER, label);
        return value;
    }

    function detectAddressBits(api, options) {
        var bits = options.addressBits;
        if (typeof bits !== "undefined" && bits !== null) {
            if (bits !== 32 && bits !== 64) throw new RangeError("addressBits must be 32 or 64.");
            return bits;
        }
        if (typeof api.wb_address_bits === "function") {
            bits = api.wb_address_bits();
            if (bits === 32 || bits === 64) return bits;
        }
        return 32; /* WasmBridge <=0.7 BufferArena binaries are wasm32. */
    }

    function requireBigInt(bits) {
        if (bits === 64 && typeof root.BigInt !== "function")
            throw new Error("64-bit WebAssembly addressing requires JavaScript BigInt support.");
    }

    function abiUnsigned(value, bits, label) {
        if (bits === 64) {
            requireBigInt(bits);
            if (typeof value !== "bigint" || value < root.BigInt(0))
                throw new TypeError(label + " must be a non-negative i64/BigInt value.");
            return value;
        }
        if (typeof value !== "number" || value !== Math.floor(value) ||
            value < -2147483648 || value > 4294967295)
            throw new TypeError(label + " must be an i32-compatible integer.");
        return value < 0 ? value + 4294967296 : value;
    }

    function abiFromNumber(value, bits, label) {
        requireInteger(value, 0, MAX_SAFE_INTEGER, label);
        if (bits === 64) {
            requireBigInt(bits);
            return root.BigInt(value);
        }
        if (value > 4294967295) throw new RangeError(label + " exceeds the wasm32 unsigned range.");
        return value;
    }

    function abiIndex(value, bits, label) {
        value = abiUnsigned(value, bits, label);
        if (bits === 64) {
            if (value > root.BigInt(MAX_SAFE_INTEGER))
                throw new RangeError(label + " exceeds JavaScript's safe ArrayBuffer index range.");
            return Number(value);
        }
        return value;
    }

    function isZero(value, bits) {
        return bits === 64 ? value === root.BigInt(0) : value === 0;
    }

    function resultMatches(value, expected, bits) {
        if (bits === 64) return typeof value === "bigint" && value === root.BigInt(expected);
        return abiUnsigned(value, 32, "WASM result") === expected;
    }

    function validate(exportsObject, options) {
        var memory = exportsObject.memory;
        var bits = detectAddressBits(exportsObject, options || {});
        requireBigInt(bits);
        if (!memory || !(memory.buffer instanceof ArrayBuffer) || typeof memory.grow !== "function")
            throw new Error("BufferArena requires exported growable linear memory.");
        if (exportsObject.wb_active_count() < 0) throw new Error("Invalid active allocation count.");
        var request = abiFromNumber(8, bits, "Validation allocation");
        var ptr = abiUnsigned(exportsObject.wb_alloc(request), bits, "Validation pointer");
        try {
            var capacityValue = isZero(ptr, bits) ? abiFromNumber(0, bits, "capacity") :
                abiUnsigned(exportsObject.wb_capacity(ptr), bits, "Validation capacity");
            var pointerIndex = abiIndex(ptr, bits, "Validation pointer");
            var capacity = abiIndex(capacityValue, bits, "Validation capacity");
            if (isZero(ptr, bits) || capacity < 8 || pointerIndex < 1 ||
                pointerIndex > memory.buffer.byteLength || capacity > memory.buffer.byteLength - pointerIndex)
                throw new Error("BufferArena module returned an invalid allocation.");
            var view = new Uint8Array(memory.buffer, pointerIndex, 4);
            view.set([1, 2, 3, 4]);
            if (!resultMatches(exportsObject.wb_invert_rgba(ptr, ptr, request === 8 ? 4 : abiFromNumber(4, bits, "bytes")), 4, bits) ||
                view[0] !== 254 || view[1] !== 253 || view[2] !== 252 || view[3] !== 4)
                throw new Error("BufferArena module failed ABI smoke test.");
        } finally {
            if (!isZero(ptr, bits) && exportsObject.wb_free(ptr) !== 1)
                throw new Error("BufferArena failed to release test allocation.");
        }
    }

    function makeAdapter(processor, options) {
        var api = processor.exports, memory = api.memory, records = [], ownerToken = {};
        var bits = detectAddressBits(api, options);
        var maxBufferBytes = optionalPositiveInteger(options.maxBufferBytes, "Maximum buffer size");
        var maxMemoryBytes = optionalPositiveInteger(options.maxMemoryBytes, "Maximum linear memory size");
        var maxHandles = optionalPositiveInteger(options.maxHandles, "Maximum handle count");
        validate(api, options);

        function recordIndex(handle) {
            if (!handle || handle._wasmBridgeOwner !== ownerToken)
                throw new Error("Unknown buffer handle (or a handle from another instance).");
            for (var i = 0; i < records.length; ++i) if (records[i].handle === handle) return i;
            throw new Error("Buffer handle was released.");
        }

        function resolve(handle) { return records[recordIndex(handle)]; }

        function view(record, length) {
            if (length < 0 || length > record.length || record.index < 1 ||
                record.index > memory.buffer.byteLength || length > memory.buffer.byteLength - record.index)
                throw new RangeError("Allocation lies outside current linear memory.");
            return new Uint8Array(memory.buffer, record.index, length);
        }

        function growFor(bytes) {
            var pages = Math.max(1, Math.ceil(bytes / PAGE) + 1);
            var growthBytes = pages * PAGE;
            if (maxMemoryBytes !== null &&
                (memory.buffer.byteLength > maxMemoryBytes || growthBytes > maxMemoryBytes - memory.buffer.byteLength))
                throw new RangeError("Configured linear-memory budget reached.");
            try {
                if (bits === 64) {
                    try { memory.grow(root.BigInt(pages)); }
                    catch (first) {
                        if (!(first instanceof TypeError)) throw first;
                        memory.grow(pages); /* transitional engines before final memory64 JS API */
                    }
                } else memory.grow(pages);
            } catch (error) {
                var failure = new RangeError("WebAssembly memory.grow could not satisfy the allocation request.");
                failure.cause = error;
                throw failure;
            }
        }

        function allocate(bytes) {
            requireInteger(bytes, 1, MAX_SAFE_INTEGER, "Buffer length");
            if (maxBufferBytes !== null && bytes > maxBufferBytes)
                throw new RangeError("Configured maximum buffer size reached.");
            if (maxHandles !== null && records.length >= maxHandles)
                throw new RangeError("Configured active-handle limit reached.");
            var request = abiFromNumber(bytes, bits, "Buffer length");
            var ptr = abiUnsigned(api.wb_alloc(request), bits, "Allocator pointer");
            if (isZero(ptr, bits)) {
                growFor(bytes);
                ptr = abiUnsigned(api.wb_alloc(request), bits, "Allocator pointer");
            }
            var capacityValue = isZero(ptr, bits) ? abiFromNumber(0, bits, "capacity") :
                abiUnsigned(api.wb_capacity(ptr), bits, "Allocator capacity");
            var pointerIndex = abiIndex(ptr, bits, "Allocator pointer");
            var capacity = abiIndex(capacityValue, bits, "Allocator capacity");
            if (isZero(ptr, bits) || capacity < bytes || pointerIndex < 1 ||
                pointerIndex > memory.buffer.byteLength || capacity > memory.buffer.byteLength - pointerIndex) {
                if (!isZero(ptr, bits)) api.wb_free(ptr);
                throw new Error("Allocator failed or returned invalid pointer/capacity.");
            }
            var handle = Object.freeze({pointer: ptr, byteOffset: pointerIndex, capacity: capacity,
                byteLength: bytes, addressBits: bits, _wasmBridgeOwner: ownerToken});
            records.push({handle: handle, pointer: ptr, index: pointerIndex, capacity: capacity, length: bytes});
            return handle;
        }

        function release(handle) {
            var index = recordIndex(handle), record = records[index];
            if (api.wb_free(record.pointer) !== 1) throw new Error("Module rejected release.");
            records.splice(index, 1);
        }

        function write(handle, data) {
            var record = resolve(handle);
            if (!matchesTypedArray(data, Uint8Array) && !matchesTypedArray(data, Uint8ClampedArray))
                throw new TypeError("write expects Uint8Array or Uint8ClampedArray.");
            if (data.length > record.length) throw new RangeError("Input exceeds buffer length.");
            view(record, data.length).set(data);
        }

        function read(handle, bytes) {
            var record = resolve(handle);
            if (typeof bytes === "undefined") bytes = record.length;
            requireInteger(bytes, 0, record.length, "Read size");
            var result = new Uint8Array(bytes);
            result.set(view(record, bytes));
            return result;
        }

        function writeTyped(handle, type, values) {
            var record = resolve(handle), Constructor = arrayType(type);
            if (!matchesTypedArray(values, Constructor))
                throw new TypeError("Typed input does not match requested element type: " + type);
            var count = values.length, bytes = count * Constructor.BYTES_PER_ELEMENT;
            if (bytes > record.length) throw new RangeError("Typed data exceeds buffer length.");
            new Constructor(memory.buffer, record.index, count).set(values);
        }

        function readTyped(handle, type, count) {
            var record = resolve(handle), Constructor = arrayType(type);
            if (typeof count === "undefined") count = Math.floor(record.length / Constructor.BYTES_PER_ELEMENT);
            requireInteger(count, 0, Math.floor(record.length / Constructor.BYTES_PER_ELEMENT), "Typed element count");
            var result = new Constructor(count);
            result.set(new Constructor(memory.buffer, record.index, count));
            return result;
        }

        function rgbaBytes(width, height) {
            requireInteger(width, 1, MAX_SAFE_INTEGER, "RGBA width");
            requireInteger(height, 1, MAX_SAFE_INTEGER, "RGBA height");
            if (width > Math.floor(MAX_SAFE_INTEGER / height / 4))
                throw new RangeError("RGBA dimensions overflow JavaScript's safe integer range.");
            return width * height * 4;
        }

        function invertRGBA(source, destination, width, height) {
            var input = resolve(source), output = resolve(destination);
            var bytes = rgbaBytes(width, height);
            if (bytes > input.length || bytes > output.length)
                throw new RangeError("RGBA image exceeds source or destination buffer length.");
            var processed = api.wb_invert_rgba(input.pointer, output.pointer,
                abiFromNumber(bytes, bits, "RGBA byte count"));
            if (!resultMatches(processed, bytes, bits))
                throw new Error("RGBA module rejected processing request.");
            return bytes;
        }

        function processRGBA(pixels, width, height) {
            if (!matchesTypedArray(pixels, Uint8Array) && !matchesTypedArray(pixels, Uint8ClampedArray))
                throw new TypeError("Pixels must be a Uint8Array or Uint8ClampedArray.");
            var bytes = rgbaBytes(width, height);
            if (pixels.length !== bytes) throw new RangeError("Pixel length does not match dimensions.");
            var src = null, dst = null, result = null, primaryError = null, cleanupError = null;
            try {
                src = allocate(bytes);
                dst = allocate(bytes);
                write(src, pixels);
                invertRGBA(src, dst, width, height);
                result = new Uint8ClampedArray(bytes);
                result.set(read(dst));
            } catch (error) { primaryError = error; }
            if (dst) try { release(dst); } catch (error1) { cleanupError = error1; }
            if (src) try { release(src); } catch (error2) { if (!cleanupError) cleanupError = error2; }
            if (primaryError) {
                if (cleanupError) primaryError.cleanupError = cleanupError;
                throw primaryError;
            }
            if (cleanupError) throw cleanupError;
            return result;
        }

        return {
            backend: processor.backend,
            diagnostic: processor.diagnostic,
            addressBits: bits,
            allocate: allocate, release: release, write: write, read: read,
            writeTyped: writeTyped, readTyped: readTyped,
            invertRGBA: invertRGBA, processRGBA: processRGBA,
            statistics: function () {
                return {bytesInLinearMemory: memory.buffer.byteLength,
                    activeBlocks: api.wb_active_count(), activeHandles: records.length,
                    addressBits: bits, maxBufferBytes: maxBufferBytes,
                    maxMemoryBytes: maxMemoryBytes, maxHandles: maxHandles};
            }
        };
    }

    function load(options) {
        options = options || {};
        if (!root.WasmBridge || typeof root.WasmBridge.load !== "function")
            return Promise.reject(new Error("Load wasmbridge.js before buffers.js."));
        return root.WasmBridge.load({
            wasm: options.wasm,
            fallback: options.fallback,
            fallbackGlobal: options.fallbackGlobal || "WasmBridgeBuffersFallback",
            imports: options.imports || {},
            preferWasm: options.preferWasm,
            exports: EXPORTS,
            validateWasm: function (api) { validate(api, options); }
        }).then(function (processor) { return makeAdapter(processor, options); });
    }

    root.WasmBridgeBuffers = {load: load, maxBufferBytes: null, version: "0.8.0"};
}(this));
