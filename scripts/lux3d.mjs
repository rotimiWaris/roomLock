import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const key = process.env.AHOLO_API_KEY;
const assets = resolve(root, "assets");
const rawAssets = resolve(assets, "raw");
const all = process.argv.includes("--remaining");
const objects = [
  ["muddy-boot", "a single muddy leather boot"],
  ["cracked-vase", "a cracked porcelain vase"],
  ["torn-letter", "a torn handwritten letter"],
  ["music-box", "an open antique music box, empty"],
  ["pocket-watch", "a brass pocket watch stopped at a time"],
  ["jewelry-box", "a small velvet jewelry box"],
  ["archway-door", "a tall carved stone archway door"],
  ["heirloom", "a glowing antique heirloom necklace on a pedestal"],
];
const idsPath = resolve(assets, "task-ids.json");
const logPath = resolve(assets, "lux3d-status-log.json");
const redact = (value) =>
  JSON.parse(
    JSON.stringify(value, (name, item) => {
      if (/authorization|api[-_]?key|secret/i.test(name)) return "[REDACTED]";
      return typeof item === "string" && key
        ? item.split(key).join("[REDACTED]")
        : item;
    }),
  );
async function readJson(path, fallback) {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function save(path, data) {
  await writeFile(`${path}.part`, JSON.stringify(redact(data), null, 2));
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(`${path}.part`, path);
      break;
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 8)
        throw error;
      await delay(250 * (attempt + 1));
    }
  }
}
let jobs;
let logs;
async function request(path, body, object, operation) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(`https://api.aholo.ai/global/lux3d/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: key,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    logs.push({
      at: new Date().toISOString(),
      object,
      operation,
      error: String(error),
    });
    await save(logPath, logs);
    throw error;
  }
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }
  logs.push({
    at: new Date().toISOString(),
    object,
    operation,
    httpStatus: response.status,
    requestMs: Date.now() - started,
    response: data,
  });
  await save(logPath, logs);
  if (!response.ok || String(data.c) !== "0") {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(redact(data))}`);
  }
  return data;
}
function fields(value, prefix = "") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([name, item]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    return [
      /progress|percent|stage|status|queue|time|created|modified/i.test(name)
        ? path
        : null,
      ...fields(item, path),
    ].filter(Boolean);
  });
}
async function validGlb(path) {
  try {
    const buffer = await readFile(path);
    return (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "glTF" &&
      buffer.readUInt32LE(4) === 2 &&
      buffer.readUInt32LE(8) === buffer.length
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function generate([slug, prompt]) {
  const path = resolve(rawAssets, `${slug}.glb`);
  if (await validGlb(path)) {
    console.log(`${slug}: already downloaded; skipped.`);
    return;
  }
  const history = (jobs[slug] ??= []);
  let job = history.at(-1);
  if (job?.state === "submission-unknown") {
    throw new Error(
      `${slug}: submission outcome unknown. Check the account before another submission to avoid duplicate jobs.`,
    );
  }
  while (true) {
    if (!job || ["failed", "canceled"].includes(job.state)) {
      if (history.length >= 2)
        throw new Error(`${slug}: maximum two attempts reached.`);
      job = {
        prompt,
        startedAt: new Date().toISOString(),
        state: "submission-unknown",
      };
      history.push(job);
      await save(idsPath, jobs);
      const created = await request(
        "generate/text-to-3d/task/create",
        {
          prompt,
          style: "photorealistic",
          version: "G1",
          faceCount: 30000,
          outputFormat: ["zip", "glb"],
        },
        slug,
        "create",
      );
      if (!created.d || !["string", "number"].includes(typeof created.d)) {
        throw new Error(
          "Unexpected task ID response; inspect the saved log before resubmitting.",
        );
      }
      job.taskId = created.d;
      job.state = "running";
      await save(idsPath, jobs);
      console.log(`${slug}: task ${job.taskId} created.`);
    }
    const pollStart = Date.now();
    let lastStatus;
    let failures = 0;
    while (Date.now() - pollStart < 60 * 60 * 1000) {
      let result;
      try {
        result = await request(
          `generate/task/get?taskid=${encodeURIComponent(job.taskId)}`,
          undefined,
          slug,
          "status",
        );
        failures = 0;
      } catch (error) {
        if (++failures >= 3) throw error;
        await delay(5000);
        continue;
      }
      job.observedProgressFields = [
        ...new Set([...(job.observedProgressFields ?? []), ...fields(result)]),
      ];
      const status = result.d?.status;
      job.lastStatus = status;
      await save(idsPath, jobs);
      if (lastStatus !== status) {
        console.log(
          `${slug}: status ${status}; elapsed ${Math.round((Date.now() - Date.parse(job.startedAt)) / 1000)}s.`,
        );
        lastStatus = status;
      }
      if (status === 3) {
        const outputs = result.d.outputs ?? [];
        const url =
          outputs.find((item) => /\.glb(?:\?|$)/i.test(item?.content ?? ""))
            ?.content ?? outputs[1]?.content;
        if (!url || !url.startsWith("https://"))
          throw new Error("No HTTPS GLB output found; inspect saved status.");
        job.state = "downloading";
        await save(idsPath, jobs);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(180000),
        });
        if (!response.ok)
          throw new Error(`GLB download HTTP ${response.status}`);
        await writeFile(
          `${path}.part`,
          Buffer.from(await response.arrayBuffer()),
        );
        if (!(await validGlb(`${path}.part`)))
          throw new Error("Downloaded file is not a complete GLB v2.");
        await rename(`${path}.part`, path);
        job.state = "downloaded";
        job.completedAt = new Date().toISOString();
        job.elapsedSeconds = Math.round(
          (Date.now() - Date.parse(job.startedAt)) / 1000,
        );
        job.bytes = (await stat(path)).size;
        await save(idsPath, jobs);
        console.log(JSON.stringify({ object: slug, ...job }, null, 2));
        return;
      }
      if (status === 4 || status === 6) {
        job.state = status === 4 ? "failed" : "canceled";
        job.error = result;
        job.elapsedSeconds = Math.round(
          (Date.now() - Date.parse(job.startedAt)) / 1000,
        );
        await save(idsPath, jobs);
        console.log(`${slug}: ${job.state}; details saved to status log.`);
        break;
      }
      if (![0, 1].includes(status))
        throw new Error(
          `Unrecognized status ${status}; stopped without creating another task.`,
        );
      await delay(5000);
    }
    if (!["failed", "canceled"].includes(job.state)) {
      throw new Error(
        `${slug}: polling stopped after one hour. Rerun to resume the same task.`,
      );
    }
  }
}
try {
  if (!key)
    throw new Error(
      "AHOLO_API_KEY is not set. Set it in the environment or the local .env file.",
    );
  await mkdir(assets, { recursive: true });
  await mkdir(rawAssets, { recursive: true });
  for (const [slug] of objects) {
    const legacy = resolve(assets, `${slug}.glb`);
    const target = resolve(rawAssets, `${slug}.glb`);
    if (existsSync(legacy) && !existsSync(target)) await rename(legacy, target);
  }
  jobs = await readJson(idsPath, {});
  logs = await readJson(logPath, []);
  if (all && !(await validGlb(resolve(rawAssets, "muddy-boot.glb")))) {
    throw new Error(
      "Complete the single-boot test before generating the remaining objects.",
    );
  }
  for (const object of all ? objects.slice(1) : objects.slice(0, 1))
    await generate(object);
} catch (error) {
  console.error(redact({ error: error.message }).error);
  process.exitCode = 1;
}
