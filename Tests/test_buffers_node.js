/* Optional development-host regression; actual XP Firefox remains acceptance target. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "Examples/BufferArena/buffers.wasm"));
const ctx = {
    WebAssembly, Promise, ArrayBuffer, Uint8Array, Uint8ClampedArray,
    Math, Object, Number, RangeError, Error, TypeError,
    fetch: async () => ({ok: true, arrayBuffer: async () =>
        wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)})
};
vm.createContext(ctx);
for (const name of ["Runtime/wasmbridge.js", "Runtime/buffers.js",
                    "Examples/BufferArena/buffers-fallback.js"])
    vm.runInContext(fs.readFileSync(path.join(root, name), "utf8"), ctx, {filename:name});
function bytesEqual(a,b) { assert.deepStrictEqual(Array.from(a), Array.from(b)); }
(async () => {
    let opts={wasm:"buffers.wasm", fallback:ctx.WasmBridgeBuffersFallback};
    let native=await ctx.WasmBridgeBuffers.load(opts);
    let fallback=await ctx.WasmBridgeBuffers.load({...opts,preferWasm:false});
    assert.strictEqual(native.backend,"wasm");
    assert.strictEqual(fallback.backend,"javascript");
    let cases=0;
    for(const [w,h] of [[1,1],[2,2],[13,7],[256,160],[512,512],[1024,1024]]) {
        let input=new Uint8ClampedArray(w*h*4);
        for(let i=0;i<input.length;i++)input[i]=(i*37+(i>>>8))&255;
        let wout=native.processRGBA(input,w,h), jout=fallback.processRGBA(input,w,h);
        bytesEqual(wout,jout);
        for(let i=0;i<input.length;i+=4){
            assert.strictEqual(wout[i],255-input[i]);
            assert.strictEqual(wout[i+1],255-input[i+1]);
            assert.strictEqual(wout[i+2],255-input[i+2]);
            assert.strictEqual(wout[i+3],input[i+3]);
        }
        assert.strictEqual(native.statistics().activeBlocks,0);
        assert.strictEqual(fallback.statistics().activeBlocks,0);
        cases++;
    }
    let a=native.allocate(700000), b=native.allocate(1100000), c=native.allocate(1800000);
    assert.notStrictEqual(a.pointer,b.pointer);assert.notStrictEqual(b.pointer,c.pointer);
    assert.strictEqual(native.statistics().activeBlocks,3);
    native.write(a,new Uint8Array([6,7,8,9]));
    let sizeBefore=native.statistics().bytesInLinearMemory;
    let d=native.allocate(5000000);
    assert.ok(native.statistics().bytesInLinearMemory>sizeBefore);
    bytesEqual(native.read(a,4),[6,7,8,9]);
    native.release(b);
    assert.throws(()=>native.read(b),/released/);
    assert.throws(()=>native.release(b),/released/);
    let reused=native.allocate(999999);
    assert.ok(reused.pointer>0);
    assert.throws(()=>native.write(a,new Uint8Array(800000)),RangeError);
    native.release(a);native.release(c);native.release(d);native.release(reused);
    assert.strictEqual(native.statistics().activeBlocks,0);
    let jsA=fallback.allocate(8);
    assert.throws(()=>native.read(jsA),/Unknown/);
    fallback.release(jsA);
    let pixels=new Uint8Array([12,100,200,9]);
    ctx.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer});
    let recovered=await ctx.WasmBridgeBuffers.load({wasm:"broken.wasm",fallback:ctx.WasmBridgeBuffersFallback});
    assert.strictEqual(recovered.backend,"javascript");
    bytesEqual(recovered.processRGBA(pixels,1,1),[243,155,55,9]);
    console.log("PASS: "+cases+" RGBA vectors, Wasm/JS parity, independent buffers, growth, stale handles, bounds, fallback.");
    console.log("Final Wasm memory bytes: "+native.statistics().bytesInLinearMemory);
})().catch(e=>{console.error(e);process.exitCode=1;});
