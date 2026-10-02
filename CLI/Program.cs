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
                if (command == "build-emscripten")
                {
                    EmscriptenCompileOptions o = new EmscriptenCompileOptions();
                    if (!p.ContainsKey("source") && !p.ContainsKey("sources"))
                        throw new ArgumentException("Missing --source or --sources");
                    if (p.ContainsKey("source")) o.SourceFile = p["source"];
                    o.OutputFile = Required(p, "out");
                    if (p.ContainsKey("emcc")) o.EmccPath = p["emcc"];
                    if (p.ContainsKey("export")) o.ExportName = p["export"];
                    if (p.ContainsKey("sources")) o.SourceFiles = SplitList(p["sources"]);
                    if (p.ContainsKey("include")) o.IncludeDirectories = SplitList(p["include"]);
                    if (p.ContainsKey("define")) o.Defines = SplitList(p["define"]);
                    if (p.ContainsKey("timeout")) o.TimeoutMilliseconds = Int32.Parse(p["timeout"]);
                    CompileResult r = WasmCompiler.CompileEmscriptenC(o);
                    Console.WriteLine("Built standalone Emscripten module " + r.OutputFile);
                    Console.WriteLine("Emscripten exit: " + r.ExitCode);
                    if (!String.IsNullOrEmpty(r.StandardOutput)) Console.WriteLine(r.StandardOutput);
                    if (!String.IsNullOrEmpty(r.StandardError)) Console.WriteLine(r.StandardError);
                    return 0;
                }
                if (command == "validate-legacy")
                {
                    ExternalToolchain.ValidateLegacy(Required(p, "wasm"), Required(p, "validator"));
                    Console.WriteLine("PASS: WABT validated restricted MVP feature profile.");
                    Console.WriteLine("Actual Firefox 52.9 ESR browser execution and JS loader still require testing.");
                    return 0;
                }
                if (command == "generate-fallback")
                {
                    ExternalToolchain.GenerateFallback(Required(p, "wasm"), Required(p, "out"),
                        Required(p, "wasm2js"), Required(p, "esbuild"), Required(p, "validator"),
                        p.ContainsKey("global") ? p["global"] : "WasmBridgeGeneratedCandidate");
                    Console.WriteLine("Generated classic-script candidate: " + Path.GetFullPath(p["out"]));
                    Console.WriteLine("EXPERIMENTAL: generated exports/memory ABI must be verified before replacing a known-good JS fallback.");
                    return 0;
                }
                if (command == "optimize-legacy")
                {
                    ExternalToolchain.OptimizeLegacy(Required(p, "wasm"), Required(p, "out"),
                        Required(p, "optimizer"), Required(p, "validator"));
                    Console.WriteLine("PASS: optimized Wasm validated under restricted MVP profile: " +
                        Path.GetFullPath(p["out"]));
                    return 0;
                }
                if (command == "package")
                {
                    PackageOptions o = new PackageOptions();
                    o.WasmFile = Required(p, "wasm");
                    o.FallbackFile = Required(p, "fallback");
                    o.RuntimeFile = Required(p, "runtime");
                    if (p.ContainsKey("adapter")) o.AdapterFile = p["adapter"];
                    if (p.ContainsKey("module-runtime")) o.ModuleRuntimeFile = p["module-runtime"];
                    o.OutputDirectory = Required(p, "out");
                    if (p.ContainsKey("export")) o.ExportName = p["export"];
                    if (p.ContainsKey("allocator")) o.AllocatorName = p["allocator"];
                    if (p.ContainsKey("memory-export")) o.MemoryExport = p["memory-export"];
                    if (p.ContainsKey("fallback-global")) o.FallbackGlobal = p["fallback-global"];
                    if (p.ContainsKey("signatures")) o.SignaturesFile = p["signatures"];
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
                if (command == "verify-package")
                {
                    string manifest = Required(p, "manifest");
                    string format = WasmPackage.VerifyPackage(manifest);
                    Console.WriteLine("PASS: " + format + " structure, containment, artifacts, hashes and WASM header.");
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
                            NativeBuffersSelfTest();
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


        [DllImport("WasmBridge.Native.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr wb_alloc(int bytes);

        [DllImport("WasmBridge.Native.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int wb_free(IntPtr pointer);

        [DllImport("WasmBridge.Native.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int wb_capacity(IntPtr pointer);

        [DllImport("WasmBridge.Native.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int wb_invert_rgba(IntPtr source, IntPtr destination, int bytes);

        [DllImport("WasmBridge.Native.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int wb_active_count();

        private static void NativeBuffersSelfTest()
        {
            IntPtr source = IntPtr.Zero;
            IntPtr destination = IntPtr.Zero;
            try
            {
                source = wb_alloc(8);
                destination = wb_alloc(8);
                if (source == IntPtr.Zero || destination == IntPtr.Zero || source == destination ||
                    wb_capacity(source) < 8 || wb_capacity(destination) < 8 ||
                    wb_active_count() != 2)
                    throw new InvalidOperationException("Native allocator returned invalid independent buffers.");

                byte[] input = { 1, 2, 3, 4, 200, 100, 0, 128 };
                byte[] expected = { 254, 253, 252, 4, 55, 155, 255, 128 };
                byte[] actual = new byte[8];
                Marshal.Copy(input, 0, source, input.Length);
                if (wb_invert_rgba(source, destination, input.Length) != input.Length ||
                    wb_invert_rgba(source, destination, 7) != -1)
                    throw new InvalidOperationException("Native allocator RGB processing rejected valid input or accepted invalid size.");
                Marshal.Copy(destination, actual, 0, actual.Length);
                for (int i = 0; i < actual.Length; i++)
                    if (actual[i] != expected[i])
                        throw new InvalidOperationException("Native allocator RGB/alpha mismatch at byte " + i);
            }
            finally
            {
                if (destination != IntPtr.Zero && wb_free(destination) != 1)
                    throw new InvalidOperationException("Native allocator failed to release destination.");
                if (source != IntPtr.Zero && wb_free(source) != 1)
                    throw new InvalidOperationException("Native allocator failed to release source.");
            }
            if (wb_active_count() != 0)
                throw new InvalidOperationException("Native allocator leaked live buffers.");
            if (wb_free(source) != 0 || wb_capacity(source) != 0)
                throw new InvalidOperationException("Native allocator allowed a stale pointer.");
            Console.WriteLine("PASS: XP native independent buffers, RGBA output, release and bounds.");

            const int side = 512;
            const int size = side * side * 4;
            byte[] testPixels = new byte[size];
            byte[] outputPixels = new byte[size];
            for (int i = 0; i < size; i++) testPixels[i] = (byte)(i * 17);
            System.Diagnostics.Stopwatch timer = System.Diagnostics.Stopwatch.StartNew();
            for (int iteration = 0; iteration < 3; iteration++)
            {
                IntPtr inputPointer = IntPtr.Zero;
                IntPtr outputPointer = IntPtr.Zero;
                try
                {
                    inputPointer = wb_alloc(size);
                    outputPointer = wb_alloc(size);
                    if (inputPointer == IntPtr.Zero || outputPointer == IntPtr.Zero)
                        throw new OutOfMemoryException("Native buffer benchmark allocation failed.");
                    Marshal.Copy(testPixels, 0, inputPointer, size);
                    if (wb_invert_rgba(inputPointer, outputPointer, size) != size)
                        throw new InvalidOperationException("Native buffer benchmark failed.");
                    Marshal.Copy(outputPointer, outputPixels, 0, size);
                }
                finally
                {
                    if (outputPointer != IntPtr.Zero) wb_free(outputPointer);
                    if (inputPointer != IntPtr.Zero) wb_free(inputPointer);
                }
                if (outputPixels[0] != 255 || outputPixels[3] != testPixels[3])
                    throw new InvalidOperationException("Native benchmark output mismatch.");
            }
            timer.Stop();
            Console.WriteLine("Native XP RGBA benchmark (512x512, mean 3 runs, alloc + Marshal.Copy in/out + invert): " +
                              (timer.Elapsed.TotalMilliseconds / 3.0).ToString("F2") + " ms");
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

        private static string[] SplitList(string value)
        {
            string[] parts = (value ?? "").Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) throw new ArgumentException("List option cannot be empty.");
            return parts;
        }

        private static void Help()
        {
            Console.WriteLine("WasmBridge 0.7.0-dev - XP/.NET 4.0 compatible build/packaging frontend");
            Console.WriteLine("  build --source Core\\math.c --out add.wasm [--clang path] [--export add]");
            Console.WriteLine("  build --source Core\\image.c --out rgba.wasm --export wb_rgba_buffer,wb_rgba_capacity,wb_rgba_invert");
            Console.WriteLine("  build-emscripten --source library.c --out library.wasm [--emcc path] [--export function1,function2]");
            Console.WriteLine("  build-emscripten also accepts --sources a.c;b.cpp --include dir1;dir2 --define NAME;VALUE=1");
            Console.WriteLine("  package --wasm add.wasm --fallback Examples\\HelloWorld\\add.js --runtime Runtime\\wasmbridge.js --out dist [--export add]");
            Console.WriteLine("  package supports optional --adapter Runtime\\buffers.js for specialized adapters.");
            Console.WriteLine("  general packages: --module-runtime Runtime\\module.js --allocator wb_alloc,wb_free,wb_capacity");
            Console.WriteLine("                    [--memory-export memory] [--fallback-global WasmBridgeBuffersFallback]");
            Console.WriteLine("                    [--signatures Examples\\BufferArena\\signatures.json]");
            Console.WriteLine("  verify --wasm add.wasm     (header only)");
            Console.WriteLine("  verify-package --manifest dist\\manifest.json");
            Console.WriteLine("  self-test                   (managed header, native RGBA8 and buffer-manager tests)");
            Console.WriteLine("  validate-legacy --wasm module.wasm --validator C:\\path\\to\\wasm-validate.exe");
            Console.WriteLine("  generate-fallback --wasm module.wasm --out candidate.js --validator path --wasm2js path --esbuild path [--global WasmBridgeGeneratedCandidate]");
            Console.WriteLine("  optimize-legacy --wasm module.wasm --out optimized.wasm --validator path --optimizer path");
            Console.WriteLine("  FF52 toolchain generation runs on build host; generated fallback ABI must be browser-tested.");
            Console.WriteLine("For multiple exports, provide comma-separated names with no spaces.");
            Console.WriteLine("External WASM-targeting LLVM/Clang is required to compile; actual browser testing is separate.");
        }
    }
}
