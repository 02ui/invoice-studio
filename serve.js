// Local server for the invoice app.
// Serves public/ as static files AND handles a tiny save/load API so the
// app data is written to data.json (right here in the project folder),
// so your data lives in a plain file you can back up or sync any way you like.
//
//   http://localhost:4242  → opens the app
//   GET  /api/load         → returns data.json (or null if none yet)
//   POST /api/save         → writes the posted JSON to data.json

const http = require("http");
const fs   = require("fs");
const path = require("path");

const ROOT      = path.join(__dirname, "public");   // static files
const DATA_FILE = path.join(__dirname, "data.json"); // your invoice data
const PORT      = 4242;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
};

http.createServer((req, res) => {
  // Allow the app to call the API even if opened as a local file (file://)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── API: load data ──────────────────────────────────────────────
  if (req.method === "GET" && req.url.split("?")[0] === "/api/load") {
    fs.readFile(DATA_FILE, "utf8", (err, data) => {
      if (err) {
        // No data file yet — return null so the app falls back to localStorage
        res.writeHead(200, { "content-type": "application/json" });
        res.end("null");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(data);
    });
    return;
  }

  // ── API: save data ──────────────────────────────────────────────
  if (req.method === "POST" && req.url.split("?")[0] === "/api/save") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        JSON.parse(body); // validate before writing
        fs.writeFile(DATA_FILE, body, err => {
          if (err) { res.writeHead(500); res.end("Write error"); return; }
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
        });
      } catch (e) {
        res.writeHead(400); res.end("Bad JSON");
      }
    });
    return;
  }

  // ── Static files ────────────────────────────────────────────────
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });

}).listen(PORT, "127.0.0.1", () => {
  console.log("Invoice app → http://localhost:" + PORT);
});
