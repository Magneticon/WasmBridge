# WasmBridge Programmer's Guide

This guide is the end-to-end programming reference for WasmBridge 0.7. It explains how to turn portable native code into WebAssembly, define a browser-safe ABI, load the result from JavaScript, package it with a JavaScript fallback, validate it for the Firefox 52.9 ESR compatibility target, and test it on Windows XP.

For a concise function-by-function browser API summary, also see `API_REFERENCE.md`. For legacy-browser constraints, see `FF52_COMPATIBILITY.md`. For the standard XP test endpoint, see `XP_FIREFOX_TEST_ENDPOINT.md`.

---

## 1. What WasmBridge is

WasmBridge is a small WebAssembly compilation, packaging, and browser-runtime framework designed around one unusually strict baseline:

- browser: Firefox 52.9 ESR,
- operating system: Windows XP x64,
- browser process: normally 32-bit,
- JavaScript distribution style: classic scripts,
- WebAssembly compatibility goal: MVP-oriented output,
- fallback: matching JavaScript implementation,
- build host: Windows 10 development workstation,
- Windows binaries: XP-targeted .NET Framework 4.0 and `v141_xp`.

WasmBridge does not embed Clang, Emscripten, WABT, Binaryen, esbuild, Node.js, or a managed-language runtime. Those are build-host tools. Windows XP only needs the browser and the application assets being served.

WasmBridge is best thought of as four layers:

```text
source code
   |
   +-- C -----------------------> clang/wasm-ld --------+
   |                                                  |
   +-- C / C++ ----------------> Emscripten ----------+--> module.wasm
   |                                                  |
   +-- existing .wasm --------------------------------+
                                                      |
                                                      v
                                      validate / optimize / package
                                                      |
                         +----------------------------+-------------------+
                         |                                                |
                         v                                                v
                   native WebAssembly                              JS fallback
                         |                                                |
                         +---------------- WasmBridge --------------------+
                                              |
                                              v
                                   Firefox 52 / modern browser
```

WasmBridge intentionally keeps the browser ABI simple. The most portable interface is a flat C-style API built from numeric parameters, exported linear memory, and explicit pointer/length pairs.

---

## 2. What WasmBridge does not do

WasmBridge is not a universal source-language transpiler.

It does **not** directly compile arbitrary JavaScript into WebAssembly. JavaScript normally remains the browser/UI layer or becomes the fallback implementation.

It does **not** directly compile C# into WebAssembly. The current project contains no C#-to-Wasm compiler and no .NET runtime for the browser. Existing C# logic must either be ported to a supported portable native core or compiled by an external toolchain whose resulting `.wasm` is then treated as third-party Wasm and validated against the same WasmBridge ABI and Firefox 52 rules.

It does **not** make DOM APIs, Win32 APIs, COM, .NET Framework APIs, CUDA APIs, filesystem calls, sockets, or arbitrary operating-system functions magically available inside a browser module. Browser WebAssembly code can only use what the module itself contains plus imports explicitly supplied by JavaScript.

It does **not** guarantee Firefox 52 compatibility merely because compilation succeeded. Release compatibility requires restricted validation and real execution in the target browser.

---

## 3. Recommended project split

For an existing application, do not try to move the whole program into WebAssembly first. Split it into two parts.

### Browser / host layer

Keep these in JavaScript:

- DOM access,
- buttons, menus, forms, canvases,
- browser events,
- network requests,
- timers,
- storage APIs,
- integration with the surrounding web application,
- WasmBridge loading and error handling.

### Portable compute/library layer

Move these into C or C++ when useful:

- image processing,
- binary parsing,
- compression/decompression,
- mathematics,
- codecs,
- simulation,
- search/index algorithms,
- reusable data transforms,
- pure business rules without browser dependencies.

This separation produces small Wasm modules with a stable ABI and makes a JavaScript fallback practical.

---

## 4. Choosing a build route

WasmBridge currently provides two supported source compilation routes.

### Route A: freestanding C through Clang

Use the `build` command for small, portable C modules with few or no runtime dependencies.

```cmd
bin\Release\WXP\x64\WasmBridge.exe build ^
  --source Core\math.c ^
  --out Examples\HelloWorld\add.wasm ^
  --export add
```

The compiler wrapper requests approximately this model:

```text
--target=wasm32
-O2
-nostdlib
--no-entry
--export-memory
--export=<name>
--strip-all
```

Use this route when the source can operate without libc, filesystem support, exceptions, runtime initialization, or complex language support.

The built-in `build` path is intentionally simple and currently accepts one source file. It is the easiest route for tiny kernels and examples.

### Route B: standalone Emscripten for C/C++

