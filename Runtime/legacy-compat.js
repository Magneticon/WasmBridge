/* Optional, narrowly scoped browser compatibility helpers (classic script).
 * Firefox 52.9 ESR already has Promise, fetch and TypedArrays on the tested
 * installation. This adds only an XHR byte loader for runtimes without fetch.
 * No fake WebAssembly polyfill: if native Wasm is absent, use the JS backend.
 */
(function (root) {
    "use strict";
    function detect() {
        return {
            promise: typeof root.Promise === "function",
            arrayBuffer: typeof root.ArrayBuffer === "function",
            uint8Array: typeof root.Uint8Array === "function",
            fetch: typeof root.fetch === "function",
            xhr: typeof root.XMLHttpRequest === "function",
            wasm: !!(root.WebAssembly && typeof root.WebAssembly.instantiate === "function"),
            wasmMemory: !!(root.WebAssembly && typeof root.WebAssembly.Memory === "function"),
            scriptModules: false /* Intentionally unused: classic-script profile. */
        };
    }
    function loadBytes(url) {
        if (typeof root.Promise !== "function" ||
            typeof root.ArrayBuffer !== "function" ||
            typeof root.Uint8Array !== "function") {
            throw new Error("Promise, ArrayBuffer and Uint8Array are required by the legacy runtime.");
        }
        if (typeof root.fetch === "function") {
            return root.fetch(url).then(function (response) {
                if (!response.ok) throw new Error("WASM HTTP status " + response.status);
                return response.arrayBuffer();
            });
        }
        if (typeof root.XMLHttpRequest !== "function")
            return root.Promise.reject(new Error("Neither fetch nor XMLHttpRequest is available."));
        return new root.Promise(function (resolve, reject) {
            var xhr = new root.XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.responseType = "arraybuffer";
            xhr.onload = function () {
                // Local file responses often have status 0; require actual bytes.
                var local = url.indexOf("file:") === 0 ||
                            (root.location && root.location.protocol === "file:");
                if (((xhr.status >= 200 && xhr.status < 300) ||
                     (local && xhr.status === 0)) &&
                    xhr.response && xhr.response.byteLength > 0)
                    resolve(xhr.response);
                else reject(new Error("WASM XHR status " + xhr.status + " or empty response."));
            };
            xhr.onerror = function () { reject(new Error("WASM XHR network/read error.")); };
            xhr.onabort = function () { reject(new Error("WASM XHR request aborted.")); };
            try { xhr.send(null); }
            catch (error) { reject(error); }
        });
    }
    root.WasmBridgeCompat = { detect: detect, loadBytes: loadBytes, version: "0.4.0" };
}(this));
