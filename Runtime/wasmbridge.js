/*
 * WasmBridge 0.1: readable classic-script loader for Firefox 52 ESR and modern browsers.
 * No ES modules, streaming API, SIMD, threads or worker/DOM assumptions for Wasm itself.
 * Script-URL fallback loading requires a document and trusted same-origin input.
 */
(function (root) {
    "use strict";

    function expectedNames(options) {
        return options.exports || ["add"];
    }

    function checkExports(exportsObject, names) {
        if (!exportsObject) throw new Error("No exports returned by backend.");
        for (var i = 0; i < names.length; ++i) {
            if (typeof exportsObject[names[i]] !== "function") {
                throw new Error("Missing callable export: " + names[i]);
            }
        }
    }

    function publicAdapter(backend, exportsObject, names, diagnostic, instance) {
        var adapter = {
            backend: backend,
            diagnostic: diagnostic || "",
            instance: instance || null,
            exports: exportsObject
        };
        for (var i = 0; i < names.length; ++i) {
            (function (name) {
                if (Object.prototype.hasOwnProperty.call(adapter, name)) {
                    throw new Error("Reserved export name: " + name);
                }
                adapter[name] = function () {
                    return exportsObject[name].apply(exportsObject, arguments);
                };
            }(names[i]));
        }
        return adapter;
    }

    function getScriptFallback(options) {
        if (typeof options.fallback === "object" && options.fallback !== null) {
            return Promise.resolve(options.fallback);
        }
        if (typeof options.fallback === "function") {
            return Promise.resolve().then(options.fallback);
        }
        if (typeof options.fallback !== "string" || !options.fallback) {
            return Promise.reject(new Error("No JS fallback was provided."));
        }

        var globalName = options.fallbackGlobal || "WasmBridgeFallback";
        if (root[globalName]) return Promise.resolve(root[globalName]);
        if (typeof document === "undefined") {
            return Promise.reject(new Error("Script URL fallback needs a document; pass an object in a worker."));
        }
        return new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.async = true;
            script.src = options.fallback;
            script.onload = function () {
                if (root[globalName]) resolve(root[globalName]);
                else reject(new Error("Fallback script did not define " + globalName));
            };
            script.onerror = function () { reject(new Error("Unable to load fallback: " + options.fallback)); };
            (document.head || document.getElementsByTagName("head")[0]).appendChild(script);
        });
    }

    function useWasm(options, names) {
        if (typeof WebAssembly === "undefined" ||
            typeof WebAssembly.instantiate !== "function") {
            return Promise.reject(new Error("WebAssembly is unavailable."));
        }
        if (typeof fetch !== "function") {
            return Promise.reject(new Error("Fetch is unavailable."));
        }
        if (typeof options.wasm !== "string" || !options.wasm) {
            return Promise.reject(new Error("A WASM URL is required."));
        }
        return fetch(options.wasm).then(function (response) {
            if (!response.ok) throw new Error("WASM HTTP status " + response.status);
            return response.arrayBuffer();
        }).then(function (buffer) {
            return WebAssembly.instantiate(new Uint8Array(buffer), options.imports || {});
        }).then(function (result) {
            var instance = result.instance || result;
            checkExports(instance.exports, names);
            // Allow adapters to reject an unusable WASM ABI before backend selection.
            // A failed check falls through to the caller's matching JS fallback.
            if (typeof options.validateWasm === "function") {
                options.validateWasm(instance.exports, instance);
            }
            return publicAdapter("wasm", instance.exports, names, "", instance);
        });
    }

    function load(options) {
        if (!options) return Promise.reject(new Error("WasmBridge.load needs options."));
        var names = expectedNames(options);
        if (!Array.isArray(names) || !names.length) {
            return Promise.reject(new Error("exports must be a non-empty array."));
        }
        function fallback(reason) {
            return getScriptFallback(options).then(function (implementation) {
                checkExports(implementation, names);
                return publicAdapter("javascript", implementation, names, String(reason), null);
            }, function (fallbackError) {
                throw new Error("WASM: " + reason + "; fallback: " + fallbackError.message);
            });
        }
        if (options.preferWasm === false) {
            return fallback("WASM disabled by caller.");
        }
        return useWasm(options, names).catch(function (wasmError) {
            return fallback(wasmError && wasmError.message ? wasmError.message : wasmError);
        });
    }

    root.WasmBridge = { load: load, version: "0.1.0" };
}(this));