Use `build-emscripten` for multi-file C or C++ code, include directories, preprocessor definitions, or code that benefits from Emscripten's compiler driver.

Single source:

```cmd
bin\Release\WXP\x64\WasmBridge.exe build-emscripten ^
  --source library.c ^
  --out library.wasm ^
  --emcc C:\path\to\emcc.bat ^
  --export function1,function2
```

Multiple C/C++ files:

```cmd
bin\Release\WXP\x64\WasmBridge.exe build-emscripten ^
  --sources src\math.cpp;src\filters.cpp;src\api.c ^
  --out build\library.wasm ^
  --emcc C:\path\to\emcc.bat ^
  --export add,process_frame,get_version ^
  --include include;thirdparty\include ^
  --define WASMBRIDGE_BUILD;FEATURE_X=1
```

The Emscripten backend requests standalone Wasm and no generated JS glue:

```text
-O2
--no-entry
-s STANDALONE_WASM=1
-s FILESYSTEM=0
-s ERROR_ON_UNDEFINED_SYMBOLS=1
-s EXPORTED_FUNCTIONS=[...]
-mno-bulk-memory
-mno-sign-ext
-mno-nontrapping-fptoint
```

Compilation flags are not a compatibility proof. Run `validate-legacy` and the target Firefox tests afterward.

---

## 5. Designing the WebAssembly ABI

The ABI is the most important design decision in a WasmBridge module.

### 5.1 Export simple C-style entry points

Prefer names such as:

```c
int add(int a, int b);
int process(unsigned char *input, unsigned char *output, int bytes);
int get_version(void);
```

Avoid exposing C++ classes, vtables, references, exceptions, templates, STL containers, or compiler-specific mangled symbols as the public browser boundary.

For C++, expose a C ABI wrapper:

```cpp
#include <stdint.h>

class Calculator {
public:
    static int add(int a, int b) { return a + b; }
};

extern "C" {
    int wb_add(int a, int b)
    {
        return Calculator::add(a, b);
    }
}
```

Then export `wb_add`.

### 5.2 Scalar types

The general `WasmBridgeModule` signature layer supports:

- `i32`,
- `f32`,
- `f64`,
- `void` as a result.

Example `signatures.json`:

```json
{
  "add": {"parameters": ["i32", "i32"], "result": "i32"},
  "scale": {"parameters": ["f64", "f64"], "result": "f64"},
  "reset": {"parameters": [], "result": "void"}
}
```

Do not use `i64` in the Firefox-52-facing general numeric API. If an application needs a 64-bit integer, use a custom representation such as two `i32` values or store the value in linear memory and marshal it explicitly.

### 5.3 Pointers

A pointer inside browser WebAssembly is a byte offset into the module's linear memory.

For example, if C returns pointer value `4096`, JavaScript interprets it as:

```js
new Uint8Array(exports.memory.buffer, 4096, length)
```

Do not confuse a Wasm pointer with a Windows process address. Native DLL pointers and Wasm offsets are different address spaces and are never interchangeable.

### 5.4 Strings

Use UTF-8 in linear memory.

A practical C ABI is:

```c
int parse_name(const char *utf8, int byte_length);
```

or a null-terminated form:

```c
int parse_name(const char *utf8);
```

`WasmBridgeModule` supplies helpers:

- `allocateString(text, nullTerminate)`,
- `writeString(handle, text, nullTerminate, offset)`,
- `readString(handle, maxBytes, offset)`.

Example:

```js
var text = module.allocateString("Hello from XP", true);
try {
    module.call("consume_text", text.pointer);
} finally {
    module.release(text);
}
```

### 5.5 Arrays and binary data

Pass arrays as pointer + count or pointer + byte length.

C:

```c
int sum_i32(const int *values, int count);
```

JavaScript:

```js
var values = new Int32Array([10, 20, 30, 40]);
var h = module.allocate(values.byteLength);
try {
    module.writeTyped(h, "i32", values);
    var result = module.call("sum_i32", h.pointer, values.length);
} finally {
    module.release(h);
}
```

### 5.6 Structures

Do not pass JavaScript objects directly to C/C++.

Choose one of these approaches:

1. flatten fields into scalar parameters,
2. define a fixed binary structure and write it into a buffer,
3. provide setter/getter functions around an opaque handle,
4. serialize to a documented byte format.

For Firefox 52 compatibility and cross-compiler stability, explicit binary formats are usually safer than exposing compiler-dependent C++ object layouts.

### 5.7 Booleans and enums

Represent booleans and enums as `i32` values.

```c
enum Mode { MODE_FAST = 0, MODE_QUALITY = 1 };
int set_mode(int mode);
```

### 5.8 Callbacks and imports

A Wasm module may import JavaScript functions. Supply them through the `imports` option:

