/* WasmBridge package loader 0.6 for classic-script browsers including Firefox 52.
 * Package URLs and scripts must be trusted. Manifest hashes are informational;
 * this loader does not turn them into a code-signing mechanism. */
(function (root) {
    "use strict";

    function failure(phase, message, cause) {
        var error = new Error(message);
        error.phase = phase;
        error.cause = cause || null;
        return error;
    }

    function directoryOf(url) {
        var absolute = url;
        if (root.document && root.document.createElement) {
            var anchor = root.document.createElement("a");
            anchor.href = url;
            absolute = anchor.href;
        }
        absolute = absolute.split("#")[0].split("?")[0];
        return absolute.substring(0, absolute.lastIndexOf("/") + 1);
    }

    function resolveUrl(base, relative) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(relative) || relative.indexOf("//") === 0)
            return relative;
        if (root.document && root.document.createElement) {
            var anchor = root.document.createElement("a");
            anchor.href = base + relative;
            return anchor.href;
        }
        return base + relative;
    }

    function defaultJsonLoader(url) {
        if (typeof root.fetch !== "function")
            return Promise.reject(failure("manifest", "fetch is unavailable; provide jsonLoader."));
        return root.fetch(url).then(function (response) {
            if (!response.ok) throw failure("manifest", "Manifest HTTP status " + response.status + ".");
            return response.text();
        }).then(function (text) {
            try { return JSON.parse(text); }
            catch (error) { throw failure("manifest", "Manifest is not valid JSON.", error); }
        });
    }

    function defaultScriptLoader(url) {
        return new Promise(function (resolve, reject) {
            if (!root.document || !root.document.createElement)
                return reject(failure("scripts", "A DOM or custom scriptLoader is required."));
            var script = root.document.createElement("script");
            script.async = false;
            script.src = url;
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(failure("scripts", "Unable to load script: " + url)); };
            (root.document.head || root.document.documentElement).appendChild(script);
        });
    }

    function requireString(manifest, name) {
        if (typeof manifest[name] !== "string" || !manifest[name])
            throw failure("manifest", "Manifest field is required: " + name);
    }

    function validate(manifest) {
        if (!manifest || typeof manifest !== "object")
            throw failure("manifest", "Manifest must be an object.");
        if (manifest.format !== "wasmbridge-package-0.1" &&
            manifest.format !== "wasmbridge-package-0.2")
            throw failure("manifest", "Unsupported package format: " + manifest.format);
        requireString(manifest, "wasm");
        requireString(manifest, "fallback");
        requireString(manifest, "runtime");
        if (!Array.isArray(manifest.exports) || !manifest.exports.length)
            throw failure("manifest", "Manifest exports must be a non-empty array.");
        if (manifest.format === "wasmbridge-package-0.2") requireString(manifest, "moduleRuntime");
        return manifest;
    }

    function load(options) {
        options = options || {};
        if (typeof options.manifest !== "string" || !options.manifest)
            return Promise.reject(failure("configuration", "manifest URL is required."));
        var jsonLoader = options.jsonLoader || defaultJsonLoader;
        var scriptLoader = options.scriptLoader || defaultScriptLoader;
        var base = directoryOf(options.manifest);

        return Promise.resolve().then(function () {
            return jsonLoader(options.manifest);
        }).then(validate).then(function (manifest) {
            var chain = Promise.resolve();
            if (!root.WasmBridge || typeof root.WasmBridge.load !== "function")
                chain = chain.then(function () { return scriptLoader(resolveUrl(base, manifest.runtime)); });
            if (manifest.format === "wasmbridge-package-0.2" &&
                (!root.WasmBridgeModule || typeof root.WasmBridgeModule.load !== "function"))
                chain = chain.then(function () { return scriptLoader(resolveUrl(base, manifest.moduleRuntime)); });

            return chain.then(function () {
                var loadOptions = {
                    wasm: resolveUrl(base, manifest.wasm),
                    fallback: typeof options.fallback === "undefined" ?
                        resolveUrl(base, manifest.fallback) : options.fallback,
                    fallbackGlobal: options.fallbackGlobal || manifest.fallbackGlobal,
                    exports: manifest.exports,
                    imports: options.imports || {},
                    preferWasm: options.preferWasm,
                    validateWasm: options.validateWasm
                };
                if (manifest.format === "wasmbridge-package-0.2") {
                    loadOptions.allocator = manifest.allocator || null;
                    loadOptions.memoryExport = manifest.memoryExport || "memory";
                    loadOptions.maxBufferBytes = options.maxBufferBytes;
                    loadOptions.maxMemoryBytes = options.maxMemoryBytes;
                    loadOptions.maxHandles = options.maxHandles;
                    loadOptions.growMemory = options.growMemory;
                    loadOptions.signatures = manifest.signatures || null;
                    return root.WasmBridgeModule.load(loadOptions);
                }
                return root.WasmBridge.load(loadOptions);
            }).then(function (module) {
                module.packageManifest = manifest;
                module.packageUrl = options.manifest;
                return module;
            });
        }).catch(function (error) {
            if (error && error.phase) throw error;
            throw failure("package", "Package loading failed: " +
                (error && error.message ? error.message : String(error)), error);
        });
    }

    root.WasmBridgePackage = {load: load, version: "0.6.0"};
}(this));
