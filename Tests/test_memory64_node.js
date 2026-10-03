/* Optional memory64 regression. Uses current engine or relaunches with the V8 flag when required. */
"use strict";
const cp=require("child_process"),fs=require("fs"),path=require("path"),assert=require("assert"),vm=require("vm");
const root=path.resolve(__dirname,".."),bytes=fs.readFileSync(path.join(root,"Examples/BufferArena/buffers64.wasm"));
if(process.env.WASMBRIDGE_MEMORY64_CHILD!=="1" && !WebAssembly.validate(bytes)){
 const r=cp.spawnSync(process.execPath,["--experimental-wasm-memory64",__filename],{encoding:"utf8",env:Object.assign({},process.env,{WASMBRIDGE_MEMORY64_CHILD:"1"})});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
 if(r.status===0)process.exit(0);
 if((r.stderr||"").match(/bad option|unknown option|not allowed in NODE_OPTIONS/i)){console.log("SKIP: this Node build has no memory64 mode.");process.exit(0);}
 process.exit(r.status||1);
}
if(!WebAssembly.validate(bytes)){console.log("SKIP: this WebAssembly engine does not validate memory64.");process.exit(0);}
const binary=bytes,c={WebAssembly,Promise,ArrayBuffer,Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt,Math,Object,Number,String,JSON,RangeError,Error,TypeError,fetch:()=>Promise.resolve({ok:true,arrayBuffer:()=>Promise.resolve(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength))})};c.window=c;vm.createContext(c);["Runtime/wasmbridge.js","Runtime/module.js"].forEach(f=>vm.runInContext(fs.readFileSync(path.join(root,f),"utf8"),c,{filename:f}));
(async()=>{const fallback={memory:{buffer:new ArrayBuffer(65536),grow:()=>0},wb_address_bits:()=>64,wb_alloc:()=>128n,wb_free:()=>1,wb_capacity:()=>64n,wb_active_count:()=>0};const m=await c.WasmBridgeModule.load({wasm:"buffers64.wasm",fallback,exports:["wb_active_count"],allocator:{allocate:"wb_alloc",release:"wb_free",capacity:"wb_capacity"}});assert.strictEqual(m.backend,"wasm");assert.strictEqual(m.statistics().addressBits,64);const h=m.allocate(64);assert.strictEqual(typeof h.pointer,"bigint");m.write(h,new Uint8Array([1,2,3,4]));assert.deepStrictEqual(Array.from(m.read(h,4)),[1,2,3,4]);m.release(h);console.log("PASS: memory64 module, i64/BigInt pointers and WasmBridge 64-bit addressing path.");})().catch(e=>{console.error(e);process.exitCode=1;});
