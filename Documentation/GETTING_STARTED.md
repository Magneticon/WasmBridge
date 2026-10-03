# WasmBridge 0.8 getting started

## 1. Build host

Use Windows 10 with Visual Studio 2022, the `v141_xp` toolset and Windows 7.1A SDK. Managed projects target .NET Framework 4.0. LLVM/Emscripten/WABT/Binaryen are build-host tools only; they are not XP runtime dependencies.

Check native build prerequisites:

```powershell
powershell -ExecutionPolicy Bypass -File Tools\Check-Environment.ps1
```

Require the Wasm compiler toolchain as well:

```powershell
powershell -ExecutionPolicy Bypass -File Tools\Check-Environment.ps1 -RequireWasmToolchain
```

Build XP binaries:

```powershell
Tools\Build-Host.ps1 -Architecture x86
Tools\Build-Host.ps1 -Architecture x64
```

## 2. Compile C to wasm32

Firefox 52 is a wasm32 target:

```text
bin\Release\WXP\x64\WasmBridge.exe build --source Core\math.c --out Examples\HelloWorld\add.wasm --export add --address-bits 32
```

The default is `--address-bits 32`.

## 3. Compile for memory64

For a modern engine/toolchain that supports memory64:

```text
WasmBridge.exe build --source Core\buffers.c --out buffers64.wasm --address-bits 64 --export wb_alloc,wb_free,wb_capacity,wb_active_count,wb_invert_rgba,wb_address_bits
```

Memory64 is not compatible with Firefox 52 and will fail `validate-legacy` by design.

## 4. Emscripten

```text
WasmBridge.exe build-emscripten --source library.cpp --out library.wasm --emcc C:\path\to\emcc.bat --export function1,function2
```

Add `--address-bits 64` to request Emscripten `MEMORY64=1` output for modern engines.

## 5. Validate Firefox 52 output

```text
WasmBridge.exe validate-legacy --wasm module.wasm --validator C:\path\to\wasm-validate.exe
```

This checks a restricted MVP-oriented feature profile. It does not replace real Firefox 52 execution.

## 6. General JavaScript API

```html
<script src="Runtime/wasmbridge.js"></script>
<script src="Runtime/module.js"></script>
```

```js
WasmBridgeModule.load({
    wasm: "buffers.wasm",
    fallback: WasmBridgeBuffersFallback,
    exports: ["wb_active_count", "wb_invert_rgba"],
    allocator: { allocate: "wb_alloc", release: "wb_free", capacity: "wb_capacity" }
}).then(function (module) {
    var handle = module.allocate(1024 * 1024);
    try { module.write(handle, new Uint8Array([1, 2, 3, 4])); }
    finally { module.release(handle); }
});
```

There is no default WasmBridge memory quota. Optional `maxBufferBytes`, `maxMemoryBytes` and `maxHandles` may be supplied by applications that want explicit resource policy.

## 7. Packages

```text
WasmBridge.exe package --wasm buffers.wasm --fallback buffers-fallback.js --runtime Runtime\wasmbridge.js --module-runtime Runtime\module.js --out dist\buffers --export wb_active_count,wb_invert_rgba --allocator wb_alloc,wb_free,wb_capacity --memory-export memory --fallback-global WasmBridgeBuffersFallback
```

The package loader loads an optional packaged `adapter.js` artifact rather than merely recording it in the manifest.

## 8. Test on XP Firefox 52

On the Windows 10 host:

```text
node Tools\Serve-Examples.js 8084 192.168.255.2
```

On XP:

```text
http://192.168.255.2:8084/Examples/WasmSelfTest/index.html
```

Expected title: `PASS - WasmBridge native WASM self-test`. The page directly tests growth past 32 MiB and more than 128 simultaneous allocations. Node is not required on XP.

## 9. Complete validation

```powershell
powershell -ExecutionPolicy Bypass -File Tools\Test-All.ps1
```

Node host tests include an optional memory64 regression. If the installed Node engine does not expose memory64, that test reports `SKIP`; memory64 is not a Firefox 52 release requirement.
