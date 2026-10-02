/*
 * WasmBridge 0.6: readable classic-script loader for Firefox 52 ESR and modern browsers.
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

    function failure(phase, error) {
        var message = error && error.message ? error.message : String(error);
        var result = new Error(message);
        result.wasmBridgePhase = phase;
        return result;
    }

    function publicAdapter(backend, exportsObject, names, diagnostic, instance, failureInfo) {
        var adapter = {
            backend: backend,
            diagnostic: diagnostic || "",
            failurePhase: failureInfo ? failureInfo.phase : null,
            wasmFailure: failureInfo || null,
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
            return Promise.reject(failure("unavailable", "WebAssembly is unavailable."));
        }
        if (typeof options.wasm !== "string" || !options.wasm) {
            return Promise.reject(failure("configuration", "A WASM URL is required."));
        }
        var bytes;
        if (typeof fetch === "function") {
            bytes = fetch(options.wasm).then(function (response) {
                if (!response.ok) throw failure("load", "WASM HTTP status " + response.status);
                return response.arrayBuffer();
            }).catch(function (error) {
                if (error && error.wasmBridgePhase) throw error;
                throw failure("load", error);
            });
        } else if (root.WasmBridgeCompat &&
                   typeof root.WasmBridgeCompat.loadBytes === "function") {
            // Optional XHR ponyfill: include legacy-compat.js before wasmbridge.js.
            bytes = root.WasmBridgeCompat.loadBytes(options.wasm).catch(function (error) {
                throw failure("load", error);
            });
        } else {
            return Promise.reject(failure("load", "Fetch is unavailable; include legacy-compat.js for XHR loading."));
        }
        return bytes.then(function (buffer) {
            return WebAssembly.instantiate(new Uint8Array(buffer), options.imports || {}).catch(function (error) {
                throw failure("instantiate", error);
            });
        }).then(function (result) {
            var instance = result.instance || result;
            try { checkExports(instance.exports, names); }
            catch (exportError) { throw failure("exports", exportError); }
            // Allow adapters to reject an unusable WASM ABI before backend selection.
            // A failed check falls through to the caller's matching JS fallback.
            if (typeof options.validateWasm === "function") {
                try { options.validateWasm(instance.exports, instance); }
                catch (abiError) { throw failure("abi", abiError); }
            }
            return publicAdapter("wasm", instance.exports, names, "", instance, null);
        });
    }

    function load(options) {
        if (!options) return Promise.reject(new Error("WasmBridge.load needs options."));
        var names = expectedNames(options);
        if (!Array.isArray(names) || !names.length) {
            return Promise.reject(new Error("exports must be a non-empty array."));
        }
        function fallback(reason) {
            var phase = reason && reason.wasmBridgePhase ? reason.wasmBridgePhase : "unknown";
            var message = reason && reason.message ? reason.message : String(reason);
            var failureInfo = {phase: phase, message: message};
            return getScriptFallback(options).then(function (implementation) {
                checkExports(implementation, names);
                return publicAdapter("javascript", implementation, names,
                    "[" + phase + "] " + message, null, failureInfo);
            }, function (fallbackError) {
                throw new Error("WASM [" + phase + "]: " + message +
                    "; fallback: " + fallbackError.message);
            });
        }
        if (options.preferWasm === false) {
            return fallback(failure("disabled", "WASM disabled by caller."));
        }
        return useWasm(options, names).catch(function (wasmError) {
            return fallback(wasmError);
        });
    }

    root.WasmBridge = { load: load, version: "0.6.0" };
}(this));
