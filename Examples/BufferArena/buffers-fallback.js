/* Same ABI as Core/buffers.c, intentionally readable and Firefox 52 compatible. */
(function (root) {
    "use strict";
    var PAGE = 65536, LIMIT = 32 * 1024 * 1024, SLOTS = 128;
    var memory = { buffer: new ArrayBuffer(PAGE * 2) };
    memory.grow = function (pages) {
        if (!Number.isInteger(pages) || pages < 0 || memory.buffer.byteLength + pages * PAGE > LIMIT)
            throw new RangeError("JavaScript linear memory limit reached.");
        var previous = memory.buffer.byteLength / PAGE;
        if (pages) {
            var expanded = new ArrayBuffer(memory.buffer.byteLength + pages * PAGE);
            new Uint8Array(expanded).set(new Uint8Array(memory.buffer));
            memory.buffer = expanded;
        }
        return previous;
    };
    var blocks = [], next = 8192;
    function lookup(pointer) {
        for (var i = 0; i < blocks.length; ++i)
            if (blocks[i] && blocks[i].pointer === pointer && blocks[i].active) return blocks[i];
        return null;
    }
    function coalesceAndTrim() {
        var changed = true, i, j, a, b;
        while (changed) {
            changed = false;
            for (i = 0; i < blocks.length && !changed; ++i) {
                a = blocks[i];
                if (!a || a.active) continue;
                for (j = i + 1; j < blocks.length; ++j) {
                    b = blocks[j];
                    if (!b || b.active) continue;
                    if (a.pointer + a.capacity === b.pointer) {
                        a.capacity += b.capacity; blocks[j] = null; changed = true; break;
                    }
                    if (b.pointer + b.capacity === a.pointer) {
                        b.capacity += a.capacity; blocks[i] = null; changed = true; break;
                    }
                }
            }
        }
        changed = true;
        while (changed) {
            changed = false;
            for (i = 0; i < blocks.length; ++i) {
                a = blocks[i];
                if (a && !a.active && a.pointer + a.capacity === next) {
                    next = a.pointer; blocks[i] = null; changed = true; break;
                }
            }
        }
    }
    function alloc(bytes) {
        if (!Number.isInteger(bytes) || bytes <= 0 || bytes > LIMIT) return 0;
        var size = (bytes + 7) & ~7;
        var empty = -1;
        for (var i = 0; i < blocks.length; ++i) {
            if (!blocks[i]) { if (empty < 0) empty = i; continue; }
            if (!blocks[i].active && blocks[i].capacity >= size) {
                blocks[i].active = true;
                return blocks[i].pointer;
            }
        }
        if (empty < 0 && blocks.length < SLOTS) empty = blocks.length;
        if (empty < 0 || next + size > LIMIT || next + size > memory.buffer.byteLength) return 0;
        var pointer = next;
        next += size;
        blocks[empty] = {pointer: pointer, capacity: size, active: true};
        return pointer;
    }
    root.WasmBridgeBuffersFallback = {
        memory: memory,
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
            for (var i = 0; i < blocks.length; ++i) if (blocks[i] && blocks[i].active) ++count;
            return count;
        },
        wb_invert_rgba: function (src, dst, bytes) {
            var a = lookup(src), b = lookup(dst);
            if (!a || !b || !Number.isInteger(bytes) || bytes <= 0 ||
                bytes % 4 || bytes > a.capacity || bytes > b.capacity) return -1;
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