```js
WasmBridgeModule.load({
    wasm: "library.wasm",
    fallback: fallbackObject,
    exports: ["run"],
    imports: {
        host: {
            log_value: function (value) {
                console.log(value);
            }
        }
    }
}).then(function (module) {
    module.call("run");
});
```

The import module/name must match the compiled Wasm import table exactly.

For maximum legacy portability, keep imports few and explicit.

---

## 6. Memory ownership model

WasmBridge's high-level general API deliberately copies data rather than returning long-lived typed-array views into Wasm memory.

This matters because `memory.grow()` can replace the backing `ArrayBuffer`. Any previously retained view may become stale.

### 6.1 Recommended allocator exports

A general module with dynamic buffers should expose:

```c
unsigned char *wb_alloc(int bytes);
int wb_free(unsigned char *pointer);
int wb_capacity(unsigned char *pointer);
```

Then configure:

```js
allocator: {
    allocate: "wb_alloc",
    release: "wb_free",
    capacity: "wb_capacity"
}
```

### 6.2 WasmBridge handles

`module.allocate(bytes)` returns an owned JavaScript handle similar to:

```text
{
  pointer: <Wasm byte offset>,
  capacity: <actual allocation capacity>,
  byteLength: <requested length>
}
```

Use the handle only with the module instance that created it.

After:

```js
module.release(handle);
```

the handle is stale and later reads, writes, or releases are rejected by the JS ownership layer.

### 6.3 Buffer helpers

```js
var h = module.allocate(4096);
module.write(h, new Uint8Array([1, 2, 3]));
var copy = module.read(h, 3);
module.release(h);
```

Typed helpers:

```js
module.writeTyped(h, "f32", new Float32Array([1, 2, 3]));
var values = module.readTyped(h, "f32", 3);
```

Supported typed names:

```text
u8   u8c   i8
u16  i16
u32  i32
f32  f64
```

### 6.4 Scoped cleanup

For temporary buffers:

```js
module.withBuffer(4096, function (h) {
    module.write(h, input);
    module.call("process", h.pointer, input.length);
    return module.read(h, input.length);
});
```

If the callback returns a Promise, the handle is released when that Promise settles.

### 6.5 Disposal

Call:

```js
module.dispose();
```

when the module instance is no longer needed.

Disposal releases all remaining owned handles, is idempotent, and prevents later module operations.

---

## 7. Current allocator limits

The checked-in `Core/buffers.c` allocator is deliberately bounded. It is an example/general-purpose small-module allocator, not a replacement for libc `malloc`.

Current important limits are:

- 128 C-side block descriptors,
- 32 MiB C/Wasm allocator address budget,
- 8-byte allocation alignment,
- first-fit reuse,
- adjacent free-block coalescing,
- free-tail reclamation,
- no shrinking of WebAssembly linear memory itself.

`Runtime/module.js` additionally defaults to:

- 128 live JS handles,
- 16 MiB maximum individual buffer,
- 32 MiB maximum linear-memory budget.

The JS-side handle limit can be configured with `maxHandles`. Buffer/memory budgets can be configured with `maxBufferBytes` and `maxMemoryBytes`, but increasing JS limits does not remove hard limits built into a particular C allocator.

For a different application, you may provide your own allocator exports instead of `wb_alloc`/`wb_free` as long as the configured ABI is respected.

---

## 8. Building a simple C module

Source:

```c
/* add.c */
int add(int a, int b)
{
    return a + b;
}
```

Build:

```cmd
WasmBridge.exe build --source add.c --out add.wasm --export add
```

Optional header check:

```cmd
WasmBridge.exe verify --wasm add.wasm
```

`verify` only checks the WebAssembly magic/version header. It does not validate exports, imports, features, or browser compatibility.

Restricted compatibility validation:

```cmd
WasmBridge.exe validate-legacy ^
  --wasm add.wasm ^
  --validator C:\CODEX\TOOLS\WasmBridge\wabt-1.0.42\bin\wasm-validate.exe
```

Browser use:

```html
<script src="Runtime/wasmbridge.js"></script>
<script>
WasmBridge.load({
    wasm: "add.wasm",
    fallback: "add-fallback.js",
    fallbackGlobal: "AddFallback",
    exports: ["add"]
}).then(function (m) {
    console.log(m.add(20, 22));
});
</script>
```

Fallback:

```js
var AddFallback = {
    add: function (a, b) {
        return (a + b) | 0;
    }
};
```

---

## 9. Building a general buffer-oriented module

Consider a C API:

```c
unsigned char *wb_alloc(int bytes);
int wb_free(unsigned char *pointer);
int wb_capacity(unsigned char *pointer);
int transform(unsigned char *input, unsigned char *output, int bytes);
```

