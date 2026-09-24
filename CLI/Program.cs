using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using WasmBridge;

namespace WasmBridge.CLI
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0 || args[0] == "help" || args[0] == "--help")
                {
                    Help();
                    return 0;
                }
                string command = args[0].ToLowerInvariant();
                Dictionary<string, string> p = Parse(args);
                if (command == "build")
                {
                    CompileOptions o = new CompileOptions();
                    o.SourceFile = Required(p, "source");
                    o.OutputFile = Required(p, "out");
                    if (p.ContainsKey("clang")) o.ClangPath = p["clang"];
                    if (p.ContainsKey("export")) o.ExportName = p["export"];
                    if (p.ContainsKey("timeout")) o.TimeoutMilliseconds = Int32.Parse(p["timeout"]);
                    CompileResult r = WasmCompiler.CompileC(o);
                    Console.WriteLine("Built " + r.OutputFile);
                    Console.WriteLine("Clang exit: " + r.ExitCode);
                    if (!String.IsNullOrEmpty(r.StandardOutput)) Console.WriteLine(r.StandardOutput);
                    if (!String.IsNullOrEmpty(r.StandardError)) Console.WriteLine(r.StandardError);
                    return 0;
                }
                if (command == "package")
                {
                    PackageOptions o = new PackageOptions();
                    o.WasmFile = Required(p, "wasm");
                    o.FallbackFile = Required(p, "fallback");
                    o.RuntimeFile = Required(p, "runtime");
                    o.OutputDirectory = Required(p, "out");
                    if (p.ContainsKey("export")) o.ExportName = p["export"];
                    Console.WriteLine("Package manifest: " + WasmPackage.Create(o));
                    return 0;
                }
                if (command == "verify")
                {
                    string filename = Required(p, "wasm");
                    WasmPackage.VerifyHeader(filename);
                    Console.WriteLine("PASS: WASM magic/version only: " + Path.GetFullPath(filename));
                    Console.WriteLine("Browser/feature/export compatibility NOT verified.");
                    return 0;
                }
                if (command == "self-test")
                {
                    string filename = Path.GetTempFileName();
                    try
                    {
                        File.WriteAllBytes(filename, new byte[] { 0,97,115,109,1,0,0,0 });
                        WasmPackage.VerifyHeader(filename);
                        File.WriteAllBytes(filename, new byte[] { 1,2,3 });
                        try { WasmPackage.VerifyHeader(filename); }
                        catch (InvalidDataException)
                        {
                            Console.WriteLine("PASS: valid and invalid headers handled.");
                            NativeImageSelfTest();
                            return 0;
                        }
                        throw new Exception("Invalid magic accepted.");
                    }
                    finally { File.Delete(filename); }
                }
                throw new ArgumentException("Unknown command: " + command);
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("ERROR: " + e.Message);
                return 1;
            }
        }

        // These native functions are built into WasmBridge.Native.dll by v141_xp.
        // The managed host and native DLL must have matching x86/x64 bitness.
        [DllImport("WasmBridge.Native.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr wb_rgba_buffer();

        [DllImport("WasmBridge.Native.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int wb_rgba_capacity();

        [DllImport("WasmBridge.Native.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int wb_rgba_invert(int width, int height);

        private static void NativeImageSelfTest()
        {
            if (wb_rgba_capacity() < 8)
                throw new InvalidOperationException("Native RGBA buffer is too small.");
            IntPtr address = wb_rgba_buffer();
            if (address == IntPtr.Zero)
                throw new InvalidOperationException("Native RGBA buffer pointer was null.");

            byte[] sample = new byte[] { 1, 2, 3, 4, 200, 100, 0, 128 };
            Marshal.Copy(sample, 0, address, sample.Length);
            if (wb_rgba_invert(2, 1) != sample.Length)
                throw new InvalidOperationException("Native RGBA inversion rejected valid dimensions.");
            byte[] actual = new byte[sample.Length];
            Marshal.Copy(address, actual, 0, actual.Length);
            byte[] expected = new byte[] { 254, 253, 252, 4, 55, 155, 255, 128 };
            for (int i = 0; i < actual.Length; ++i)
                if (actual[i] != expected[i])
                    throw new InvalidOperationException("Native RGBA inversion result mismatch at byte " + i + ".");
            if (wb_rgba_invert(513, 1) != -1)
                throw new InvalidOperationException("Native RGBA bounds check accepted width 513.");
            Console.WriteLine("PASS: native RGBA8 inversion, alpha and bounds handled.");
        }

        private static Dictionary<string, string> Parse(string[] args)
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < args.Length; i += 2)
            {
                if (!args[i].StartsWith("--") || i + 1 == args.Length)
                    throw new ArgumentException("Expected --key value pairs.");
                string key = args[i].Substring(2);
                if (values.ContainsKey(key)) throw new ArgumentException("Duplicate option: " + key);
                values[key] = args[i + 1];
            }
            return values;
        }

        private static string Required(Dictionary<string, string> p, string key)
        {
            string value;
            if (!p.TryGetValue(key, out value) || String.IsNullOrEmpty(value))
                throw new ArgumentException("Missing --" + key);
            return value;
        }

        private static void Help()
        {
            Console.WriteLine("WasmBridge 0.1 - XP/.NET 4.0 compatible build/packaging frontend");
            Console.WriteLine("  build --source Core\\math.c --out add.wasm [--clang path] [--export add]");
            Console.WriteLine("  build --source Core\\image.c --out rgba.wasm --export wb_rgba_buffer,wb_rgba_capacity,wb_rgba_invert");
            Console.WriteLine("  package --wasm add.wasm --fallback Examples\\HelloWorld\\add.js --runtime Runtime\\wasmbridge.js --out dist [--export add]");
            Console.WriteLine("  verify --wasm add.wasm     (header only)");
            Console.WriteLine("  self-test                   (managed header and native RGBA8 tests)");
            Console.WriteLine("For multiple exports, provide comma-separated names with no spaces.");
            Console.WriteLine("External WASM-targeting LLVM/Clang is required to compile; actual browser testing is separate.");
        }
    }
}
