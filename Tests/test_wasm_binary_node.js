/* Direct WebAssembly binary regression tests. These bypass WasmBridge wrappers. */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
function load(relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  assert.strictEqual(WebAssembly.validate(bytes), true, relative + " must validate");
  const module = new WebAssembly.Module(bytes);
  assert.strictEqual(WebAssembly.Module.imports(module).length, 0, relative + " must remain standalone");
  return {module, instance:new WebAssembly.Instance(module,{})};
}
function exportsInclude(module,names,label){
  const have=WebAssembly.Module.exports(module).map(x=>x.name);
  names.forEach(n=>assert.ok(have.indexOf(n)>=0,label+" missing export "+n));
}
function bytesAt(memory,pointer,count){return Array.from(new Uint8Array(memory.buffer,pointer,count));}
(function hello(){const x=load("Examples/HelloWorld/add.wasm");exportsInclude(x.module,["add"],"HelloWorld");assert.strictEqual(x.instance.exports.add(20,22),42);assert.strictEqual(x.instance.exports.add(-10,3),-7);assert.strictEqual(x.instance.exports.add(2147483647,1),-2147483648);})();
(function emscripten(){const x=load("Examples/EmscriptenHelloWorld/add.wasm");exportsInclude(x.module,["memory","add"],"Emscripten");assert.strictEqual(x.instance.exports.add(123,-23),100);})();
(function rgba(){const x=load("Examples/ImageProcessing/rgba.wasm"),a=x.instance.exports;exportsInclude(x.module,["memory","wb_rgba_buffer","wb_rgba_capacity","wb_rgba_invert"],"RGBA");const p=a.wb_rgba_buffer(),cap=a.wb_rgba_capacity();assert.strictEqual(cap,512*512*4);const input=[1,2,3,4,20,40,80,160,255,128,0,33,9,10,11,12];new Uint8Array(a.memory.buffer).set(input,p);assert.strictEqual(a.wb_rgba_invert(2,2),16);assert.deepStrictEqual(bytesAt(a.memory,p,16),[254,253,252,4,235,215,175,160,0,127,255,33,246,245,244,12]);assert.strictEqual(a.wb_rgba_invert(2,2),16);assert.deepStrictEqual(bytesAt(a.memory,p,16),input);assert.strictEqual(a.wb_rgba_invert(0,1),-1);assert.strictEqual(a.wb_rgba_invert(513,1),-1);})();
(function buffers(){
  const x=load("Examples/BufferArena/buffers.wasm"),a=x.instance.exports;
  exportsInclude(x.module,["memory","wb_address_bits","wb_alloc","wb_free","wb_capacity","wb_active_count","wb_invert_rgba"],"BufferArena");
  assert.strictEqual(a.wb_address_bits(),32); assert.strictEqual(a.wb_active_count(),0); assert.strictEqual(a.wb_alloc(0),0);
  const first=a.wb_alloc(1), second=a.wb_alloc(9); assert.ok(first>0&&second>0&&first!==second); assert.strictEqual(first&7,0); assert.strictEqual(second&7,0); assert.strictEqual(a.wb_capacity(first),8); assert.strictEqual(a.wb_capacity(second),16);
  new Uint8Array(a.memory.buffer,second,8).set([1,2,3,4,200,100,0,128]); assert.strictEqual(a.wb_invert_rgba(second,second,8),8); assert.deepStrictEqual(bytesAt(a.memory,second,8),[254,253,252,4,55,155,255,128]); assert.strictEqual(a.wb_invert_rgba(second,second,7),-1); assert.strictEqual(a.wb_invert_rgba(second+1,second,4),-1);
  assert.strictEqual(a.wb_free(first),1); assert.strictEqual(a.wb_capacity(first),0); assert.strictEqual(a.wb_free(first),0); assert.strictEqual(a.wb_free(second),1);
  const pointers=[]; for(let i=0;i<300;i++){const p=a.wb_alloc(8);assert.ok(p>0,"allocation "+i+" failed");pointers.push(p);} assert.strictEqual(a.wb_active_count(),300); pointers.forEach(p=>assert.strictEqual(a.wb_free(p),1)); assert.strictEqual(a.wb_active_count(),0);
  const p40=a.wb_alloc(40*1024*1024); if(!p40){const pages=Math.ceil((40*1024*1024+65536)/65536);a.memory.grow(pages);}
  const big=p40||a.wb_alloc(40*1024*1024); assert.ok(big>0,"40 MiB allocation should not hit an artificial ceiling"); assert.ok(a.memory.buffer.byteLength>32*1024*1024); assert.strictEqual(a.wb_free(big),1);
  const aa=a.wb_alloc(64),bb=a.wb_alloc(64),guard=a.wb_alloc(64);assert.ok(aa&&bb&&guard);assert.strictEqual(a.wb_free(aa),1);assert.strictEqual(a.wb_free(bb),1);const combined=a.wb_alloc(120);assert.strictEqual(combined,aa);assert.ok(a.wb_capacity(combined)>=120);assert.strictEqual(a.wb_free(combined),1);assert.strictEqual(a.wb_free(guard),1);
})();
(function malformed(){[new Uint8Array([1,2,3,4]),new Uint8Array([0,97,115,109,1,0,0,0,255])].forEach(b=>{assert.strictEqual(WebAssembly.validate(b),false);assert.throws(()=>new WebAssembly.Module(b),WebAssembly.CompileError);});})();
console.log("PASS: direct WASM binaries, dynamic allocator beyond 32 MiB/128 handles, coalescing, address-width export, RGBA and malformed-module rejection.");
