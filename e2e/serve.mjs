// Minimal static file server with SPA fallback for the Element Call build.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [root, port] = [path.resolve(process.argv[2]), Number(process.argv[3] ?? 8080)];
const types = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".wasm": "application/wasm", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
    ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png",
};
http.createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isDirectory())
        file = path.join(file, "index.html");
    if (!file.startsWith(root) || !fs.existsSync(file)) file = path.join(root, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1");
