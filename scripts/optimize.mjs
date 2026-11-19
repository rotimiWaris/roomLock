import { readdir, mkdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const raw = resolve(root, "assets/raw");
const out = resolve(root, "public/models");
await mkdir(out, { recursive: true });
const sizes = [];
for (const name of (await readdir(raw)).filter((x) => x.endsWith(".glb"))) {
  const input = resolve(raw, name),
    output = resolve(out, name);
  const before = await stat(input);
  let existing;
  try {
    existing = await stat(output);
  } catch {}
  if (!existing || existing.mtimeMs < before.mtimeMs) {
    await new Promise((ok, fail) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          pathToFileURL(resolve(root, "scripts/limit-image-memory.mjs")).href,
          resolve(root, "node_modules/@gltf-transform/cli/bin/cli.js"),
          "optimize",
          input,
          output,
          "--texture-size",
          "1024",
          "--texture-compress",
          "webp",
          "--compress",
          "meshopt",
          "--simplify",
          "false",
        ],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            UV_THREADPOOL_SIZE: "1",
            VIPS_CONCURRENCY: "1",
          },
        },
      );
      child.on("error", fail);
      child.on("exit", (code) =>
        code === 0 ? ok() : fail(new Error(`Optimization failed: ${name}`)),
      );
    });
  }
  const after = await stat(output);
  sizes.push({
    file: name,
    beforeBytes: before.size,
    afterBytes: after.size,
    reductionPercent: Number((100 * (1 - after.size / before.size)).toFixed(1)),
    under3MB: after.size < 3000000,
  });
}
await writeFile(
  resolve(root, "assets/model-sizes.json"),
  JSON.stringify(sizes, null, 2),
);
console.table(sizes);
