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
                if (args.Length == 0 || args[0] == "help" || args[0] == "--help") { Help(); return 0; }
                string command = args[0].ToLowerInvariant(); Dictionary<string,string> p = Parse(args);
                if (command == "build")
                {
                    RejectUnknown(p, "source,out,clang,export,timeout,address-bits");
                    CompileOptions o = new CompileOptions(); o.SourceFile=Required(p,"source"); o.OutputFile=Required(p,"out");
                    o.ClangPath=p.ContainsKey("clang")?p["clang"]:BundledOrCommand("emsdk\\upstream\\bin\\clang.exe","clang"); if(p.ContainsKey("export"))o.ExportName=p["export"]; if(p.ContainsKey("timeout"))o.TimeoutMilliseconds=Int32.Parse(p["timeout"]); if(p.ContainsKey("address-bits"))o.AddressBits=ParseAddressBits(p["address-bits"]);
                    CompileResult r=WasmCompiler.CompileC(o); Console.WriteLine("Built "+r.OutputFile+" (wasm"+o.AddressBits+")"); return 0;
                }
                if (command == "build-emscripten")
                {
                    RejectUnknown(p,"source,sources,out,emcc,export,include,define,timeout,address-bits");
                    EmscriptenCompileOptions o=new EmscriptenCompileOptions(); if(!p.ContainsKey("source")&&!p.ContainsKey("sources"))throw new ArgumentException("Missing --source or --sources"); if(p.ContainsKey("source"))o.SourceFile=p["source"]; if(p.ContainsKey("sources"))o.SourceFiles=SplitList(p["sources"]); o.OutputFile=Required(p,"out"); o.EmccPath=p.ContainsKey("emcc")?p["emcc"]:BundledOrCommand("emsdk\\upstream\\emscripten\\emcc.exe","emcc"); if(p.ContainsKey("export"))o.ExportName=p["export"]; if(p.ContainsKey("include"))o.IncludeDirectories=SplitList(p["include"]); if(p.ContainsKey("define"))o.Defines=SplitList(p["define"]); if(p.ContainsKey("timeout"))o.TimeoutMilliseconds=Int32.Parse(p["timeout"]); if(p.ContainsKey("address-bits"))o.AddressBits=ParseAddressBits(p["address-bits"]); WasmCompiler.CompileEmscriptenC(o); Console.WriteLine("Built standalone Emscripten wasm"+o.AddressBits+" module "+Path.GetFullPath(o.OutputFile)); return 0;
                }
                if(command=="validate-legacy") { RejectUnknown(p,"wasm,validator"); string validator=p.ContainsKey("validator")?p["validator"]:BundledRequired("wabt-1.0.42\\bin\\wasm-validate.exe"); ExternalToolchain.ValidateLegacy(Required(p,"wasm"),validator); Console.WriteLine("PASS: restricted Firefox-52/MVP wasm32 profile validated."); return 0; }
                if(command=="generate-fallback") { RejectUnknown(p,"wasm,out,wasm2js,esbuild,validator,global"); string validator=p.ContainsKey("validator")?p["validator"]:BundledRequired("wabt-1.0.42\\bin\\wasm-validate.exe"); string wasm2js=p.ContainsKey("wasm2js")?p["wasm2js"]:BundledRequired("binaryen-version_133\\bin\\wasm2js.exe"); string esbuild=p.ContainsKey("esbuild")?p["esbuild"]:BundledRequired("esbuild-0.28.2\\esbuild.exe"); ExternalToolchain.GenerateFallback(Required(p,"wasm"),Required(p,"out"),wasm2js,esbuild,validator,p.ContainsKey("global")?p["global"]:"WasmBridgeGeneratedCandidate"); Console.WriteLine("Generated classic-script candidate: "+Path.GetFullPath(p["out"])); return 0; }
                if(command=="optimize-legacy") { RejectUnknown(p,"wasm,out,optimizer,validator"); string optimizer=p.ContainsKey("optimizer")?p["optimizer"]:BundledRequired("binaryen-version_133\\bin\\wasm-opt.exe"); string validator=p.ContainsKey("validator")?p["validator"]:BundledRequired("wabt-1.0.42\\bin\\wasm-validate.exe"); ExternalToolchain.OptimizeLegacy(Required(p,"wasm"),Required(p,"out"),optimizer,validator); Console.WriteLine("PASS: optimized legacy Wasm validated."); return 0; }
                if(command=="package")
                {
                    RejectUnknown(p,"wasm,fallback,runtime,adapter,module-runtime,out,export,allocator,memory-export,fallback-global,signatures");
                    PackageOptions o=new PackageOptions(); o.WasmFile=Required(p,"wasm");o.FallbackFile=Required(p,"fallback");o.RuntimeFile=Required(p,"runtime");o.OutputDirectory=Required(p,"out"); if(p.ContainsKey("adapter"))o.AdapterFile=p["adapter"];if(p.ContainsKey("module-runtime"))o.ModuleRuntimeFile=p["module-runtime"];if(p.ContainsKey("export"))o.ExportName=p["export"];if(p.ContainsKey("allocator"))o.AllocatorName=p["allocator"];if(p.ContainsKey("memory-export"))o.MemoryExport=p["memory-export"];if(p.ContainsKey("fallback-global"))o.FallbackGlobal=p["fallback-global"];if(p.ContainsKey("signatures"))o.SignaturesFile=p["signatures"];Console.WriteLine("Package manifest: "+WasmPackage.Create(o));return 0;
                }
                if(command=="verify") { RejectUnknown(p,"wasm"); string f=Required(p,"wasm");WasmPackage.VerifyHeader(f);Console.WriteLine("PASS: WebAssembly magic/version header: "+Path.GetFullPath(f));return 0; }
                if(command=="verify-package") { RejectUnknown(p,"manifest");Console.WriteLine("PASS: "+WasmPackage.VerifyPackage(Required(p,"manifest"))+" package verified.");return 0; }
                if(command=="self-test") { RejectUnknown(p,""); SelfTest(); return 0; }
                throw new ArgumentException("Unknown command: "+command);
            }
            catch(Exception e){Console.Error.WriteLine("ERROR: "+e.Message);return 1;}
        }

        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr wb_alloc(uint bytes);
        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern int wb_free(IntPtr pointer);
        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern uint wb_capacity(IntPtr pointer);
        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern uint wb_invert_rgba(IntPtr source,IntPtr destination,uint bytes);
        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern uint wb_active_count();
        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern uint wb_address_bits();
        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr wb_rgba_buffer();
        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern int wb_rgba_capacity();
        [DllImport("WasmBridge.Native.dll",CallingConvention=CallingConvention.Cdecl)] private static extern int wb_rgba_invert(int width,int height);

        private static void SelfTest()
        {
            string filename=Path.GetTempFileName();try{File.WriteAllBytes(filename,new byte[]{0,97,115,109,1,0,0,0});WasmPackage.VerifyHeader(filename);File.WriteAllBytes(filename,new byte[]{1,2,3});bool rejected=false;try{WasmPackage.VerifyHeader(filename);}catch(InvalidDataException){rejected=true;}if(!rejected)throw new Exception("Invalid magic accepted.");}finally{File.Delete(filename);} NativeImageSelfTest(); NativeBuffersSelfTest(); Console.WriteLine("PASS: managed header and native self-tests.");
        }
        private static void NativeImageSelfTest(){if(wb_rgba_capacity()<8||wb_rgba_buffer()==IntPtr.Zero)throw new InvalidOperationException("Native RGBA ABI invalid.");byte[] s={1,2,3,4,200,100,0,128},a=new byte[8];Marshal.Copy(s,0,wb_rgba_buffer(),8);if(wb_rgba_invert(2,1)!=8)throw new InvalidOperationException("Native RGBA call failed.");Marshal.Copy(wb_rgba_buffer(),a,0,8);if(a[0]!=254||a[3]!=4)throw new InvalidOperationException("Native RGBA result mismatch.");}
        private static void NativeBuffersSelfTest()
        {
            if(wb_address_bits()!=(uint)(IntPtr.Size*8))throw new InvalidOperationException("Native allocator address-width report mismatch.");
            List<IntPtr> many=new List<IntPtr>();try{for(int i=0;i<300;i++){IntPtr p=wb_alloc(8);if(p==IntPtr.Zero)throw new OutOfMemoryException("Native allocation "+i+" failed.");many.Add(p);}if(wb_active_count()!=300)throw new InvalidOperationException("Native allocator did not exceed old 128-slot limit.");}finally{for(int i=many.Count-1;i>=0;i--)if(wb_free(many[i])!=1)throw new InvalidOperationException("Native cleanup failed.");}
            IntPtr src=IntPtr.Zero,dst=IntPtr.Zero;try{src=wb_alloc(8);dst=wb_alloc(8);if(src==IntPtr.Zero||dst==IntPtr.Zero||wb_capacity(src)<8)throw new InvalidOperationException("Native allocation failed.");byte[] input={1,2,3,4,200,100,0,128},actual=new byte[8];Marshal.Copy(input,0,src,8);if(wb_invert_rgba(src,dst,8)!=8)throw new InvalidOperationException("Native invert failed.");Marshal.Copy(dst,actual,0,8);if(actual[0]!=254||actual[3]!=4)throw new InvalidOperationException("Native buffer output mismatch.");}finally{if(dst!=IntPtr.Zero)wb_free(dst);if(src!=IntPtr.Zero)wb_free(src);}if(wb_active_count()!=0)throw new InvalidOperationException("Native allocator leaked buffers.");
        }

        private static string FindBundledTool(string relative)
        {
            DirectoryInfo dir=new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for(int i=0;i<8&&dir!=null;i++,dir=dir.Parent)
            {
                string candidate=Path.Combine(Path.Combine(dir.FullName,"Toolchain"),relative);
                if(File.Exists(candidate))return candidate;
            }
            string env=Environment.GetEnvironmentVariable("WASMBRIDGE_TOOLS");
            if(!String.IsNullOrEmpty(env))
            {
                string candidate=Path.Combine(env,relative);
                if(File.Exists(candidate))return candidate;
            }
            return null;
        }
        private static string BundledRequired(string relative){string p=FindBundledTool(relative);if(String.IsNullOrEmpty(p))throw new FileNotFoundException("Bundled WasmBridge tool not found: Toolchain\\"+relative+". Run Tools\\Import-Toolchain.ps1 or supply the explicit tool option.");return p;}
        private static string BundledOrCommand(string relative,string command){string p=FindBundledTool(relative);return String.IsNullOrEmpty(p)?command:p;}

        private static Dictionary<string,string> Parse(string[] args){Dictionary<string,string> v=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);for(int i=1;i<args.Length;i+=2){if(!args[i].StartsWith("--")||i+1==args.Length)throw new ArgumentException("Expected --key value pairs.");string k=args[i].Substring(2);if(v.ContainsKey(k))throw new ArgumentException("Duplicate option: "+k);v[k]=args[i+1];}return v;}
        private static void RejectUnknown(Dictionary<string,string> p,string allowedText){HashSet<string> allowed=new HashSet<string>((allowedText??"").Split(new[]{','},StringSplitOptions.RemoveEmptyEntries),StringComparer.OrdinalIgnoreCase);foreach(string k in p.Keys)if(!allowed.Contains(k))throw new ArgumentException("Unknown option: --"+k);}
        private static string Required(Dictionary<string,string> p,string key){string v;if(!p.TryGetValue(key,out v)||String.IsNullOrEmpty(v))throw new ArgumentException("Missing --"+key);return v;}
        private static string[] SplitList(string value){string[] p=(value??"").Split(new[]{';'},StringSplitOptions.RemoveEmptyEntries);if(p.Length==0)throw new ArgumentException("List option cannot be empty.");return p;}
        private static int ParseAddressBits(string value){int n;if(!Int32.TryParse(value,out n)||(n!=32&&n!=64))throw new ArgumentException("--address-bits must be 32 or 64.");return n;}
        private static void Help(){Console.WriteLine("WasmBridge 0.8.0 - XP-compatible Wasm build/packaging frontend");Console.WriteLine("Bundled Toolchain\\ dependencies are auto-discovered; explicit tool options remain overrides.");Console.WriteLine("  build --source file.c --out module.wasm [--address-bits 32|64] [--export name]");Console.WriteLine("  build-emscripten --source file.c --out module.wasm [--address-bits 32|64]");Console.WriteLine("  package --wasm module.wasm --fallback fallback.js --runtime Runtime\\wasmbridge.js --out dist");Console.WriteLine("  verify --wasm module.wasm | verify-package --manifest dist\\manifest.json | self-test");Console.WriteLine("  validate-legacy / generate-fallback / optimize-legacy remain Firefox-52 wasm32 tools.");Console.WriteLine("memory64/wasm64 requires a modern engine; Firefox 52 remains wasm32.");}
    }
}
