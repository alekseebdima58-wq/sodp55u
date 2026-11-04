// эксперимент: rapid.mjs несколько раз на двух сборках
import { spawnSync } from "node:child_process";
import { serve } from "./serve.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
for (const [name, dir, port] of [["v2.1.0", "expA", 8780], ["v2.1.1", "expB", 8781], ["v2.1.0", "expA", 8782], ["v2.1.1", "expB", 8783]]) {
  const s = serve(port, join(HERE, "..", dir));
  for (let i = 0; i < 3; i++) {
    const r = spawnSync("node", ["tests/rapid.mjs", `http://localhost:${port}/`], { encoding: "utf8", env: process.env, timeout: 120000 });
    const out = r.stdout || "";
    console.log(`${name} попытка ${i + 1}: ✓${(out.match(/✓/g) || []).length} ✗${(out.match(/✗/g) || []).length}`, out.split("\n").filter((l) => l.includes("✗")).join(" | "));
  }
  s.close && s.close();
}
