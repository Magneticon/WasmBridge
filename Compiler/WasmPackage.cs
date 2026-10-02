using System;
using System.Collections.Generic;
using System.Collections;
using System.IO;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace WasmBridge
{
    public sealed class PackageOptions
    {
        public string WasmFile;
        public string FallbackFile;
        public string RuntimeFile;
        public string AdapterFile; // Optional browser-side adapter (e.g., Runtime/buffers.js)
        public string ModuleRuntimeFile; // Optional general API layer (Runtime/module.js)
        public string OutputDirectory;
        public string ExportName = "add";
        public string AllocatorName; // Optional allocate,release[,capacity] export names
        public string MemoryExport = "memory";
        public string FallbackGlobal;
        public string SignaturesFile;
    }

    public static class WasmPackage
    {
        // This is a basic WASM magic/version check, NOT a binary-feature, import, ABI or browser validator.
        public static void VerifyHeader(string wasmFile)
        {
            byte[] header = new byte[] { 0, 97, 115, 109, 1, 0, 0, 0 };
            using (FileStream input = File.OpenRead(wasmFile))
            {
                for (int i = 0; i < header.Length; ++i)
                    if (input.ReadByte() != header[i])
                        throw new InvalidDataException("Invalid WebAssembly MVP header: " + wasmFile);
            }
        }

        public static string Create(PackageOptions options)
        {
            if (options == null) throw new ArgumentNullException("options");
            if (String.IsNullOrEmpty(options.WasmFile) || !File.Exists(options.WasmFile))
                throw new FileNotFoundException("WasmFile is required.", options.WasmFile);
            if (String.IsNullOrEmpty(options.FallbackFile) || !File.Exists(options.FallbackFile))
                throw new FileNotFoundException("FallbackFile is required.", options.FallbackFile);
            if (String.IsNullOrEmpty(options.RuntimeFile) || !File.Exists(options.RuntimeFile))
                throw new FileNotFoundException("RuntimeFile is required.", options.RuntimeFile);
            if (!String.IsNullOrEmpty(options.AdapterFile) && !File.Exists(options.AdapterFile))
                throw new FileNotFoundException("AdapterFile not found.", options.AdapterFile);
            if (!String.IsNullOrEmpty(options.ModuleRuntimeFile) && !File.Exists(options.ModuleRuntimeFile))
                throw new FileNotFoundException("ModuleRuntimeFile not found.", options.ModuleRuntimeFile);
            if (!String.IsNullOrEmpty(options.SignaturesFile) && !File.Exists(options.SignaturesFile))
                throw new FileNotFoundException("SignaturesFile not found.", options.SignaturesFile);
            if (String.IsNullOrEmpty(options.OutputDirectory)) throw new ArgumentException("OutputDirectory is required.");
            if (String.IsNullOrEmpty(options.ExportName)) throw new ArgumentException("ExportName is required.");
            string[] exports = SplitRequired(options.ExportName, "ExportName");
            string[] allocatorNames = null;
            if (!String.IsNullOrEmpty(options.AllocatorName))
            {
                allocatorNames = SplitRequired(options.AllocatorName, "AllocatorName");
                if (allocatorNames.Length < 2 || allocatorNames.Length > 3)
                    throw new ArgumentException("AllocatorName must contain allocate,release[,capacity].");
                if (String.IsNullOrEmpty(options.ModuleRuntimeFile))
                    throw new ArgumentException("ModuleRuntimeFile is required when AllocatorName is specified.");
            }
            if (String.IsNullOrEmpty(options.MemoryExport))
                throw new ArgumentException("MemoryExport cannot be empty.");

            VerifyHeader(options.WasmFile);
            string destination = Path.GetFullPath(options.OutputDirectory);
            Directory.CreateDirectory(destination);
            string wasm = Path.Combine(destination, "module.wasm");
            string fallback = Path.Combine(destination, "fallback.js");
            string runtime = Path.Combine(destination, "wasmbridge.js");
            CopyIfDifferent(options.WasmFile, wasm);
            CopyIfDifferent(options.FallbackFile, fallback);
            CopyIfDifferent(options.RuntimeFile, runtime);
            string adapter = null;
            if (!String.IsNullOrEmpty(options.AdapterFile))
            {
                adapter = Path.Combine(destination, "adapter.js");
                CopyIfDifferent(options.AdapterFile, adapter);
            }
            string moduleRuntime = null;
            if (!String.IsNullOrEmpty(options.ModuleRuntimeFile))
            {
                moduleRuntime = Path.Combine(destination, "module.js");
                CopyIfDifferent(options.ModuleRuntimeFile, moduleRuntime);
            }

            // Informational metadata. No claim that a particular module is actually MVP-only.
            var manifest = new Dictionary<string, object>();
            manifest["format"] = moduleRuntime == null ? "wasmbridge-package-0.1" : "wasmbridge-package-0.2";
            manifest["wasm"] = "module.wasm";
            manifest["fallback"] = "fallback.js";
            manifest["runtime"] = "wasmbridge.js";
            if (adapter != null) manifest["adapter"] = "adapter.js";
            if (moduleRuntime != null) manifest["moduleRuntime"] = "module.js";
            manifest["exports"] = exports;
            if (!String.IsNullOrEmpty(options.SignaturesFile))
            {
                if (moduleRuntime == null)
                    throw new ArgumentException("ModuleRuntimeFile is required when SignaturesFile is specified.");
                Dictionary<string, object> signatures;
                try
                {
                    signatures = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                        File.ReadAllText(options.SignaturesFile));
                }
                catch (Exception error)
                {
                    throw new InvalidDataException("SignaturesFile is not valid JSON: " + error.Message, error);
                }
                ValidateSignatures(signatures, new HashSet<string>(exports, StringComparer.Ordinal));
                manifest["signatures"] = signatures;
            }
            if (!String.IsNullOrEmpty(options.FallbackGlobal)) manifest["fallbackGlobal"] = options.FallbackGlobal;
            if (allocatorNames != null)
            {
                var allocator = new Dictionary<string, object>();
                allocator["allocate"] = allocatorNames[0];
                allocator["release"] = allocatorNames[1];
                if (allocatorNames.Length == 3) allocator["capacity"] = allocatorNames[2];
                manifest["allocator"] = allocator;
                manifest["memoryExport"] = options.MemoryExport;
            }
            manifest["wasmSha256"] = Sha256(wasm);
            manifest["fallbackSha256"] = Sha256(fallback);
            manifest["runtimeSha256"] = Sha256(runtime);
            if (adapter != null) manifest["adapterSha256"] = Sha256(adapter);
            if (moduleRuntime != null) manifest["moduleRuntimeSha256"] = Sha256(moduleRuntime);
            manifest["compatibility"] = "Browser-side instantiation and export checks required; test on target Firefox 52.";
            string path = Path.Combine(destination, "manifest.json");
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(manifest));
            return path;
        }

        public static string VerifyPackage(string manifestFile)
        {
            if (String.IsNullOrEmpty(manifestFile) || !File.Exists(manifestFile))
                throw new FileNotFoundException("Package manifest not found.", manifestFile);
            string manifestPath = Path.GetFullPath(manifestFile);
            string root = Path.GetDirectoryName(manifestPath);
            Dictionary<string, object> manifest;
            try
            {
                manifest = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                    File.ReadAllText(manifestPath));
            }
            catch (Exception error)
            {
                throw new InvalidDataException("Package manifest is not valid JSON: " + error.Message, error);
            }

            string format = RequiredString(manifest, "format");
            if (format != "wasmbridge-package-0.1" && format != "wasmbridge-package-0.2")
                throw new InvalidDataException("Unsupported package format: " + format);

            var expected = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            AddArtifact(manifest, root, expected, "wasm", "wasmSha256", true);
            AddArtifact(manifest, root, expected, "fallback", "fallbackSha256", true);
            AddArtifact(manifest, root, expected, "runtime", "runtimeSha256", true);
            if (manifest.ContainsKey("adapter"))
                AddArtifact(manifest, root, expected, "adapter", "adapterSha256", true);
            if (format == "wasmbridge-package-0.2")
                AddArtifact(manifest, root, expected, "moduleRuntime", "moduleRuntimeSha256", true);

            object exportsValue;
            if (!manifest.TryGetValue("exports", out exportsValue))
                throw new InvalidDataException("Manifest exports are required.");
            IList exports = exportsValue as IList;
            if (exports == null || exports.Count == 0)
                throw new InvalidDataException("Manifest exports must be a non-empty array.");
            var exportNames = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < exports.Count; ++i)
            {
                string name = exports[i] as string;
                if (String.IsNullOrEmpty(name) || !exportNames.Add(name))
                    throw new InvalidDataException("Manifest exports contain an empty or duplicate name.");
            }
            if (manifest.ContainsKey("signatures"))
            {
                var signatures = manifest["signatures"] as Dictionary<string, object>;
                if (signatures == null) throw new InvalidDataException("Manifest signatures must be an object.");
                ValidateSignatures(signatures, exportNames);
            }

            if (manifest.ContainsKey("allocator"))
            {
                if (format != "wasmbridge-package-0.2")
                    throw new InvalidDataException("Allocator metadata requires package format 0.2.");
                var allocator = manifest["allocator"] as Dictionary<string, object>;
                if (allocator == null) throw new InvalidDataException("Allocator metadata must be an object.");
                RequiredString(allocator, "allocate");
                RequiredString(allocator, "release");
                if (allocator.ContainsKey("capacity")) RequiredString(allocator, "capacity");
                RequiredString(manifest, "memoryExport");
            }

            string wasmPath = expected[RequiredString(manifest, "wasm")];
            VerifyHeader(wasmPath);

            var allowed = new HashSet<string>(expected.Values, StringComparer.OrdinalIgnoreCase);
            allowed.Add(manifestPath);
            foreach (string file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
                if (!allowed.Contains(Path.GetFullPath(file)))
                    throw new InvalidDataException("Unexpected package artifact: " +
                        Path.GetFullPath(file).Substring(root.Length).TrimStart(Path.DirectorySeparatorChar));
            return format;
        }

        private static void AddArtifact(Dictionary<string, object> manifest, string root,
                                        Dictionary<string, string> expected,
                                        string pathKey, string hashKey, bool hashRequired)
        {
            string relative = RequiredString(manifest, pathKey);
            if (Path.IsPathRooted(relative))
                throw new InvalidDataException("Package artifact path must be relative: " + relative);
            string full = Path.GetFullPath(Path.Combine(root, relative));
            string rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
                                Path.DirectorySeparatorChar;
            if (!full.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Package artifact escapes its directory: " + relative);
            if (!File.Exists(full)) throw new FileNotFoundException("Package artifact not found: " + relative, full);
            if (expected.ContainsKey(relative)) throw new InvalidDataException("Duplicate package artifact path: " + relative);
            string recordedHash = hashRequired ? RequiredString(manifest, hashKey) : null;
            if (recordedHash != null && !String.Equals(recordedHash, Sha256(full), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("SHA-256 mismatch for package artifact: " + relative);
            expected[relative] = full;
        }

        private static string RequiredString(Dictionary<string, object> values, string key)
        {
            object value;
            string text;
            if (!values.TryGetValue(key, out value) || String.IsNullOrEmpty(text = value as string))
                throw new InvalidDataException("Manifest string field is required: " + key);
            return text;
        }

        private static void ValidateSignatures(Dictionary<string, object> signatures,
                                               HashSet<string> exportNames)
        {
            foreach (KeyValuePair<string, object> item in signatures)
            {
                if (!exportNames.Contains(item.Key))
                    throw new InvalidDataException("Signature names an undeclared export: " + item.Key);
                var signature = item.Value as Dictionary<string, object>;
                if (signature == null)
                    throw new InvalidDataException("Signature must be an object: " + item.Key);
                object parametersValue;
                IList parameters;
                if (!signature.TryGetValue("parameters", out parametersValue) ||
                    (parameters = parametersValue as IList) == null)
                    throw new InvalidDataException("Signature parameters must be an array: " + item.Key);
                for (int i = 0; i < parameters.Count; ++i)
                    ValidateAbiType(parameters[i] as string, false, item.Key);
                object resultValue;
                string result = signature.TryGetValue("result", out resultValue) ? resultValue as string : "void";
                ValidateAbiType(result, true, item.Key);
            }
        }

        private static void ValidateAbiType(string type, bool allowVoid, string exportName)
        {
            if (type == "i32" || type == "f32" || type == "f64" || (allowVoid && type == "void")) return;
            throw new InvalidDataException("Unsupported Firefox 52 ABI type for " + exportName + ": " + type);
        }

        private static string[] SplitRequired(string value, string label)
        {
            string[] raw = value.Split(',');
            List<string> result = new List<string>();
            for (int i = 0; i < raw.Length; ++i)
            {
                string item = raw[i].Trim();
                if (item.Length == 0) throw new ArgumentException(label + " contains an empty name.");
                if (result.Contains(item)) throw new ArgumentException(label + " contains duplicate name: " + item);
                result.Add(item);
            }
            return result.ToArray();
        }

        private static void CopyIfDifferent(string source, string destination)
        {
            if (!String.Equals(Path.GetFullPath(source), Path.GetFullPath(destination),
                               StringComparison.OrdinalIgnoreCase))
                File.Copy(source, destination, true);
        }

        private static string Sha256(string filename)
        {
            using (FileStream stream = File.OpenRead(filename))
            using (SHA256 hasher = SHA256.Create())
                return BitConverter.ToString(hasher.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
    }
}