Build it and export all required functions:

```cmd
WasmBridge.exe build-emscripten ^
  --source transform.c ^
  --out transform.wasm ^
  --emcc C:\path\to\emcc.bat ^
  --export wb_alloc,wb_free,wb_capacity,transform
```

Load:

```html
<script src="Runtime/wasmbridge.js"></script>
<script src="Runtime/module.js"></script>
<script>
WasmBridgeModule.load({
    wasm: "transform.wasm",
    fallback: TransformFallback,
    exports: ["transform"],
    allocator: {
        allocate: "wb_alloc",
        release: "wb_free",
        capacity: "wb_capacity"
    },
    memoryExport: "memory",
    signatures: {
        transform: {
            parameters: ["i32", "i32", "i32"],
            result: "i32"
        }
    }
}).then(function (module) {
    var input = new Uint8Array([1, 2, 3, 4]);
    var source = module.allocate(input.length);
    var target = module.allocate(input.length);
    try {
        module.write(source, input);
        var written = module.call("transform", source.pointer, target.pointer, input.length);
        var output = module.read(target, written);
        console.log(output);
    } finally {
        module.release(target);
        module.release(source);
        module.dispose();
    }
});
</script>
```

---

## 10. JavaScript fallback strategies

WasmBridge supports three practical fallback styles.

### 10.1 Handwritten fallback object

Best when the algorithm is small and clarity matters.

```js
var MyFallback = {
    add: function (a, b) { return (a + b) | 0; }
};
```

Pass the object directly or load it from a classic script.

### 10.2 Handwritten ABI-compatible memory fallback

For buffer-oriented modules, reproduce the same exported function names and equivalent semantics in JavaScript. `Examples/BufferArena/buffers-fallback.js` demonstrates this model.

### 10.3 Generated fallback candidate

WasmBridge can invoke Binaryen `wasm2js` and then bundle the emitted module through esbuild as a Firefox-52-targeted classic-script IIFE.

```cmd
WasmBridge.exe generate-fallback ^
  --wasm module.wasm ^
  --out module-generated.js ^
  --validator C:\path\to\wasm-validate.exe ^
  --wasm2js C:\path\to\wasm2js.exe ^
  --esbuild C:\path\to\esbuild.exe ^
  --global MyGeneratedFallback
```

This is a **candidate**, not automatic proof of ABI equivalence. Generated fallback output must be tested against the known Wasm behavior before replacing a handwritten fallback.

In particular, verify:

- export names,
- memory behavior,
- allocation semantics,
- pointer interpretation,
- output parity,
- Firefox 52 execution.

---

## 11. Low-level loader reference

Load:

```html
<script src="Runtime/wasmbridge.js"></script>
```

Call:

```js
WasmBridge.load(options)
```

Important options:

```text
wasm            URL of the .wasm file
fallback        fallback object, fallback factory, or fallback script URL
fallbackGlobal  global defined by fallback script
exports         required callable export names
imports         WebAssembly import object
preferWasm      false to deliberately force fallback
validateWasm    callback for custom ABI validation
```

The Promise resolves to an adapter containing:

```text
backend         "wasm" or "javascript"
exports         raw selected backend exports
instance        native Wasm instance when backend is Wasm
 diagnostic     human-readable fallback reason
failurePhase    failure category, or null on successful Wasm load
wasmFailure     structured failure summary
<export name>   convenience wrapper for each declared export
```

Possible Wasm failure phases include:

```text
unavailable
configuration
load
instantiate
exports
abi
disabled
```

A valid JS fallback can still produce a successful module even when the Wasm phase failed.

---

## 12. General `WasmBridgeModule` reference

Load scripts in order:

```html
<script src="Runtime/wasmbridge.js"></script>
<script src="Runtime/module.js"></script>
```

Create:

```js
WasmBridgeModule.load(options)
```

Useful load options in addition to low-level loader options:

```text
allocator.allocate
allocator.release
allocator.capacity
memoryExport
signatures
maxBufferBytes
maxMemoryBytes
maxHandles
growMemory
```

Returned methods:

```text
call(name, ...arguments)
allocate(bytes)
release(handle)
write(handle, bytes, offset)
read(handle, count, offset)
writeTyped(handle, type, array, elementOffset)
readTyped(handle, type, count, elementOffset)
writeString(handle, text, nullTerminate, offset)
readString(handle, maxBytes, offset)
allocateString(text, nullTerminate)
withBuffer(bytes, callback)
dispose()
statistics()
```

Use `call()` only for exports declared in the `exports` array. If a signature is provided, WasmBridge validates argument count, basic numeric type/range, and the returned value.

