# Windows XP / Firefox 52 acceptance endpoint

WasmBridge's standard legacy-browser acceptance path uses the Windows 10 development host as a simple HTTP server and Windows XP as the browser-only client.

## Development host

The standard development-host address is `192.168.255.2` and the standard test port is `8084`.

From the WasmBridge repository root on Windows 10:

```text
node Tools\Serve-Examples.js 8084 192.168.255.2
```

The server is for development/testing only. Do not expose it to an untrusted/public network.

If Windows Firewall blocks the connection, allow inbound TCP 8084 on the appropriate development network profile.

## Windows XP client

Open Firefox 52.9 ESR on the XP machine and navigate to:

```text
http://192.168.255.2:8084/Examples/WasmSelfTest/index.html
```

The XP machine requires only the browser. It does **not** need Node.js, npm, Python, LLVM/Clang, Emscripten, WABT, Binaryen, esbuild or Visual Studio.

## Expected WasmBridge 0.8 acceptance result

The native self-test must report PASS for:

- HelloWorld native WebAssembly;
- Emscripten standalone WebAssembly;
- RGBA processing;
- BufferArena wasm32;
- more than 128 simultaneous allocations;
- linear-memory growth beyond the former 32 MiB framework ceiling;
- malformed WebAssembly rejection.

Firefox 52 is a wasm32 target even on Windows XP x64. Browser/OS process width and WebAssembly address width are separate properties.

The October 4, 2026 WasmBridge 0.8 acceptance run on Windows XP x64 / Firefox 52 passed this complete page.
