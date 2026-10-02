/* Minimal localhost-only static server for browser acceptance tests. */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] || 8765);
const types = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".wasm": "application/wasm"
};

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
}).listen(port, "127.0.0.1", () => {
    process.stdout.write("WasmBridge examples: http://127.0.0.1:" + port + "/\n");
});
