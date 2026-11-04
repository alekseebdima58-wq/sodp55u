// Раздаёт приложение для тестов: страница — из папки сборки (по умолчанию из корня репозитория),
// а data/ — из ci/fixture/data: тесты рассчитаны на эти недели (19 окт – 8 ноя 2026), а не на живое расписание.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// In the GitHub branch ci_gate places webapp files at the repository root.
// A local/server unpack keeps them under webapp/. Support both layouts so a
// missing root index cannot turn every browser test into a vague "нет итога".
const DEFAULT_ROOT = existsSync(join(HERE, "..", "index.html")) ? join(HERE, "..") : join(HERE, "..", "webapp");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
  ".mp4": "video/mp4", ".webm": "video/webm", ".jpg": "image/jpeg", ".ico": "image/x-icon" };

export function serve(port = 8772, root = process.env.WEBAPP || DEFAULT_ROOT) {
  const fixture = join(HERE, "fixture");
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const rel = normalize(p).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
      const file = rel.startsWith("data/") ? join(fixture, rel) : join(root, rel);
      const s = await stat(file);
      if (!s.isFile()) throw new Error("not a file");
      const body = await readFile(file);
      // видео — с поддержкой Range, иначе <video> в WebKit не играет
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range) {
        const a = range[1] ? +range[1] : 0, b = range[2] ? +range[2] : body.length - 1;
        res.writeHead(206, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Content-Range": `bytes ${a}-${b}/${body.length}`,
          "Accept-Ranges": "bytes", "Content-Length": b - a + 1, "Cache-Control": "no-store" });
        res.end(body.subarray(a, b + 1)); return;
      }
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok(srv)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await serve(+(process.argv[2] || 8772), process.argv[3]);
  console.log("раздаю на", s.address().port);
}
