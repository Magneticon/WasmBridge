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
        public int AddressBits = 32;
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
        public int AddressBits = 32;
        public int TimeoutMilliseconds = 120000;
    }

    public static class WasmCompiler
    {
        public static CompileResult CompileC(CompileOptions options)
        {
            if (options == null) throw new ArgumentNullException("options");
            ValidateAddressBits(options.AddressBits);
            if (String.IsNullOrEmpty(options.SourceFile) || !File.Exists(options.SourceFile))
                throw new FileNotFoundException("C source not found.", options.SourceFile);
            if (String.IsNullOrEmpty(options.OutputFile)) throw new ArgumentException("OutputFile is required.");
            if (String.IsNullOrEmpty(options.ClangPath)) throw new ArgumentException("ClangPath is required.");
            if (options.TimeoutMilliseconds <= 0) throw new ArgumentException("TimeoutMilliseconds must be positive.");
            string[] exports = ParseExports(options.ExportName);
            string source = Path.GetFullPath(options.SourceFile), output = Path.GetFullPath(options.OutputFile);
            if (String.Equals(source, output, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("OutputFile must differ from SourceFile.");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            string target = options.AddressBits == 64 ? "wasm64" : "wasm32";
            string args = "--target=" + target + " -O2 -nostdlib -Wl,--no-entry -Wl,--export-memory";
            for (int i = 0; i < exports.Length; ++i) args += " -Wl,--export=" + exports[i];
            args += " -Wl,--strip-all -o " + Quote(output) + " " + Quote(source);
            return RunCompiler(options.ClangPath, args, output, options.TimeoutMilliseconds, "Clang");
        }

        public static CompileResult CompileEmscriptenC(EmscriptenCompileOptions options)
        {
            if (options == null) throw new ArgumentNullException("options");
            ValidateAddressBits(options.AddressBits);
            string[] sourceNames = options.SourceFiles;
            if (sourceNames == null || sourceNames.Length == 0) sourceNames = new string[] { options.SourceFile };
            if (sourceNames.Length == 0 || String.IsNullOrEmpty(sourceNames[0]))
                throw new FileNotFoundException("C/C++ source not found.", options.SourceFile);
            if (String.IsNullOrEmpty(options.OutputFile)) throw new ArgumentException("OutputFile is required.");
            if (String.IsNullOrEmpty(options.EmccPath)) throw new ArgumentException("EmccPath is required.");
            if (options.TimeoutMilliseconds <= 0) throw new ArgumentException("TimeoutMilliseconds must be positive.");
            string[] exports = ParseExports(options.ExportName);
            string[] sources = new string[sourceNames.Length];
            for (int i = 0; i < sourceNames.Length; ++i)
            {
                if (String.IsNullOrEmpty(sourceNames[i]) || !File.Exists(sourceNames[i]))
                    throw new FileNotFoundException("C/C++ source not found.", sourceNames[i]);
                sources[i] = Path.GetFullPath(sourceNames[i]);
            }
            string output = Path.GetFullPath(options.OutputFile);
            for (int i = 0; i < sources.Length; ++i)
                if (String.Equals(sources[i], output, StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("OutputFile must differ from every source file.");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            StringBuilder exported = new StringBuilder();
            for (int i = 0; i < exports.Length; ++i) { if (i != 0) exported.Append(','); exported.Append("'_" + exports[i] + "'"); }
            string args = "-O2 --no-entry -s STANDALONE_WASM=1 -s FILESYSTEM=0 -s ERROR_ON_UNDEFINED_SYMBOLS=1" +
                " -s EXPORTED_FUNCTIONS=[" + exported + "]" +
                (options.AddressBits == 64 ? " -s MEMORY64=1" : "") +
                " -mno-bulk-memory -mno-sign-ext -mno-nontrapping-fptoint" +
                IncludeArguments(options.IncludeDirectories, "-I") + IncludeArguments(options.Defines, "-D");
            for (int i = 0; i < sources.Length; ++i) args += " " + Quote(sources[i]);
            args += " -o " + Quote(output);
            return RunCompiler(options.EmccPath, args, output, options.TimeoutMilliseconds, "Emscripten");
        }

        private static void ValidateAddressBits(int bits)
        {
            if (bits != 32 && bits != 64) throw new ArgumentException("AddressBits must be 32 or 64.");
        }

        private static string[] ParseExports(string value)
        {
            string[] raw = (value ?? "").Split(',');
            if (raw.Length == 0) throw new ArgumentException("At least one export is required.");
            for (int i = 0; i < raw.Length; ++i)
            {
                raw[i] = raw[i].Trim();
                if (!Regex.IsMatch(raw[i], @"^[A-Za-z_][A-Za-z0-9_]*$"))
                    throw new ArgumentException("Exports must be comma-separated simple C symbols.");
            }
            return raw;
        }

        private static string IncludeArguments(string[] values, string prefix)
        {
            if (values == null) return "";
            StringBuilder r = new StringBuilder();
            for (int i = 0; i < values.Length; ++i)
            {
                if (String.IsNullOrEmpty(values[i]) || values[i].IndexOf('\0') >= 0 || values[i].IndexOf('"') >= 0)
                    throw new ArgumentException("Compiler include/define values contain invalid characters.");
                r.Append(" ").Append(prefix).Append(String.Equals(prefix, "-D", StringComparison.Ordinal) ? values[i] : Quote(values[i]));
            }
            return r.ToString();
        }

        private static CompileResult RunCompiler(string executable, string args, string output, int timeoutMilliseconds, string label)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            string extension = Path.GetExtension(executable);
            if (String.Equals(extension, ".bat", StringComparison.OrdinalIgnoreCase) || String.Equals(extension, ".cmd", StringComparison.OrdinalIgnoreCase))
            {
                psi.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
                psi.Arguments = "/d /s /c call \"" + executable + "\" " + args;
            }
            else { psi.FileName = executable; psi.Arguments = args; }
            psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
            StringBuilder stdout = new StringBuilder(), stderr = new StringBuilder();
            using (Process process = new Process())
            {
                process.StartInfo = psi;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (stdout) stdout.AppendLine(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (stderr) stderr.AppendLine(e.Data); };
                if (!process.Start()) throw new InvalidOperationException(label + " did not start.");
                process.BeginOutputReadLine(); process.BeginErrorReadLine();
                if (!process.WaitForExit(timeoutMilliseconds)) { process.Kill(); process.WaitForExit(); throw new TimeoutException(label + " timed out after " + timeoutMilliseconds + " ms."); }
                process.WaitForExit();
                CompileResult result = new CompileResult(); result.ExitCode = process.ExitCode; result.StandardOutput = stdout.ToString(); result.StandardError = stderr.ToString(); result.CommandLine = Quote(executable) + " " + args; result.OutputFile = output;
                if (result.ExitCode != 0) throw new InvalidOperationException(label + " failed (exit " + result.ExitCode + "):\n" + result.StandardError);
                if (!File.Exists(output)) throw new IOException(label + " returned success but did not produce " + output);
                WasmPackage.VerifyHeader(output); return result;
            }
        }

        private static string Quote(string s)
        {
            if (s == null || s.IndexOf('\0') >= 0 || s.IndexOf('"') >= 0) throw new ArgumentException("Invalid command-line path.");
            int trailing = 0; for (int i = s.Length - 1; i >= 0 && s[i] == '\\'; --i) ++trailing;
            return "\"" + s + new string('\\', trailing) + "\"";
        }
    }
}
