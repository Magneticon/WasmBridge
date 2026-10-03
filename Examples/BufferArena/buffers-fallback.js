/* Same wasm32 ABI as Core/buffers.c, without artificial memory/slot ceilings. */
(function (root) {
    "use strict";
    var PAGE = 65536, MAX_SAFE_INTEGER = 9007199254740991;
    var memory = { buffer: new ArrayBuffer(PAGE * 2) };

    memory.grow = function (pages) {
        if (typeof pages !== "number" || pages !== Math.floor(pages) || pages < 0)
            throw new RangeError("JavaScript fallback memory growth must use a non-negative page count.");
        var previous = memory.buffer.byteLength / PAGE;
        if (!pages) return previous;
        var growth = pages * PAGE;
        if (growth > MAX_SAFE_INTEGER - memory.buffer.byteLength)
            throw new RangeError("JavaScript fallback memory size overflow.");
        var expanded = new ArrayBuffer(memory.buffer.byteLength + growth);
        new Uint8Array(expanded).set(new Uint8Array(memory.buffer));
        memory.buffer = expanded;
        return previous;
    };

    var blocks = [], next = 8192;

    function lookup(pointer) {
        pointer = pointer >>> 0;
        for (var i = 0; i < blocks.length; ++i)
            if (blocks[i].pointer === pointer && blocks[i].active) return blocks[i];
        return null;
    }

    function coalesceAndTrim() {
        var changed = true, i, a, b;
        blocks.sort(function (x, y) { return x.pointer - y.pointer; });
        while (changed) {
            changed = false;
            for (i = 0; i + 1 < blocks.length; ++i) {
                a = blocks[i]; b = blocks[i + 1];
                if (!a.active && !b.active && a.pointer + a.capacity === b.pointer) {
                    a.capacity += b.capacity;
                    blocks.splice(i + 1, 1);
                    changed = true;
                    break;
                }
            }
        }
        while (blocks.length) {
            a = blocks[blocks.length - 1];
            if (a.active || a.pointer + a.capacity !== next) break;
            next = a.pointer;
            blocks.pop();
        }
    }

    function alloc(bytes) {
        if (typeof bytes !== "number" || bytes !== Math.floor(bytes) || bytes <= 0 || bytes > 4294967295)
            return 0;
        var size = Math.ceil(bytes / 8) * 8;
        if (size > 4294967295) return 0;
        for (var i = 0; i < blocks.length; ++i) {
            var block = blocks[i];
            if (!block.active && block.capacity >= size) {
                var remainder = block.capacity - size;
                if (remainder >= 8) {
                    blocks.splice(i + 1, 0, {pointer: block.pointer + size, capacity: remainder, active: false});
                    block.capacity = size;
                }
                block.active = true;
                return block.pointer;
            }
        }
        if (next > 4294967295 || size > 4294967296 - next || next + size > memory.buffer.byteLength)
            return 0;
        var pointer = next;
        next += size;
        blocks.push({pointer: pointer, capacity: size, active: true});
        return pointer;
    }

    root.WasmBridgeBuffersFallback = {
        memory: memory,
        wb_address_bits: function () { return 32; },
        wb_alloc: alloc,
        wb_free: function (pointer) {
            var block = lookup(pointer);
            if (!block) return 0;
            block.active = false;
            coalesceAndTrim();
            return 1;
        },
        wb_capacity: function (pointer) {
            var block = lookup(pointer);
            return block ? block.capacity : 0;
        },
        wb_active_count: function () {
            var count = 0;
            for (var i = 0; i < blocks.length; ++i) if (blocks[i].active) ++count;
            return count;
        },
        wb_invert_rgba: function (src, dst, bytes) {
            var a = lookup(src), b = lookup(dst);
            if (!a || !b || typeof bytes !== "number" || bytes !== Math.floor(bytes) ||
                bytes <= 0 || bytes % 4 || bytes > a.capacity || bytes > b.capacity) return -1;
            var data = new Uint8Array(memory.buffer);
            for (var i = 0; i < bytes; i += 4) {
                data[dst + i] = 255 - data[src + i];
                data[dst + i + 1] = 255 - data[src + i + 1];
                data[dst + i + 2] = 255 - data[src + i + 2];
                data[dst + i + 3] = data[src + i + 3];
            }
            return bytes;
        }
    };
}(this));