---

## 13. Specialized adapters

### `WasmBridgeRGBA`

Files:

```text
Runtime/wasmbridge.js
Runtime/rgba.js
```

Purpose: bounded RGBA8 image processing through a module-owned scratch buffer.

Primary method:

```js
processRGBA(pixelArray, width, height)
```

The checked-in adapter supports 1 through 512 pixels per dimension, returns a fresh `Uint8ClampedArray`, and does not expose a borrowed Wasm memory view.

### `WasmBridgeBuffers`

Files:

```text
Runtime/wasmbridge.js
Runtime/buffers.js
```

Purpose: independent dynamic buffer ownership around the `wb_alloc`/`wb_free` style ABI.

Primary methods:

```text
allocate
release
write
read
writeTyped
readTyped
invertRGBA
processRGBA
statistics
```

New modules that are not specifically RGBA-oriented should normally use the more general `WasmBridgeModule` API instead of creating dependencies on the example-specific adapters.

---

## 14. Packaging

WasmBridge packages copy the Wasm module, fallback, runtime layers, and metadata into a self-contained directory.

### 14.1 Basic package (`wasmbridge-package-0.1`)

```cmd
WasmBridge.exe package ^
  --wasm add.wasm ^
  --fallback add.js ^
  --runtime Runtime\wasmbridge.js ^
  --out dist\add ^
  --export add ^
  --fallback-global AddFallback
```

### 14.2 General package (`wasmbridge-package-0.2`)

```cmd
WasmBridge.exe package ^
  --wasm buffers.wasm ^
  --fallback buffers-fallback.js ^
  --runtime Runtime\wasmbridge.js ^
  --module-runtime Runtime\module.js ^
  --out dist\buffers ^
  --export wb_active_count,wb_invert_rgba ^
  --allocator wb_alloc,wb_free,wb_capacity ^
  --memory-export memory ^
  --fallback-global WasmBridgeBuffersFallback ^
  --signatures signatures.json
```

Supplying `--module-runtime` selects package format 0.2.

The manifest records SHA-256 hashes for copied artifacts. These hashes detect accidental modification; they are not a digital signature and do not make an untrusted package trustworthy.

Verify before deployment:

```cmd
WasmBridge.exe verify-package --manifest dist\buffers\manifest.json
```

The verifier checks:

- known package format,
- required artifacts,
- package-directory containment,
- recorded hashes,
- nonempty/unique exports,
- signature metadata,
- allocator metadata,
- Wasm magic/version header,
- absence of unexpected files.

---

## 15. Manifest-driven loading

Load:

```html
<script src="Runtime/package.js"></script>
```

Then:

```js
WasmBridgePackage.load({
    manifest: "dist/buffers/manifest.json"
}).then(function (module) {
    console.log(module.backend);
});
```

`package.js` resolves runtime and data assets relative to the manifest and delegates to the correct runtime API for package format 0.1 or 0.2.

Package loader failures use phases such as:

```text
configuration
manifest
scripts
package
```

Backend failures inside the loaded module still use the low-level Wasm failure phases.

---

## 16. Validation pipeline

A release build should pass several different validation levels because each catches a different class of failure.

### Level 1: magic/version header

```cmd
WasmBridge.exe verify --wasm module.wasm
```

This only answers: "Does the file start like a WebAssembly MVP module?"

### Level 2: restricted WABT validation

```cmd
WasmBridge.exe validate-legacy --wasm module.wasm --validator C:\path\to\wasm-validate.exe
```

The current validator gate disables feature families including:

- mutable globals,
- saturating float-to-int,
- sign-extension instructions,
- SIMD,
- multi-value,
- bulk memory,
- reference types,
- tail calls,
- exceptions,
- memory64,
- multi-memory,
- extended const expressions.

An unknown WABT compatibility flag is treated as an error rather than silently weakening the gate.

### Level 3: optional optimization

```cmd
WasmBridge.exe optimize-legacy ^
  --wasm module.wasm ^
  --out module-optimized.wasm ^
  --optimizer C:\path\to\wasm-opt.exe ^
  --validator C:\path\to\wasm-validate.exe
```

The output is revalidated after `wasm-opt -O2 --mvp-features`.

### Level 4: Node host regressions

From the repository root:

```cmd
node Tests\test_wasm_binary_node.js
```

The direct binary test bypasses WasmBridge wrappers and checks shipped `.wasm` binaries directly.

Other `test_*_node.js` files exercise loader, memory, package, fallback, and adapter behavior.

### Level 5: Firefox 52 target execution

On the Windows 10 host:

```cmd
node Tools\Serve-Examples.js 8084 192.168.255.2
```

On Windows XP / Firefox 52.9 ESR:

