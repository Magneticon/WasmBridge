/* JS backend implements the same RGBA8 scratch-buffer ABI as WASM. */
(function (root) {
    "use strict";
    var capacity = 512 * 512 * 4;
    var memory = { buffer: new ArrayBuffer(capacity) };
    var buffer = new Uint8Array(memory.buffer);
    root.WasmBridgeRGBAFallback = {
        memory: memory,
        wb_rgba_buffer: function () { return 0; },
        wb_rgba_capacity: function () { return capacity; },
        wb_rgba_invert: function (width, height) {
            if (width !== (width | 0) || height !== (height | 0) ||
                width < 1 || height < 1 || width > 512 || height > 512) {
                return -1;
            }
            var total = width * height * 4;
            for (var i = 0; i < total; i += 4) {
                buffer[i] = 255 - buffer[i];
                buffer[i + 1] = 255 - buffer[i + 1];
                buffer[i + 2] = 255 - buffer[i + 2];
                /* alpha remains unchanged */
            }
            return total;
        }
    };
}(this));
