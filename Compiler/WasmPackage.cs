using System;
using System.Collections.Generic;
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
        public string OutputDirectory;
        public string ExportName = "add";
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
            if (String.IsNullOrEmpty(options.OutputDirectory)) throw new ArgumentException("OutputDirectory is required.");
            if (String.IsNullOrEmpty(options.ExportName)) throw new ArgumentException("ExportName is required.");

            VerifyHeader(options.WasmFile);
            string destination = Path.GetFullPath(options.OutputDirectory);
            Directory.CreateDirectory(destination);
            string wasm = Path.Combine(destination, "module.wasm");
            string fallback = Path.Combine(destination, "fallback.js");
            string runtime = Path.Combine(destination, "wasmbridge.js");
            CopyIfDifferent(options.WasmFile, wasm);
            CopyIfDifferent(options.FallbackFile, fallback);
            CopyIfDifferent(options.RuntimeFile, runtime);

            // Informational metadata. No claim that a particular module is actually MVP-only.
            var manifest = new Dictionary<string, object>();
            manifest["format"] = "wasmbridge-package-0.1";
            manifest["wasm"] = "module.wasm";
            manifest["fallback"] = "fallback.js";
            manifest["runtime"] = "wasmbridge.js";
            manifest["exports"] = options.ExportName.Split(',');
            manifest["wasmSha256"] = Sha256(wasm);
            manifest["fallbackSha256"] = Sha256(fallback);
            manifest["runtimeSha256"] = Sha256(runtime);
            manifest["compatibility"] = "Browser-side instantiation and export checks required; test on target Firefox 52.";
            string path = Path.Combine(destination, "manifest.json");
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(manifest));
            return path;
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
