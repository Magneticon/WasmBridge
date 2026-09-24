/* Equivalent numeric API for WasmBridge's MVP C add example. */
(function (root) {
    "use strict";
    root.WasmBridgeFallback = {
        add: function (a, b) { return (a + b) | 0; }
    };
}(this));
