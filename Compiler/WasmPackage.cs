using System;
using System.Collections;
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
        public string AdapterFile;
        public string ModuleRuntimeFile;
        public string OutputDirectory;
        public string ExportName = "add";
        public string AllocatorName;
        public string MemoryExport = "memory";
        public string FallbackGlobal;
        public string SignaturesFile;
    }

    public static class WasmPackage
    {
        public static void VerifyHeader(string wasmFile)
        {
            if (String.IsNullOrEmpty(wasmFile) || !File.Exists(wasmFile)) throw new FileNotFoundException("Wasm file not found.", wasmFile);
            byte[] header={0,97,115,109,1,0,0,0};using(FileStream input=File.OpenRead(wasmFile)){for(int i=0;i<header.Length;i++)if(input.ReadByte()!=header[i])throw new InvalidDataException("Invalid WebAssembly header: "+wasmFile);}
        }

        public static string Create(PackageOptions o)
        {
            if(o==null)throw new ArgumentNullException("options");RequireFile(o.WasmFile,"WasmFile");RequireFile(o.FallbackFile,"FallbackFile");RequireFile(o.RuntimeFile,"RuntimeFile");OptionalFile(o.AdapterFile,"AdapterFile");OptionalFile(o.ModuleRuntimeFile,"ModuleRuntimeFile");OptionalFile(o.SignaturesFile,"SignaturesFile");if(String.IsNullOrEmpty(o.OutputDirectory))throw new ArgumentException("OutputDirectory is required.");
            string[] exports=SplitRequired(o.ExportName,"ExportName"),allocator=null;if(!String.IsNullOrEmpty(o.AllocatorName)){allocator=SplitRequired(o.AllocatorName,"AllocatorName");if(allocator.Length<2||allocator.Length>3)throw new ArgumentException("AllocatorName must contain allocate,release[,capacity].");if(String.IsNullOrEmpty(o.ModuleRuntimeFile))throw new ArgumentException("ModuleRuntimeFile is required when AllocatorName is specified.");}
            VerifyHeader(o.WasmFile);string dir=Path.GetFullPath(o.OutputDirectory);Directory.CreateDirectory(dir);string wasm=Copy(o.WasmFile,dir,"module.wasm"),fallback=Copy(o.FallbackFile,dir,"fallback.js"),runtime=Copy(o.RuntimeFile,dir,"wasmbridge.js"),adapter=null,moduleRuntime=null;if(!String.IsNullOrEmpty(o.AdapterFile))adapter=Copy(o.AdapterFile,dir,"adapter.js");if(!String.IsNullOrEmpty(o.ModuleRuntimeFile))moduleRuntime=Copy(o.ModuleRuntimeFile,dir,"module.js");
            Dictionary<string,object> m=new Dictionary<string,object>();m["format"]=moduleRuntime==null?"wasmbridge-package-0.1":"wasmbridge-package-0.2";m["wasm"]="module.wasm";m["fallback"]="fallback.js";m["runtime"]="wasmbridge.js";if(adapter!=null)m["adapter"]="adapter.js";if(moduleRuntime!=null)m["moduleRuntime"]="module.js";m["exports"]=exports;
            if(!String.IsNullOrEmpty(o.SignaturesFile)){if(moduleRuntime==null)throw new ArgumentException("ModuleRuntimeFile is required when SignaturesFile is specified.");Dictionary<string,object> sig;try{sig=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(o.SignaturesFile));}catch(Exception e){throw new InvalidDataException("SignaturesFile is not valid JSON: "+e.Message,e);}ValidateSignatures(sig,new HashSet<string>(exports,StringComparer.Ordinal));m["signatures"]=sig;}
            if(!String.IsNullOrEmpty(o.FallbackGlobal))m["fallbackGlobal"]=o.FallbackGlobal;if(allocator!=null){Dictionary<string,object>a=new Dictionary<string,object>();a["allocate"]=allocator[0];a["release"]=allocator[1];if(allocator.Length==3)a["capacity"]=allocator[2];m["allocator"]=a;m["memoryExport"]=String.IsNullOrEmpty(o.MemoryExport)?"memory":o.MemoryExport;}
            m["wasmSha256"]=Sha256(wasm);m["fallbackSha256"]=Sha256(fallback);m["runtimeSha256"]=Sha256(runtime);if(adapter!=null)m["adapterSha256"]=Sha256(adapter);if(moduleRuntime!=null)m["moduleRuntimeSha256"]=Sha256(moduleRuntime);m["compatibility"]="Instantiate and ABI-test on the target browser; Firefox 52 packages must remain wasm32.";string manifest=Path.Combine(dir,"manifest.json");File.WriteAllText(manifest,new JavaScriptSerializer().Serialize(m));return manifest;
        }

        public static string VerifyPackage(string manifestFile)
        {
            RequireFile(manifestFile,"Package manifest");string manifestPath=Path.GetFullPath(manifestFile),root=Path.GetDirectoryName(manifestPath);Dictionary<string,object> m;try{m=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(manifestPath));}catch(Exception e){throw new InvalidDataException("Package manifest is not valid JSON: "+e.Message,e);}string format=RequiredString(m,"format");if(format!="wasmbridge-package-0.1"&&format!="wasmbridge-package-0.2")throw new InvalidDataException("Unsupported package format: "+format);
            Dictionary<string,string> expected=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);AddArtifact(m,root,expected,"wasm","wasmSha256");AddArtifact(m,root,expected,"fallback","fallbackSha256");AddArtifact(m,root,expected,"runtime","runtimeSha256");if(m.ContainsKey("adapter"))AddArtifact(m,root,expected,"adapter","adapterSha256");if(format=="wasmbridge-package-0.2")AddArtifact(m,root,expected,"moduleRuntime","moduleRuntimeSha256");
            object ev;if(!m.TryGetValue("exports",out ev))throw new InvalidDataException("Manifest exports are required.");IList list=ev as IList;if(list==null||list.Count==0)throw new InvalidDataException("Manifest exports must be a non-empty array.");HashSet<string> names=new HashSet<string>(StringComparer.Ordinal);for(int i=0;i<list.Count;i++){string n=list[i] as string;if(String.IsNullOrEmpty(n)||!names.Add(n))throw new InvalidDataException("Manifest exports contain an empty or duplicate name.");}
            if(m.ContainsKey("signatures")){Dictionary<string,object> sig=m["signatures"] as Dictionary<string,object>;if(sig==null)throw new InvalidDataException("Manifest signatures must be an object.");ValidateSignatures(sig,names);}if(m.ContainsKey("allocator")){if(format!="wasmbridge-package-0.2")throw new InvalidDataException("Allocator metadata requires package format 0.2.");Dictionary<string,object>a=m["allocator"] as Dictionary<string,object>;if(a==null)throw new InvalidDataException("Allocator metadata must be an object.");RequiredString(a,"allocate");RequiredString(a,"release");if(a.ContainsKey("capacity"))RequiredString(a,"capacity");RequiredString(m,"memoryExport");}
            VerifyHeader(expected[RequiredString(m,"wasm")]);HashSet<string> allowed=new HashSet<string>(expected.Values,StringComparer.OrdinalIgnoreCase);allowed.Add(manifestPath);foreach(string f in Directory.GetFiles(root,"*",SearchOption.AllDirectories))if(!allowed.Contains(Path.GetFullPath(f)))throw new InvalidDataException("Unexpected package artifact: "+Path.GetFullPath(f).Substring(root.Length).TrimStart(Path.DirectorySeparatorChar));return format;
        }

        private static void ValidateSignatures(Dictionary<string,object> signatures,HashSet<string> exports){foreach(KeyValuePair<string,object> item in signatures){if(!exports.Contains(item.Key))throw new InvalidDataException("Signature names an undeclared export: "+item.Key);Dictionary<string,object>s=item.Value as Dictionary<string,object>;if(s==null)throw new InvalidDataException("Signature must be an object: "+item.Key);object pv;IList p;if(!s.TryGetValue("parameters",out pv)||(p=pv as IList)==null)throw new InvalidDataException("Signature parameters must be an array: "+item.Key);for(int i=0;i<p.Count;i++)ValidateAbiType(p[i] as string,false,item.Key);object rv;ValidateAbiType(s.TryGetValue("result",out rv)?rv as string:"void",true,item.Key);}}
        private static void ValidateAbiType(string type,bool allowVoid,string name){if(type=="i32"||type=="i64"||type=="f32"||type=="f64"||(allowVoid&&type=="void"))return;throw new InvalidDataException("Unsupported ABI type for "+name+": "+type);}
        private static void AddArtifact(Dictionary<string,object> m,string root,Dictionary<string,string> expected,string pathKey,string hashKey){string rel=RequiredString(m,pathKey);if(Path.IsPathRooted(rel))throw new InvalidDataException("Package artifact path must be relative: "+rel);string full=Path.GetFullPath(Path.Combine(root,rel)),prefix=root.TrimEnd(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar)+Path.DirectorySeparatorChar;if(!full.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Package artifact escapes its directory: "+rel);RequireFile(full,"Package artifact");if(expected.ContainsKey(rel))throw new InvalidDataException("Duplicate package artifact path: "+rel);string hash=RequiredString(m,hashKey);if(!String.Equals(hash,Sha256(full),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("SHA-256 mismatch for package artifact: "+rel);expected[rel]=full;}
        private static string RequiredString(Dictionary<string,object> d,string k){object v;string s;if(!d.TryGetValue(k,out v)||String.IsNullOrEmpty(s=v as string))throw new InvalidDataException("Manifest string field is required: "+k);return s;}
        private static string[] SplitRequired(string value,string label){if(String.IsNullOrEmpty(value))throw new ArgumentException(label+" is required.");string[] raw=value.Split(',');List<string> r=new List<string>();for(int i=0;i<raw.Length;i++){string x=raw[i].Trim();if(x.Length==0||r.Contains(x))throw new ArgumentException(label+" contains an empty or duplicate name.");r.Add(x);}return r.ToArray();}
        private static string Copy(string src,string dir,string name){string dst=Path.Combine(dir,name);if(!String.Equals(Path.GetFullPath(src),Path.GetFullPath(dst),StringComparison.OrdinalIgnoreCase))File.Copy(src,dst,true);return dst;}
        private static void RequireFile(string p,string label){if(String.IsNullOrEmpty(p)||!File.Exists(p))throw new FileNotFoundException(label+" not found.",p);}private static void OptionalFile(string p,string label){if(!String.IsNullOrEmpty(p)&&!File.Exists(p))throw new FileNotFoundException(label+" not found.",p);}
        private static string Sha256(string f){using(FileStream s=File.OpenRead(f))using(SHA256 h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(s)).Replace("-","").ToLowerInvariant();}
    }
}