```text
http://192.168.255.2:8084/Examples/WasmSelfTest/index.html
```

The XP system does not need Node.js or compiler tools.

### Level 6: full matrix

On the build host:

```powershell
powershell -ExecutionPolicy Bypass -File Tools\Test-All.ps1
```

This is the intended complete validation path when the configured development dependencies and Firefox test installation are available.

---

## 17. Firefox 52 JavaScript rules

The legacy runtime is deliberately written as classic script.

Do not require these features in code that must execute on the baseline browser:

- ES modules,
- `import` / `export`,
- dynamic `import()`,
- `async` / `await`,
- optional chaining,
- nullish coalescing,
- BigInt,
- modern-only browser APIs without a fallback,
- module-only bundler output.

Use Promises and classic `<script>` loading patterns already used by the WasmBridge runtime.

`Runtime/legacy-compat.js` is an optional compatibility helper. It can provide an XHR byte-loading path when `fetch` is absent; it does not replace or emulate a WebAssembly engine.

---

## 18. Porting an existing JavaScript application

WasmBridge does not compile the JavaScript language into Wasm. Instead:

1. identify CPU-heavy, pure, deterministic JS functions,
2. define a flat ABI,
3. rewrite that small core in C/C++,
4. compile it to Wasm,
5. keep DOM/UI/network code in JavaScript,
6. keep the original JS algorithm as the fallback where practical,
7. compare Wasm and fallback outputs in tests.

Example original JS:

```js
function invert(bytes) {
    var out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; ++i)
        out[i] = 255 - bytes[i];
    return out;
}
```

Portable core:

```c
int invert(const unsigned char *src, unsigned char *dst, int bytes)
{
    int i;
    if (!src || !dst || bytes < 0) return -1;
    for (i = 0; i < bytes; ++i) dst[i] = (unsigned char)(255 - src[i]);
    return bytes;
}
```

Then call the C function through two allocated buffers while retaining the original JS as fallback/reference.

Do **not** move browser interactions such as `document.getElementById`, canvas acquisition, or HTTP requests into the Wasm core. Keep those in JavaScript and pass plain data into the module.

---

## 19. Porting C

C is the most direct source language for WasmBridge.

Good candidates:

- code using integer/floating-point arithmetic,
- fixed-width types from `<stdint.h>`,
- caller-supplied buffers,
- pure functions,
- explicit error codes.

Refactoring checklist:

1. remove Win32-specific calls from the portable module,
2. replace file/network/UI operations with host-provided data or imports,
3. expose explicit C functions,
4. avoid hidden global initialization where possible,
5. define pointer ownership,
6. export memory if JavaScript must exchange buffers,
7. test every exported entry point with invalid sizes as well as valid input.

For a freestanding module, avoid relying on libc unless the selected toolchain/runtime supplies it.

---

## 20. Porting C++

Use `build-emscripten` and keep the browser ABI C-shaped.

Internally, the implementation may use classes and templates, but put `extern "C"` wrappers around exported entry points.

Example:

```cpp
#include <stdint.h>
#include <vector>

namespace engine {
class Filter {
public:
    static int clamp(int value, int low, int high) {
        if (value < low) return low;
        if (value > high) return high;
        return value;
    }
};
}

extern "C" int wb_clamp(int value, int low, int high)
{
    return engine::Filter::clamp(value, low, high);
}
```

Export `wb_clamp`, not a mangled class method.

For the legacy browser target, treat advanced runtime-heavy features conservatively. Code that introduces unsupported imports, filesystem/runtime dependencies, threads, exceptions, or newer Wasm feature requirements may compile yet fail the WasmBridge legacy gates. Validate the final binary, not just the source assumptions.

---

## 21. Porting C#

WasmBridge 0.7 does not include a C# compiler backend or a browser .NET runtime.

There are two realistic migration strategies.

### Strategy A: extract and port the portable core

This is the recommended route for the Firefox 52 / XP target.

Original C#:

```csharp
public static int Clamp(int value, int low, int high)
{
    if (value < low) return low;
    if (value > high) return high;
    return value;
}
```

Portable C equivalent:

```c
int wb_clamp(int value, int low, int high)
{
    if (value < low) return low;
    if (value > high) return high;
    return value;
}
```

Compile/export `wb_clamp` and call it through WasmBridge.

For larger C# libraries, first isolate code that does not depend on:

- WinForms/WPF,
- COM,
- P/Invoke,
- .NET filesystem APIs,
- sockets,
- threads,
- reflection,
- dynamic code generation,
- large managed object graphs.

Port only the algorithmic core. Keep the application host in its original environment or reimplement the browser-side host in JavaScript.

### Strategy B: external C#-to-Wasm compiler

