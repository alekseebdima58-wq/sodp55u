// эксперимент: rapid.mjs несколько раз на двух сборках
import { spawn } from "node:child_process";
import { serve } from "./serve.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const run = (url) => new Promise((ok) => { let out = ""; const c = spawn("node", ["tests/rapid.mjs", url], { env: process.env }); c.stdout.on("data", (d) => (out += d)); c.on("exit", () => ok(out)); });
const srv = [];
for (const [dir, port] of [["expA", 8780], ["expB", 8781]]) srv.push(await serve(port, join(HERE, "..", dir)));
for (let k = 0; k < 4; k++) for (const [name, port] of [["v2.1.0", 8780], ["v2.1.1", 8781]]) {
  const out = await run(`http://localhost:${port}/`);
  console.log(`${name} попытка ${k + 1}: ✓${(out.match(/✓/g) || []).length} ✗${(out.match(/✗/g) || []).length}`, out.split("\n").filter((l) => l.includes("✗")).join(" | "));
}
for (const s of srv) s.close();
