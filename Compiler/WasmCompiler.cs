using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace WasmBridge
{
    public sealed class CompileOptions
    {
        public string ClangPath = "clang";
        public string SourceFile;
        public string OutputFile;
        public string ExportName = "add";
        public int TimeoutMilliseconds = 120000;
    }

    public sealed class CompileResult
    {
        public int ExitCode;
        public string StandardOutput;
        public string StandardError;
        public string CommandLine;
        public string OutputFile;
    }

    public sealed class EmscriptenCompileOptions
    {
        public string EmccPath = "emcc";
        public string SourceFile;
        public string[] SourceFiles;
        public string OutputFile;
        public string ExportName = "add";
        public string[] IncludeDirectories = new string[0];
        public string[] Defines = new string[0];
        public int TimeoutMilliseconds = 120000;
    }

    /// <summary>Wraps an external WASM-capable Clang; does not embed a compiler.</summary>
    public static class WasmCompiler
    {
        public static CompileResult CompileC(CompileOptions options)
        {
            if (options == null) throw new ArgumentNullException("options");
            if (String.IsNullOrEmpty(options.SourceFile) || !File.Exists(options.SourceFile))
                throw new FileNotFoundException("C source not found.", options.SourceFile);
            if (String.IsNullOrEmpty(options.OutputFile)) throw new ArgumentException("OutputFile is required.");
            if (String.IsNullOrEmpty(options.ClangPath)) throw new ArgumentException("ClangPath is required.");
            string[] exportNames = (options.ExportName ?? "").Split(',');
            if (exportNames.Length == 0) throw new ArgumentException("At least one export is required.");
            foreach (string exportName in exportNames)
                if (!Regex.IsMatch(exportName, @"^[A-Za-z_][A-Za-z0-9_]*$"))
                    throw new ArgumentException("Exports must be comma-separated simple C symbols.");
            if (options.TimeoutMilliseconds <= 0) throw new ArgumentException("TimeoutMilliseconds must be positive.");

            string source = Path.GetFullPath(options.SourceFile);
            string output = Path.GetFullPath(options.OutputFile);
            if (String.Equals(source, output, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("OutputFile must differ from SourceFile.");
            Directory.CreateDirectory(Path.GetDirectoryName(output));

            // MVP-oriented freestanding C example. Toolchain/version/features still require real browser testing.
            string args = "--target=wasm32 -O2 -nostdlib -Wl,--no-entry -Wl,--export-memory";
            foreach (string exportName in exportNames)
                args += " -Wl,--export=" + exportName;
            args += " -Wl,--strip-all -o " + Quote(output) + " " + Quote(source);
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = options.ClangPath;
            psi.Arguments = args;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();
            using (Process process = new Process())
            {
                process.StartInfo = psi;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data != null) lock (stdout) stdout.AppendLine(e.Data);
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data != null) lock (stderr) stderr.AppendLine(e.Data);
                };
                if (!process.Start()) throw new InvalidOperationException("Clang did not start.");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(options.TimeoutMilliseconds))
                {
                    process.Kill();
                    process.WaitForExit();
                    throw new TimeoutException("Clang timed out after " + options.TimeoutMilliseconds + " ms.");
                }
                process.WaitForExit(); // let asynchronous output handlers finish
                CompileResult result = new CompileResult();
                result.ExitCode = process.ExitCode;
                result.StandardOutput = stdout.ToString();
                result.StandardError = stderr.ToString();
                result.CommandLine = Quote(options.ClangPath) + " " + args;
                result.OutputFile = output;
                if (result.ExitCode != 0)
                    throw new InvalidOperationException("Clang failed (exit " + result.ExitCode + "):\n" + result.StandardError);
                if (!File.Exists(output))
                    throw new IOException("Clang returned success but did not produce " + output);
                WasmPackage.VerifyHeader(output);
                return result;
            }
        }

        /// <summary>
        /// Compiles a C source with a host-installed Emscripten SDK. The output is
        /// a standalone Wasm module, not Emscripten-generated JavaScript; it can
        /// therefore be loaded by the same Firefox-52-compatible WasmBridge runtime.
        /// </summary>
        public static CompileResult CompileEmscriptenC(EmscriptenCompileOptions options)
        {
            if (options == null) throw new ArgumentNullException("options");
            string[] sourceNames = options.SourceFiles;
            if (sourceNames == null || sourceNames.Length == 0)
                sourceNames = new string[] { options.SourceFile };
            if (sourceNames.Length == 0 || String.IsNullOrEmpty(sourceNames[0]))
                throw new FileNotFoundException("C/C++ source not found.", options.SourceFile);
            if (String.IsNullOrEmpty(options.OutputFile)) throw new ArgumentException("OutputFile is required.");
            if (String.IsNullOrEmpty(options.EmccPath)) throw new ArgumentException("EmccPath is required.");
            if (options.TimeoutMilliseconds <= 0) throw new ArgumentException("TimeoutMilliseconds must be positive.");

            string[] exportNames = (options.ExportName ?? "").Split(',');
            if (exportNames.Length == 0) throw new ArgumentException("At least one export is required.");
            StringBuilder exported = new StringBuilder();
            for (int i = 0; i < exportNames.Length; ++i)
            {
                string name = exportNames[i];
                if (!Regex.IsMatch(name, @"^[A-Za-z_][A-Za-z0-9_]*$"))
                    throw new ArgumentException("Exports must be comma-separated simple C symbols.");
                if (i != 0) exported.Append(',');
                exported.Append("'_" + name + "'");
            }

            string[] sources = new string[sourceNames.Length];
            for (int sourceIndex = 0; sourceIndex < sourceNames.Length; ++sourceIndex)
            {
                if (String.IsNullOrEmpty(sourceNames[sourceIndex]) || !File.Exists(sourceNames[sourceIndex]))
                    throw new FileNotFoundException("C/C++ source not found.", sourceNames[sourceIndex]);
                sources[sourceIndex] = Path.GetFullPath(sourceNames[sourceIndex]);
            }
            string output = Path.GetFullPath(options.OutputFile);
            for (int sourceIndex = 0; sourceIndex < sources.Length; ++sourceIndex)
                if (String.Equals(sources[sourceIndex], output, StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("OutputFile must differ from every source file.");
            Directory.CreateDirectory(Path.GetDirectoryName(output));

            // Avoid Emscripten's JS glue and post-MVP feature assumptions. WABT
            // validation and real Firefox 52 execution remain release gates.
            string args = "-O2 --no-entry -s STANDALONE_WASM=1 -s FILESYSTEM=0" +
                " -s ERROR_ON_UNDEFINED_SYMBOLS=1" +
                " -s EXPORTED_FUNCTIONS=[" + exported + "]" +
                " -mno-bulk-memory -mno-sign-ext -mno-nontrapping-fptoint" +
                IncludeArguments(options.IncludeDirectories, "-I") +
                IncludeArguments(options.Defines, "-D");
            StringBuilder sourceArguments = new StringBuilder();
            for (int sourceIndex = 0; sourceIndex < sources.Length; ++sourceIndex)
                sourceArguments.Append(" ").Append(Quote(sources[sourceIndex]));
            args += " -o " + Quote(output) + sourceArguments;
            return RunCompiler(options.EmccPath, args, output,
                options.TimeoutMilliseconds, "Emscripten");
        }

        private static string IncludeArguments(string[] values, string prefix)
        {
            if (values == null) return "";
            StringBuilder result = new StringBuilder();
            for (int i = 0; i < values.Length; ++i)
            {
                if (String.IsNullOrEmpty(values[i]))
                    throw new ArgumentException("Compiler include/define values cannot be empty.");
                if (values[i].IndexOf('\0') >= 0 || values[i].IndexOf('"') >= 0)
                    throw new ArgumentException("Compiler include/define values contain invalid characters.");
                result.Append(" ").Append(prefix);
                result.Append(String.Equals(prefix, "-D", StringComparison.Ordinal) ? values[i] : Quote(values[i]));
            }
            return result.ToString();
        }

        private static CompileResult RunCompiler(string executable, string args, string output,
                                                 int timeoutMilliseconds, string label)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            string extension = Path.GetExtension(executable);
            if (String.Equals(extension, ".bat", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(extension, ".cmd", StringComparison.OrdinalIgnoreCase))
            {
                psi.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
                psi.Arguments = "/d /s /c call \"" + executable + "\" " + args;
            }
            else
            {
                psi.FileName = executable;
                psi.Arguments = args;
            }
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();
            using (Process process = new Process())
            {
                process.StartInfo = psi;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data != null) lock (stdout) stdout.AppendLine(e.Data);
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data != null) lock (stderr) stderr.AppendLine(e.Data);
                };
                if (!process.Start()) throw new InvalidOperationException(label + " did not start.");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(timeoutMilliseconds))
                {
                    process.Kill();
                    process.WaitForExit();
                    throw new TimeoutException(label + " timed out after " + timeoutMilliseconds + " ms.");
                }
                process.WaitForExit();
                CompileResult result = new CompileResult();
                result.ExitCode = process.ExitCode;
                result.StandardOutput = stdout.ToString();
                result.StandardError = stderr.ToString();
                result.CommandLine = Quote(executable) + " " + args;
                result.OutputFile = output;
                if (result.ExitCode != 0)
                    throw new InvalidOperationException(label + " failed (exit " + result.ExitCode + "):\n" + result.StandardError);
                if (!File.Exists(output))
                    throw new IOException(label + " returned success but did not produce " + output);
                WasmPackage.VerifyHeader(output);
                return result;
            }
        }

        private static string Quote(string s)
        {
            // Quote path-like arguments for the Windows CRT argv convention.
            if (s == null || s.IndexOf('\0') >= 0 || s.IndexOf('"') >= 0)
                throw new ArgumentException("Invalid command-line path.");
            // For CRT parsing, only backslashes immediately before the closing quote
            // need doubling; ordinary backslashes in Windows paths must be preserved.
            int trailing = 0;
            for (int i = s.Length - 1; i >= 0 && s[i] == '\\'; --i) ++trailing;
            return "\"" + s + new string('\\', trailing) + "\"";
        }
    }
}