If an external compiler can produce a standalone browser `.wasm`, WasmBridge can treat that file like any other third-party Wasm module, but this route is **not provided or certified by WasmBridge**.

The output would need to satisfy all of these conditions:

1. load in Firefox 52.9 ESR,
2. avoid unsupported post-MVP features,
3. use imports that your JavaScript host can provide,
4. expose a flat callable ABI compatible with WasmBridge,
5. expose memory if buffers/strings need marshaling,
6. avoid requiring unsupported JavaScript syntax/glue,
7. pass `validate-legacy`,
8. pass direct target-browser execution tests.

A full managed runtime, GC, metadata system, and framework library is outside WasmBridge's current scope. Do not assume that a modern managed-Wasm output can be dropped into the Firefox 52 path merely because it is a `.wasm` file.

For `long`/`ulong`, complex objects, strings, arrays, delegates, exceptions, and generics, define an explicit WasmBridge-facing ABI instead of trying to expose CLR semantics directly.

---

## 22. Using an existing `.wasm`

If another compiler already produced WebAssembly, WasmBridge does not require recompilation.

Use this checklist:

1. `WasmBridge.exe verify --wasm module.wasm`
2. inspect/know the exported functions and required imports,
3. `validate-legacy` against the pinned WABT tool,
4. write or adapt a JS fallback,
5. declare only the exports you need,
6. configure allocator/memory names if using `WasmBridgeModule`,
7. package it,
8. run the direct native Wasm self-test or a module-specific acceptance page in Firefox 52.

If the module imports WASI, browser filesystem services, threads, modern memory features, or runtime-specific host functions, WasmBridge will not invent those imports; provide them explicitly or rebuild the module for the browser environment.

---

## 23. Error handling conventions

For C/C++ entry points, prefer explicit integer status codes instead of throwing across the Wasm boundary.

Example:

```c
#define WB_OK 0
#define WB_ERR_ARGUMENT -1
#define WB_ERR_BUFFER -2

int wb_process(unsigned char *p, int bytes)
{
    if (!p || bytes <= 0) return WB_ERR_ARGUMENT;
    /* ... */
    return WB_OK;
}
```

JavaScript:

```js
var rc = module.call("wb_process", h.pointer, h.byteLength);
if (rc !== 0)
    throw new Error("wb_process failed: " + rc);
```

This is predictable in both Wasm and JavaScript fallback backends.

---

## 24. Performance guidance

WasmBridge deliberately copies data for safety and ownership clarity. For tiny operations, marshaling overhead may be larger than the compute time.

Wasm is most useful when:

- the workload per call is substantial,
- buffers are reasonably large,
- algorithms are compute-heavy,
- the same buffer can be processed with few boundary crossings.

Prefer:

```text
one call processing 1 MiB
```

over:

```text
one million calls processing 1 byte each
```

Measure end-to-end time including allocation and copying. The BufferArena examples intentionally distinguish browser end-to-end timings from native DLL timings.

---

## 25. Security and trust

Treat all of these as executable code:

- `.wasm` modules,
- fallback scripts,
- runtime scripts,
- package manifests that select scripts,
- imported host functions.

Only load trusted assets.

Package SHA-256 fields detect changed files but are not publisher signatures. `verify-package` is an integrity/structure check, not an authenticity system.

Do not expose the development HTTP server to the public Internet. The documented `192.168.255.2:8084` binding is intended for the trusted local XP test network.

---

## 26. Troubleshooting

### Wasm falls back immediately

Inspect:

```js
module.failurePhase
module.diagnostic
module.wasmFailure
```

Typical causes:

```text
load           .wasm URL unavailable / CORS / HTTP problem
instantiate    invalid or unsupported binary/imports
exports        declared function missing
abi            validateWasm rejected memory/export contract
unavailable    no usable WebAssembly engine
disabled       preferWasm was set to false
configuration  invalid loader configuration
```

### Module compiles but Firefox 52 rejects it

Run `validate-legacy`, inspect compiler-generated imports/features, and reduce the module to a smaller fixture. Compilation on a modern toolchain is not proof of MVP compatibility.

### A pointer becomes invalid after memory growth

Do not retain direct typed-array views into `memory.buffer`. Store Wasm offsets/handles and reacquire any view after growth. Prefer WasmBridge copy APIs.

### C++ export is missing

Expose an `extern "C"` wrapper and export that simple symbol.

### `i64` API causes trouble

Redesign the browser-facing ABI around `i32`, two 32-bit halves, or memory serialization.

### Package verification fails after editing files

Recreate the package so manifest hashes match the deployed artifacts. Do not edit generated package contents without regenerating metadata.

### XP cannot reach the test server

Start:

