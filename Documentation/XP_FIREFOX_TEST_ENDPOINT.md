# Windows XP Firefox 52 WASM test endpoint

The Windows XP test machine does **not** require Node.js, npm, Python, WABT, Binaryen, Emscripten, Visual Studio, or any other build-host tooling. Those remain on the Windows 10 development host.

For the user's current WasmBridge test network, use the following standard endpoint:

- **Windows 10 host / server address:** `192.168.255.2`
- **HTTP port:** `8084`
- **Windows XP client:** Firefox 52.9 ESR

From the WasmBridge repository root on the Windows 10 host, start the repository test server with:

```cmd
node Tools\Serve-Examples.js 8084 192.168.255.2
```

The server must report:

```text
WasmBridge examples: http://192.168.255.2:8084/
```

Then, from Firefox 52.9 ESR on Windows XP, open the direct native-WASM acceptance test:

```text
http://192.168.255.2:8084/Examples/WasmSelfTest/index.html
```

Other WasmBridge browser examples can be opened under the same base URL, for example:

```text
http://192.168.255.2:8084/Examples/HelloWorld/index.html
http://192.168.255.2:8084/Examples/ImageProcessing/index.html
http://192.168.255.2:8084/Examples/BufferArena/index.html
http://192.168.255.2:8084/Examples/GeneralModule/index.html
http://192.168.255.2:8084/Examples/PackageLoader/index.html
```

`Tools/Serve-Examples.js` retains `127.0.0.1` and port `8765` as its safe defaults when no arguments are supplied. The explicit `192.168.255.2:8084` binding is the standard cross-machine XP test configuration.

If Windows Firewall blocks the connection, allow inbound TCP port 8084 on the Windows 10 host for the appropriate network profile. Do not expose this development server to untrusted networks or the public Internet.
