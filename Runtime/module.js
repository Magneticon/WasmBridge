/* WasmBridge 0.8 general module API for Firefox 52 ESR and modern browsers.
 * Classic script only. No arbitrary memory/allocation-count limits are imposed
 * by default. wasm32 uses Number/i32 pointers; memory64 uses BigInt/i64 pointers
 * when the host engine supports them. Memory access always returns copies. */
(function (root) {
    "use strict";

    var PAGE = 65536;
    var MAX_SAFE_INTEGER = 9007199254740991;
    var TYPES = {
        u8: Uint8Array, u8c: Uint8ClampedArray, i8: Int8Array,
        u16: Uint16Array, i16: Int16Array,
        u32: Uint32Array, i32: Int32Array,
        f32: Float32Array, f64: Float64Array
    };

    function own(object, name) {
        return Object.prototype.hasOwnProperty.call(object, name);
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

    function typeConstructor(name) {
        if (!own(TYPES, name)) throw new TypeError("Unsupported element type: " + name);
        return TYPES[name];
    }

    function matchesTypedArray(value, Constructor) {
        return value && Object.prototype.toString.call(value) ===
            Object.prototype.toString.call(new Constructor(0));
    }

    function utf8Encode(text) {
        text = String(text);
        var bytes = [], i, code, next;
        for (i = 0; i < text.length; ++i) {
            code = text.charCodeAt(i);
            if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
                next = text.charCodeAt(i + 1);
                if (next >= 0xdc00 && next <= 0xdfff) {
                    code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                    ++i;
                } else code = 0xfffd;
            } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
            if (code < 0x80) bytes.push(code);
            else if (code < 0x800) {
                bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
            } else if (code < 0x10000) {
                bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
            } else {
                bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63),
                    0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
            }
        }
        return new Uint8Array(bytes);
    }

    function utf8Decode(bytes) {
        var result = "", i = 0, first, code, needed, minimum, next;
        while (i < bytes.length) {
            first = bytes[i++];
            if (first < 0x80) { result += String.fromCharCode(first); continue; }
            if (first >= 0xc2 && first <= 0xdf) { needed = 1; code = first & 31; minimum = 0x80; }
            else if (first >= 0xe0 && first <= 0xef) { needed = 2; code = first & 15; minimum = 0x800; }
            else if (first >= 0xf0 && first <= 0xf4) { needed = 3; code = first & 7; minimum = 0x10000; }
            else { result += "\ufffd"; continue; }
            if (i + needed > bytes.length) { result += "\ufffd"; break; }
            var valid = true;
            for (var j = 0; j < needed; ++j) {
                next = bytes[i + j];
                if ((next & 0xc0) !== 0x80) { valid = false; break; }
                code = (code << 6) | (next & 63);
            }
            if (!valid || code < minimum || code > 0x10ffff ||
                (code >= 0xd800 && code <= 0xdfff)) {
                result += "\ufffd";
                continue;
            }
            i += needed;
            if (code < 0x10000) result += String.fromCharCode(code);
            else {
                code -= 0x10000;
                result += String.fromCharCode(0xd800 | (code >> 10), 0xdc00 | (code & 1023));
            }
        }
        return result;
    }

    function uniqueFunctions(exportsList, allocator) {
        var names = [], i;
        function add(name) {
            if (!name) return;
            for (var j = 0; j < names.length; ++j) if (names[j] === name) return;
            names.push(name);
        }
        for (i = 0; i < exportsList.length; ++i) add(exportsList[i]);
        if (allocator) {
            add(allocator.allocate);
            add(allocator.release);
            add(allocator.capacity);
        }
        return names;
    }

    function validateValue(type, value, label) {
        if (type === "i32") {
            if (typeof value !== "number" || value !== Math.floor(value) ||
                value < -2147483648 || value > 4294967295)
                throw new TypeError(label + " must be an i32-compatible integer.");
            return;
        }
        if (type === "i64") {
            if (typeof value !== "bigint")
                throw new TypeError(label + " must be a BigInt for i64.");
            return;
        }
        if (type === "f32" || type === "f64") {
            if (typeof value !== "number") throw new TypeError(label + " must be a number.");
            return;
        }
        if (type === "void" && typeof value === "undefined") return;
        throw new TypeError("Unsupported or mismatched ABI type: " + type + ".");
    }

    function normalizeSignatures(signatures, publicExports) {
        if (!signatures) return {};
        if (typeof signatures !== "object") throw new TypeError("signatures must be an object.");
        var normalized = {}, name, spec, parameters, result, i, declared;
        for (name in signatures) if (own(signatures, name)) {
            declared = false;
            for (i = 0; i < publicExports.length; ++i)
                if (publicExports[i] === name) { declared = true; break; }
            if (!declared) throw new Error("Signature names an undeclared export: " + name);
            spec = signatures[name];
            if (!spec || typeof spec !== "object" || !Array.isArray(spec.parameters))
                throw new TypeError("Signature parameters must be an array: " + name);
            parameters = spec.parameters.slice(0);
            for (i = 0; i < parameters.length; ++i)
                if (parameters[i] !== "i32" && parameters[i] !== "i64" &&
                    parameters[i] !== "f32" && parameters[i] !== "f64")
                    throw new TypeError("Unsupported parameter type for " + name + ": " + parameters[i]);
            result = typeof spec.result === "undefined" ? "void" : spec.result;
            if (result !== "void" && result !== "i32" && result !== "i64" &&
                result !== "f32" && result !== "f64")
                throw new TypeError("Unsupported result type for " + name + ": " + result);
            normalized[name] = {parameters: parameters, result: result};
        }
        return normalized;
    }

    function detectAddressBits(api, options) {
        var bits = options.addressBits;
        if (typeof bits !== "undefined" && bits !== null) {
            if (bits !== 32 && bits !== 64) throw new RangeError("addressBits must be 32 or 64.");
            return bits;
        }
        if (api && typeof api.wb_address_bits === "function") {
            bits = api.wb_address_bits();
            if (bits === 32 || bits === 64) return bits;
        }
        /* Existing WasmBridge 0.7 modules predate wb_address_bits and are wasm32. */
        return 32;
    }

    function requireBigInt(addressBits) {
        if (addressBits === 64 && typeof root.BigInt !== "function")
            throw new Error("64-bit WebAssembly addressing requires JavaScript BigInt support.");
    }

    function toAbiUnsigned(value, addressBits, label) {
        if (addressBits === 64) {
            requireBigInt(addressBits);
            if (typeof value !== "bigint" || value < root.BigInt(0))
                throw new TypeError(label + " must be a non-negative i64/BigInt value.");
            return value;
        }
        if (typeof value !== "number" || value !== Math.floor(value) ||
            value < -2147483648 || value > 4294967295)
            throw new TypeError(label + " must be an i32-compatible integer.");
        return value < 0 ? value + 4294967296 : value;
    }

    function fromNumberToAbi(value, addressBits, label) {
        requireInteger(value, 0, MAX_SAFE_INTEGER, label);
        if (addressBits === 64) {
            requireBigInt(addressBits);
            return root.BigInt(value);
        }
        if (value > 4294967295)
            throw new RangeError(label + " exceeds the wasm32 unsigned range.");
        return value;
    }

    function abiToIndex(value, addressBits, label) {
        value = toAbiUnsigned(value, addressBits, label);
        if (addressBits === 64) {
            if (value > root.BigInt(MAX_SAFE_INTEGER))
                throw new RangeError(label + " exceeds JavaScript's safe ArrayBuffer index range.");
            return Number(value);
        }
        return value;
    }

    function abiIsZero(value, addressBits) {
        return addressBits === 64 ? value === root.BigInt(0) : value === 0;
    }

    function makeModule(processor, options, publicExports, allocator, signatures) {
        var api = processor.exports;
        var memoryName = options.memoryExport || "memory";
        var memory = api[memoryName] || null;
        var records = [];
        var disposed = false;
        var ownerToken = {};
        var addressBits = detectAddressBits(api, options);
        var maxBufferBytes = optionalPositiveInteger(options.maxBufferBytes, "Maximum buffer size");
        var maxMemoryBytes = optionalPositiveInteger(options.maxMemoryBytes, "Maximum linear memory size");
        var maxHandles = optionalPositiveInteger(options.maxHandles, "Maximum handle count");

        requireBigInt(addressBits);

        if (allocator && (!memory || !(memory.buffer instanceof ArrayBuffer) ||
            typeof memory.grow !== "function"))
            throw new Error("Configured allocator requires exported growable memory: " + memoryName);

        function requireActive() {
            if (disposed) throw new Error("Module instance was disposed.");
        }

        function recordIndex(handle) {
            if (!handle || handle._wasmBridgeOwner !== ownerToken)
                throw new Error("Unknown buffer handle (or a handle from another module instance).");
            for (var i = 0; i < records.length; ++i)
                if (records[i].handle === handle) return i;
            throw new Error("Buffer handle was released.");
        }

        function resolve(handle) {
            requireActive();
            return records[recordIndex(handle)];
        }

        function byteView(record, count, offset) {
            offset = offset || 0;
            if (!memory) throw new Error("Module has no exported memory.");
            if (offset !== Math.floor(offset) || count !== Math.floor(count) ||
                offset < 0 || count < 0 || offset > record.length || count > record.length - offset)
                throw new RangeError("Memory access lies outside the buffer handle.");
            if (record.index < 1 || record.index > memory.buffer.byteLength ||
                count > memory.buffer.byteLength - record.index - offset)
                throw new RangeError("Allocation lies outside current linear memory.");
            return new Uint8Array(memory.buffer, record.index + offset, count);
        }

        function growFor(bytes) {
            var pages = Math.max(1, Math.ceil(bytes / PAGE) + 1);
            var growthBytes = pages * PAGE;
            if (maxMemoryBytes !== null &&
                (memory.buffer.byteLength > maxMemoryBytes ||
                 growthBytes > maxMemoryBytes - memory.buffer.byteLength))
                throw new RangeError("Configured linear-memory budget reached.");
            try {
                if (addressBits === 64) {
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
            requireActive();
            if (!allocator) throw new Error("No allocator was configured for this module.");
            requireInteger(bytes, 1, MAX_SAFE_INTEGER, "Buffer length");
            if (maxBufferBytes !== null && bytes > maxBufferBytes)
                throw new RangeError("Configured maximum buffer size reached.");
            if (maxHandles !== null && records.length >= maxHandles)
                throw new RangeError("Configured active-handle limit reached.");

            var request = fromNumberToAbi(bytes, addressBits, "Buffer length");
            var pointer = toAbiUnsigned(api[allocator.allocate](request), addressBits, "Allocator pointer");
            if (abiIsZero(pointer, addressBits) && options.growMemory !== false) {
                growFor(bytes);
                pointer = toAbiUnsigned(api[allocator.allocate](request), addressBits, "Allocator pointer");
            }
            var capacityValue = !abiIsZero(pointer, addressBits) && allocator.capacity ?
                toAbiUnsigned(api[allocator.capacity](pointer), addressBits, "Allocator capacity") :
                fromNumberToAbi(bytes, addressBits, "Buffer capacity");
            var pointerIndex = abiToIndex(pointer, addressBits, "Allocator pointer");
            var capacity = abiToIndex(capacityValue, addressBits, "Allocator capacity");
            if (abiIsZero(pointer, addressBits) || capacity < bytes ||
                pointerIndex < 1 || pointerIndex > memory.buffer.byteLength ||
                capacity > memory.buffer.byteLength - pointerIndex) {
                if (!abiIsZero(pointer, addressBits)) api[allocator.release](pointer);
                throw new Error("Allocator failed or returned an invalid pointer/capacity.");
            }
            var handle = Object.freeze({
                pointer: pointer, byteOffset: pointerIndex, capacity: capacity,
                byteLength: bytes, addressBits: addressBits, _wasmBridgeOwner: ownerToken
            });
            records.push({handle: handle, pointer: pointer, index: pointerIndex,
                capacity: capacity, length: bytes});
            return handle;
        }

        function release(handle) {
            requireActive();
            if (!allocator) throw new Error("No allocator was configured for this module.");
            var index = recordIndex(handle);
            var record = records[index];
            if (api[allocator.release](record.pointer) !== 1)
                throw new Error("Module rejected buffer release.");
            records.splice(index, 1);
        }

        function write(handle, data, offset) {
            var record = resolve(handle);
            if (!matchesTypedArray(data, Uint8Array) && !matchesTypedArray(data, Uint8ClampedArray))
                throw new TypeError("write expects Uint8Array or Uint8ClampedArray.");
            offset = offset || 0;
            requireInteger(offset, 0, record.length, "Write offset");
            byteView(record, data.length, offset).set(data);
        }

        function read(handle, count, offset) {
            var record = resolve(handle);
            offset = offset || 0;
            requireInteger(offset, 0, record.length, "Read offset");
            if (typeof count === "undefined") count = record.length - offset;
            requireInteger(count, 0, record.length, "Read length");
            var copy = new Uint8Array(count);
            copy.set(byteView(record, count, offset));
            return copy;
        }

        function writeTyped(handle, type, values, elementOffset) {
            var record = resolve(handle), Constructor = typeConstructor(type);
            if (!matchesTypedArray(values, Constructor))
                throw new TypeError("Typed input does not match requested element type: " + type);
            elementOffset = elementOffset || 0;
            requireInteger(elementOffset, 0,
                Math.floor(record.length / Constructor.BYTES_PER_ELEMENT), "Typed element offset");
            var byteOffset = elementOffset * Constructor.BYTES_PER_ELEMENT;
            var bytes = values.length * Constructor.BYTES_PER_ELEMENT;
            byteView(record, bytes, byteOffset);
            new Constructor(memory.buffer, record.index + byteOffset, values.length).set(values);
        }

        function readTyped(handle, type, count, elementOffset) {
            var record = resolve(handle), Constructor = typeConstructor(type);
            elementOffset = elementOffset || 0;
            requireInteger(elementOffset, 0,
                Math.floor(record.length / Constructor.BYTES_PER_ELEMENT), "Typed element offset");
            var byteOffset = elementOffset * Constructor.BYTES_PER_ELEMENT;
            if (typeof count === "undefined")
                count = Math.floor((record.length - byteOffset) / Constructor.BYTES_PER_ELEMENT);
            requireInteger(count, 0, Math.floor(record.length / Constructor.BYTES_PER_ELEMENT), "Typed element count");
            byteView(record, count * Constructor.BYTES_PER_ELEMENT, byteOffset);
            var copy = new Constructor(count);
            copy.set(new Constructor(memory.buffer, record.index + byteOffset, count));
            return copy;
        }

        function writeString(handle, text, nullTerminate, offset) {
            var encoded = utf8Encode(text);
            var terminator = nullTerminate === false ? 0 : 1;
            var bytes = new Uint8Array(encoded.length + terminator);
            bytes.set(encoded);
            write(handle, bytes, offset || 0);
            return bytes.length;
        }

        function readString(handle, maxBytes, offset) {
            var record = resolve(handle);
            offset = offset || 0;
            if (typeof maxBytes === "undefined") maxBytes = record.length - offset;
            requireInteger(maxBytes, 0, record.length, "String byte limit");
            var bytes = read(handle, maxBytes, offset), end = 0;
            while (end < bytes.length && bytes[end] !== 0) ++end;
            return utf8Decode(bytes.subarray(0, end));
        }

        function allocateString(text, nullTerminate) {
            requireActive();
            var encoded = utf8Encode(text);
            var length = encoded.length + (nullTerminate === false ? 0 : 1);
            var handle = allocate(length);
            try {
                writeString(handle, text, nullTerminate);
                return handle;
            } catch (error) {
                try { release(handle); } catch (ignored) {}
                throw error;
            }
        }

        function withBuffer(bytes, callback) {
            requireActive();
            if (typeof callback !== "function") throw new TypeError("withBuffer callback is required.");
            var handle = allocate(bytes), value;
            try { value = callback(handle); }
            catch (error) {
                try { release(handle); } catch (cleanupError) { error.cleanupError = cleanupError; }
                throw error;
            }
            if (value && typeof value.then === "function") {
                return value.then(function (resolved) {
                    release(handle);
                    return resolved;
                }, function (error) {
                    try { release(handle); } catch (cleanupError) { error.cleanupError = cleanupError; }
                    throw error;
                });
            }
            release(handle);
            return value;
        }

        function dispose() {
            if (disposed) return 0;
            var released = 0, firstError = null, i, handle;
            if (allocator) {
                for (i = records.length - 1; i >= 0; --i) {
                    handle = records[i].handle;
                    try {
                        release(handle);
                        ++released;
                    } catch (error) {
                        if (!firstError) firstError = error;
                    }
                }
            }
            if (records.length === 0) disposed = true;
            if (firstError) {
                firstError.remainingHandles = records.length;
                throw firstError;
            }
            disposed = true;
            return released;
        }

        function call(name) {
            requireActive();
            var allowed = false;
            for (var i = 0; i < publicExports.length; ++i)
                if (publicExports[i] === name) { allowed = true; break; }
            if (!allowed) throw new Error("Function was not declared as a public export: " + name);
            var args = Array.prototype.slice.call(arguments, 1);
            var signature = signatures[name], result;
            if (signature) {
                if (args.length !== signature.parameters.length)
                    throw new RangeError(name + " expects " + signature.parameters.length +
                        " arguments, received " + args.length + ".");
                for (i = 0; i < args.length; ++i)
                    validateValue(signature.parameters[i], args[i], name + " argument " + i);
            }
            result = api[name].apply(api, args);
            if (signature) validateValue(signature.result, result, name + " result");
            return result;
        }

        return {
            backend: processor.backend,
            diagnostic: processor.diagnostic,
            failurePhase: processor.failurePhase,
            wasmFailure: processor.wasmFailure,
            addressBits: addressBits,
            call: call,
            allocate: allocate,
            release: release,
            write: write,
            read: read,
            writeTyped: writeTyped,
            readTyped: readTyped,
            writeString: writeString,
            readString: readString,
            allocateString: allocateString,
            withBuffer: withBuffer,
            dispose: dispose,
            statistics: function () {
                return {
                    activeHandles: records.length,
                    bytesInLinearMemory: memory ? memory.buffer.byteLength : 0,
                    disposed: disposed,
                    addressBits: addressBits,
                    maxHandles: maxHandles,
                    maxBufferBytes: maxBufferBytes,
                    maxMemoryBytes: maxMemoryBytes
                };
            }
        };
    }

    function load(options) {
        options = options || {};
        if (!root.WasmBridge || typeof root.WasmBridge.load !== "function")
            return Promise.reject(new Error("Load wasmbridge.js before module.js."));
        var publicExports = options.exports || [];
        if (!Array.isArray(publicExports) || !publicExports.length)
            return Promise.reject(new Error("exports must be a non-empty array."));
        var allocator = options.allocator || null;
        if (allocator && (!allocator.allocate || !allocator.release))
            return Promise.reject(new Error("allocator.allocate and allocator.release are required."));
        var required = uniqueFunctions(publicExports, allocator);
        var signatures;
        try { signatures = normalizeSignatures(options.signatures, publicExports); }
        catch (error) { return Promise.reject(error); }
        return root.WasmBridge.load({
            wasm: options.wasm,
            fallback: options.fallback,
            fallbackGlobal: options.fallbackGlobal,
            imports: options.imports || {},
            preferWasm: options.preferWasm,
            exports: required,
            validateWasm: options.validateWasm
        }).then(function (processor) {
            return makeModule(processor, options, publicExports, allocator, signatures);
        });
    }

    root.WasmBridgeModule = {
        load: load,
        encodeUTF8: utf8Encode,
        decodeUTF8: utf8Decode,
        version: "0.8.0"
    };
}(this));