```cmd
node Tools\Serve-Examples.js 8084 192.168.255.2
```

and verify Windows Firewall permits inbound TCP 8084 on the development host's trusted network profile.

---

## 27. Recommended end-to-end workflow

For a new module:

```text
1. Identify portable compute code.
2. Define flat C-style exports.
3. Define memory ownership and pointer/length rules.
4. Implement C/C++ source.
5. Implement or retain a matching JS fallback.
6. Build .wasm with `build` or `build-emscripten`.
7. Run `verify`.
8. Run `validate-legacy`.
9. Optionally run `optimize-legacy`.
10. Run Node direct-Wasm and parity tests.
11. Load through WasmBridge in a browser test page.
12. Test forced JS fallback.
13. Test native Wasm in Firefox 52 on XP.
14. Package with `package`.
15. Run `verify-package`.
16. Run the complete release matrix before shipping.
```

For an existing application, add an earlier step: isolate browser/OS-dependent code from the portable core before attempting conversion.

---

## 28. Command quick reference

### Freestanding C

```cmd
WasmBridge.exe build --source file.c --out file.wasm --export name1,name2 [--clang path] [--timeout ms]
```

### Emscripten C/C++

```cmd
WasmBridge.exe build-emscripten --source file.c --out file.wasm --export name1,name2 [--emcc path]
WasmBridge.exe build-emscripten --sources a.c;b.cpp --out file.wasm --export name1,name2 [--include dir1;dir2] [--define X;Y=1]
```

### Header check

```cmd
WasmBridge.exe verify --wasm file.wasm
```

### Restricted legacy validation

```cmd
WasmBridge.exe validate-legacy --wasm file.wasm --validator path\wasm-validate.exe
```

### Legacy optimization

```cmd
WasmBridge.exe optimize-legacy --wasm in.wasm --out out.wasm --optimizer path\wasm-opt.exe --validator path\wasm-validate.exe
```

### Generate JS fallback candidate

```cmd
WasmBridge.exe generate-fallback --wasm file.wasm --out fallback.js --validator path\wasm-validate.exe --wasm2js path\wasm2js.exe --esbuild path\esbuild.exe [--global Name]
```

### Package

```cmd
WasmBridge.exe package --wasm file.wasm --fallback fallback.js --runtime Runtime\wasmbridge.js --out dist --export name1,name2
```

General package options:

```text
--module-runtime Runtime\module.js
--adapter Runtime\some-adapter.js
--allocator alloc,free,capacity
--memory-export memory
--fallback-global SomeGlobal
--signatures signatures.json
```

### Verify package

```cmd
WasmBridge.exe verify-package --manifest dist\manifest.json
```

---

## 29. Browser API quick reference

### Low level

```js
WasmBridge.load(options) -> Promise<processor>
```

### General module

```js
WasmBridgeModule.load(options) -> Promise<module>
```

### Package

```js
WasmBridgePackage.load({manifest: "..."}) -> Promise<module>
```

### Image-specific adapter

```js
WasmBridgeRGBA.load(options) -> Promise<rgba>
```

### Buffer-specific adapter

```js
WasmBridgeBuffers.load(options) -> Promise<buffers>
```

---

## 30. Reference examples in this repository

Study these in increasing order of complexity:

```text
Examples/HelloWorld/
    simplest scalar function export

Examples/EmscriptenHelloWorld/
    standalone Emscripten-produced Wasm

Examples/ImageProcessing/
    exported memory + fixed scratch buffer

Examples/BufferArena/
    allocator, independent buffers, growth, JS parity

Examples/GeneralModule/
    general module API, strings, typed copies, multiple instances

Examples/PackageLoader/
    manifest-driven deployment

Examples/WasmSelfTest/
    direct native Wasm acceptance without WasmBridge wrappers/fallbacks
```

The matching tests under `Tests/` are executable documentation for ownership, failure behavior, and expected ABI semantics.

---

## 31. Design rules worth keeping

If a future WasmBridge module follows these rules, it is much easier to support on both Firefox 52 and modern browsers:

1. keep the exported ABI small,
2. prefer C-compatible symbols,
3. pass large data through memory rather than huge argument lists,
4. use pointer + length,
5. make ownership explicit,
6. never keep stale JS views across memory growth,
7. use UTF-8 for strings,
8. use explicit status codes,
9. avoid `i64` in the legacy JS boundary,
10. keep browser APIs in JavaScript,
11. keep fallbacks behaviorally equivalent,
12. validate the actual final binary,
13. test the actual target browser,
14. package only trusted artifacts,
15. treat a successful modern-browser test as useful but not sufficient evidence for Firefox 52.

That model is the intended programming contract of WasmBridge 0.7.
