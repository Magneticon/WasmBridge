/* Minimal static server for browser acceptance tests.
 * Usage: node Tools\Serve-Examples.js [port] [bind-address]
 * Safe default remains 127.0.0.1. For the XP test machine on the user's LAN,
 * bind the Windows 10 host explicitly to 192.168.255.2:8084.
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] || 8765);
const bindAddress = process.argv[3] || "127.0.0.1";
const types = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".wasm": "application/wasm"
};

if (!Number.isFinite(port) || port < 1 || port > 65535 || Math.floor(port) !== port) {
    throw new RangeError("Port must be an integer from 1 to 65535.");
}
if (!bindAddress || /[\s\/\\]/.test(bindAddress)) {
    throw new Error("Bind address is invalid.");
}

http.createServer((request, response) => {
    const pathname = decodeURIComponent(request.url.split("?")[0]);
    let target = path.resolve(root, "." + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
        response.writeHead(403).end("Forbidden");
        return;
    }
    fs.stat(target, (statError, stat) => {
        if (!statError && stat.isDirectory()) target = path.join(target, "index.html");
        fs.readFile(target, (error, data) => {
            if (error) { response.writeHead(404).end("Not found"); return; }
            response.writeHead(200, {"Content-Type": types[path.extname(target)] || "application/octet-stream"});
            response.end(data);
        });
    });
}).listen(port, bindAddress, () => {
    process.stdout.write("WasmBridge examples: http://" + bindAddress + ":" + port + "/\n");
});
