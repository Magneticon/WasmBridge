/* Host-only test for the optional XHR byte loader and standard fetch behavior.
   Use actual XP Firefox 52.9 ESR for the acceptance test. */
"use strict";
const fs=require("fs"), path=require("path"), vm=require("vm"), assert=require("assert");
const root=path.resolve(__dirname,"..");
const binary=fs.readFileSync(path.join(root,"Examples/HelloWorld/add.wasm"));
function read(name){return fs.readFileSync(path.join(root,name),"utf8");}
async function test(withFetch) {
    var hits=0;
    function XHR() {this.status=200;this.responseType="";this.response=null;}
    XHR.prototype.open=function(method,url,async) {
        assert.strictEqual(method,"GET");assert.strictEqual(url,"add.wasm");assert.strictEqual(async,true);
    };
    XHR.prototype.send=function() {
        hits++;
        this.response=binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength);
        this.onload();
    };
    var ctx={
        Promise:Promise, WebAssembly:WebAssembly, ArrayBuffer:ArrayBuffer,
        Uint8Array:Uint8Array, XMLHttpRequest:XHR,
        fetch:withFetch?function(url) {
            hits++;
            return Promise.resolve({ok:true,arrayBuffer:function(){
                return Promise.resolve(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength));
            }});
        }:undefined,
        location:{protocol:"file:"}, Object:Object, Error:Error, RangeError:RangeError
    };
    ctx.window=ctx;
    vm.createContext(ctx);
    vm.runInContext(read("Runtime/legacy-compat.js"),ctx,{filename:"legacy-compat.js"});
    vm.runInContext(read("Runtime/wasmbridge.js"),ctx,{filename:"wasmbridge.js"});
    assert.strictEqual(ctx.WasmBridgeCompat.detect().fetch,withFetch);
    var wasm=await ctx.WasmBridge.load({wasm:"add.wasm",fallback:{add:(a,b)=>a+b},exports:["add"]});
    assert.strictEqual(wasm.backend,"wasm");
    assert.strictEqual(wasm.add(20,22),42);
    assert.strictEqual(hits,1);
    ctx.WebAssembly=undefined;
    var fallback=await ctx.WasmBridge.load({wasm:"add.wasm",fallback:{add:(a,b)=>a+b},exports:["add"]});
    assert.strictEqual(fallback.backend,"javascript");
    assert.strictEqual(fallback.add(20,22),42);
    return "PASS: "+(withFetch?"fetch":"XHR ponyfill")+" loads Wasm and WebAssembly-disabled JS fallback works.";
}
(async()=>{console.log(await test(true));console.log(await test(false));})()
.catch(e=>{console.error(e);process.exitCode=1;});
