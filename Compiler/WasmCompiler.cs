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
            if (!Regex.IsMatch(options.ExportName ?? "", @"^[A-Za-z_][A-Za-z0-9_]*$"))
                throw new ArgumentException("ExportName must be a simple C symbol.");
            if (options.TimeoutMilliseconds <= 0) throw new ArgumentException("TimeoutMilliseconds must be positive.");

            string source = Path.GetFullPath(options.SourceFile);
            string output = Path.GetFullPath(options.OutputFile);
            if (String.Equals(source, output, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("OutputFile must differ from SourceFile.");
            Directory.CreateDirectory(Path.GetDirectoryName(output));

            // MVP-oriented freestanding C example. Toolchain/version/features still require real browser testing.
            string args = "--target=wasm32 -O2 -nostdlib " +
                "-Wl,--no-entry -Wl,--export=" + options.ExportName +
                " -Wl,--strip-all -o " + Quote(output) + " " + Quote(source);
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

        private static string Quote(string s)
        {
            // Quote path-like arguments for the Windows CRT argv convention.
            if (s == null || s.IndexOf('\0') >= 0 || s.IndexOf('"') >= 0)
                throw new ArgumentException("Invalid command-line path.");
            return "\"" + s.Replace("\\", "\\\\") + "\"";
        }
    }
}
