using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace WasmBridge
{
    /// <summary>
    /// Invokes host-installed WABT, Binaryen, and esbuild. These tools run on the
    /// build workstation; neither their binaries nor modern JS runtimes are
    /// dependencies of the XP-targeted CLI or Firefox 52 browser runtime.
    /// </summary>
    public static class ExternalToolchain
    {
        private const int TimeoutMilliseconds = 120000;

        public static void ValidateLegacy(string wasmFile, string validator)
        {
            if (String.IsNullOrEmpty(validator))
                throw new ArgumentException("Provide --validator path to a host-installed wasm-validate executable.");
            string input = ExistingFile(wasmFile, "WASM");
            WasmPackage.VerifyHeader(input);
            // Disallow post-MVP proposals. WABT versions vary; an unknown flag is
            // a hard error rather than silently weakening this compatibility gate.
            const string flags =
                " --disable-mutable-globals" +
                " --disable-saturating-float-to-int" +
                " --disable-sign-extension" +
                " --disable-simd" +
                " --disable-multi-value" +
                " --disable-bulk-memory" +
                " --disable-reference-types" +
                " --disable-tail-call" +
                " --disable-exceptions" +
                " --disable-memory64" +
                " --disable-multi-memory" +
                " --disable-extended-const";
            RunTool(validator, flags + " " + Quote(input), "WABT wasm-validate");
        }

        /// <summary>
        /// Produces an ES-module-to-classic-script bundled candidate. This does NOT
        /// assert that wasm2js exposes a specific C memory ABI; consumers must
        /// test/normalize generated exports before replacing a working fallback.
        /// </summary>
        public static void GenerateFallback(string wasmFile, string outputFile,
                                            string wasm2js, string esbuild,
                                            string validator, string globalName)
        {
            if (String.IsNullOrEmpty(wasm2js) || String.IsNullOrEmpty(esbuild))
                throw new ArgumentException("Specify --wasm2js and --esbuild executable paths on the build host.");
            if (String.IsNullOrEmpty(globalName) ||
                !System.Text.RegularExpressions.Regex.IsMatch(globalName, @"^[A-Za-z_$][A-Za-z0-9_$]*$"))
                throw new ArgumentException("global-name must be a single JavaScript identifier.");
            ValidateLegacy(wasmFile, validator);
            string input = ExistingFile(wasmFile, "WASM");
            string output = NewOutput(input, outputFile);
            string intermediate = Path.Combine(Path.GetTempPath(), "wasmbridge-" +
                                                Guid.NewGuid().ToString("N") + ".mjs");
            try
            {
                // wasm2js emits an ES6 module; never serve it directly to Firefox 52.
                RunTool(wasm2js, Quote(input) + " -O -o " + Quote(intermediate),
                        "Binaryen wasm2js");
                CheckOutput(intermediate, "wasm2js");
                RunTool(esbuild, Quote(intermediate) +
                        " --bundle --platform=browser --format=iife --target=firefox52" +
                        " --global-name=" + globalName + " --outfile=" + Quote(output),
                        "esbuild Firefox 52 classic-script bundler");
                CheckOutput(output, "esbuild");
                string generated = File.ReadAllText(output);
                if (generated.IndexOf("import ", StringComparison.Ordinal) >= 0 ||
                    generated.IndexOf("export ", StringComparison.Ordinal) >= 0)
                    throw new InvalidDataException("Generated fallback still contains module declarations; do not deploy.");
            }
            catch
            {
                if (File.Exists(output)) File.Delete(output);
                throw;
            }
            finally
            {
                if (File.Exists(intermediate)) File.Delete(intermediate);
            }
        }

        public static void OptimizeLegacy(string wasmFile, string outputFile,
                                          string optimizer, string validator)
        {
            if (String.IsNullOrEmpty(optimizer))
                throw new ArgumentException("Specify --optimizer path to host-installed wasm-opt.");
            ValidateLegacy(wasmFile, validator);
            string input = ExistingFile(wasmFile, "WASM");
            string output = NewOutput(input, outputFile);
            try
            {
                RunTool(optimizer, Quote(input) + " -O2 --mvp-features -o " + Quote(output),
                        "Binaryen wasm-opt");
                CheckOutput(output, "wasm-opt");
                ValidateLegacy(output, validator); // Verify the optimized binary, not just input.
            }
            catch
            {
                if (File.Exists(output)) File.Delete(output);
                throw;
            }
        }

        private static string ExistingFile(string name, string description)
        {
            if (String.IsNullOrEmpty(name) || !File.Exists(name))
                throw new FileNotFoundException(description + " file not found.", name);
            return Path.GetFullPath(name);
        }

        private static string NewOutput(string input, string name)
        {
            if (String.IsNullOrEmpty(name))
                throw new ArgumentException("An --out path is required.");
            string output = Path.GetFullPath(name);
            if (String.Equals(input, output, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Input and output must be different.");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            if (File.Exists(output))
                throw new IOException("Output already exists; refusing to overwrite: " + output);
            return output;
        }

        private static void CheckOutput(string name, string tool)
        {
            if (!File.Exists(name) || new FileInfo(name).Length == 0)
                throw new IOException(tool + " did not produce a nonempty output: " + name);
        }

        private static void RunTool(string executable, string arguments, string label)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = executable;
            psi.Arguments = arguments;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            StringBuilder stdout = new StringBuilder(), stderr = new StringBuilder();
            using (Process process = new Process())
            {
                process.StartInfo = psi;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) lock (stdout) stdout.AppendLine(e.Data);
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) lock (stderr) stderr.AppendLine(e.Data);
                };
                if (!process.Start()) throw new InvalidOperationException(label + " could not start.");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(TimeoutMilliseconds))
                {
                    process.Kill();
                    process.WaitForExit();
                    throw new TimeoutException(label + " timed out after 120 seconds.");
                }
                process.WaitForExit();
                if (process.ExitCode != 0)
                    throw new InvalidOperationException(label + " exited " + process.ExitCode +
                        ". Check installed tool version and compatibility flags.\n" +
                        stderr.ToString() + stdout.ToString());
            }
        }

        private static string Quote(string value)
        {
            if (String.IsNullOrEmpty(value) || value.IndexOf('"') >= 0 || value.IndexOf('\0') >= 0)
                throw new ArgumentException("Invalid external tool argument/path.");
            int n = 0;
            for (int i = value.Length - 1; i >= 0 && value[i] == '\\'; --i) ++n;
            return "\"" + value + new string('\\', n) + "\"";
        }
    }
}
