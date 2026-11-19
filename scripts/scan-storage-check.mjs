import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { head } from "@vercel/blob";
import { handleScan, signScan } from "../server/scan-service.mjs";

process.loadEnvFile(".env");
const key = process.env.AHOLO_API_KEY;
const secrets = [key, process.env.BLOB_READ_WRITE_TOKEN].filter(Boolean);
async function call(action, body) {
  const req = {
    url: "/api/scan?action=" + action,
    method: "POST",
    headers: { host: "localhost" },
    body,
  };
  const res = {
    statusCode: 0,
    setHeader() {},
    end(value) {
      this.body = JSON.parse(value);
    },
  };
  await handleScan(req, res);
  if (res.statusCode !== 200)
    throw Error(res.body.error ?? `HTTP ${res.statusCode}`);
  return res.body;
}
try {
  await call("config", {});
  const response = await fetch("https://api.aholo.ai/global/world/v1/list", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ pageNum: 0, pageSize: 100 }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error(`World listing HTTP ${response.status}`);
  const raw = await response.json();
  const world = (raw.d ?? raw).result?.find(
    (item) => item.status === "SUCCEEDED",
  );
  if (!world)
    throw Error("No completed room is available for the storage check.");
  const token = signScan({ kind: "world", worldId: world.worldId }, key);
  const status = await call("status", { token });
  console.log(
    JSON.stringify({
      status: status.status,
      progress: status.progress,
      step: "Saving completed room to Blob",
    }),
  );
  const start = Date.now();
  const room = await call("save", { token });
  const saved = await head(room.url);
  const download = await fetch(room.url, {
    headers: { Origin: "http://127.0.0.1:5174" },
    signal: AbortSignal.timeout(180000),
  });
  if (!download.ok) throw Error(`Saved room download HTTP ${download.status}`);
  const bytes = new Uint8Array(await download.arrayBuffer());
  if (!bytes.length || bytes.length !== saved.size)
    throw Error("Saved room byte count does not match Blob metadata");
  const reused = await call("save", { token });
  if (reused.url !== room.url)
    throw Error("Save retry did not reuse the existing room");
  const result = {
    room,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    cors: download.headers.get("access-control-allow-origin"),
    elapsedSeconds: Math.round((Date.now() - start) / 1000),
    retryReused: true,
    newReconstructionSubmitted: false,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/scan-storage-check.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  let message = String(error?.message ?? error);
  for (const secret of secrets)
    message = message.split(secret).join("[REDACTED]");
  console.error(message);
  process.exitCode = 1;
}
