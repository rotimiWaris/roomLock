import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { put, head, BlobNotFoundError } from "@vercel/blob";
import { handleUpload } from "@vercel/blob/client";
import { createAssetClient } from "@manycore/aholo-sdk-asset";

const base = "https://api.aholo.ai";
const running = ["PENDING", "PREPROCESSING", "RUNNING"];
export async function validateVideo(url, upload, request = fetch) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw Error("Upload a new video first: its public HTTPS URL is missing.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    !/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(parsed.hostname) ||
    parsed.pathname !== "/" + upload.pathname
  )
    throw Error(
      "The video must use the public HTTPS Blob URL for this upload. Please upload it again.",
    );
  const response = await request(parsed.href, {
    method: "HEAD",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const type = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  const size = Number(response.headers.get("content-length"));
  if (
    response.status !== 200 ||
    type !== "video/mp4" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size !== upload.size
  )
    throw Error(
      `The uploaded video is not readable: HTTP ${response.status}, content-type ${type ?? "missing"}, size ${size} bytes. Please upload a new MP4.`,
    );
  return parsed.href;
}
export async function uploadVideoToAholo(url, upload, deps = {}) {
  const request = deps.fetch ?? fetch;
  const source = await validateVideo(url, upload, request);
  const response = await request(source, {
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  if (
    response.status !== 200 ||
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "video/mp4" ||
    !response.body
  )
    throw Error(
      "The uploaded MP4 could not be downloaded for Aholo. Please upload it again.",
    );
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > upload.size || size >= 10000000)
      throw Error("The uploaded video exceeds its expected size.");
    chunks.push(chunk);
  }
  if (size !== upload.size || size === 0)
    throw Error("The uploaded MP4 download is incomplete. Please retry.");
  const asset = (deps.createAssetClient ?? createAssetClient)({
    region: "com",
  });
  const uploaded = await asset.uploadBuffer(Buffer.concat(chunks), {
    filename: "room.mp4",
    signal: AbortSignal.timeout(120000),
    poll: { timeoutMs: 120000 },
  });
  const parsed = new URL(uploaded.url);
  if (parsed.protocol !== "https:" || !parsed.hostname.includes("holo-cos"))
    throw Error(
      "Aholo asset upload did not return a public HTTPS holo-cos URL. Please retry.",
    );
  return uploaded.url;
}
export function signScan(data, key) {
  const body = Buffer.from(
    JSON.stringify({ ...data, expires: Date.now() + 86400000 }),
  ).toString("base64url");
  return (
    body +
    "." +
    createHmac("sha256", key)
      .update("scan:" + body)
      .digest("hex")
  );
}
export function readScan(token, kind, key) {
  if (typeof token !== "string" || token.length > 12000)
    throw Error("Invalid scan token");
  const [body, signature = ""] = token.split(".");
  const expected = createHmac("sha256", key)
    .update("scan:" + body)
    .digest("hex");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw Error("Invalid scan token");
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  if (data.kind !== kind || data.expires < Date.now())
    throw Error("Scan token expired or incorrect");
  return data;
}
export function worldProgress(data) {
  return typeof data.progress === "number" &&
    Number.isFinite(data.progress) &&
    data.progress >= 0 &&
    data.progress <= 1
    ? data.progress
    : null;
}
async function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let text = typeof req.body === "string" ? req.body : "";
  if (!text)
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 16000)
        throw Error("Only small JSON requests are accepted");
    }
  if (text.length > 16000) throw Error("Only small JSON requests are accepted");
  return JSON.parse(text || "{}");
}
const send = (res, code, data) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
};
export async function handleScan(req, res, deps = {}) {
  const key = process.env.AHOLO_API_KEY;
  const request = deps.fetch ?? fetch;
  const store = deps.put ?? put;
  const metadata = deps.head ?? head;
  if (!key || !process.env.BLOB_READ_WRITE_TOKEN)
    return send(res, 503, {
      error:
        "Room scanning needs AHOLO_API_KEY and BLOB_READ_WRITE_TOKEN configured on the server.",
    });
  const upstream = async (path, body) => {
    const r = await request(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: key,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    const text = await r.text();
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw Error(`Aholo HTTP ${r.status}: ${text.slice(0, 1000)}`);
    }
    if (!r.ok || (raw.c !== undefined && String(raw.c) !== "0"))
      throw Error(`Aholo HTTP ${r.status}: ${JSON.stringify(raw)}`);
    return raw.d ?? raw;
  };
  try {
    if (
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      return send(res, 403, { error: "Origin not allowed" });
    const action = new URL(req.url, "http://localhost").searchParams.get(
      "action",
    );
    if (req.method !== "POST")
      return send(res, 405, {
        error:
          "Use POST with JSON metadata. Video uploads go directly to Aholo.",
      });
    const body = await bodyOf(req);
    if (action === "config") return send(res, 200, { ready: true });
    if (action === "blob-upload") {
      const result = await (deps.handleUpload ?? handleUpload)({
        request: req,
        body,
        onBeforeGenerateToken: async (pathname, proof) => {
          const upload = readScan(proof, "blob-upload", key);
          if (pathname !== upload.pathname)
            throw Error("Upload path does not match this scan.");
          return {
            allowedContentTypes: ["video/mp4"],
            maximumSizeInBytes: upload.size,
            validUntil: Math.min(upload.expires, Date.now() + 3600000),
            addRandomSuffix: false,
            allowOverwrite: false,
          };
        },
      });
      return send(res, 200, result);
    }
    if (action === "upload") {
      if (
        !Number.isInteger(body.size) ||
        body.size <= 0 ||
        body.size >= 10000000
      )
        return send(res, 400, { error: "Compress the MP4 below 10 MB first." });
      const scanId = randomUUID();
      const pathname = `videos/${scanId}.mp4`;
      const proof = signScan(
        {
          kind: "blob-upload",
          scanId,
          pathname,
          size: body.size,
        },
        key,
      );
      return send(res, 200, { pathname, proof });
    }
    if (action === "start") {
      const upload = readScan(body.proof, "blob-upload", key);
      const name = "RoomLock " + upload.scanId;
      const listing = await upstream("/global/world/v1/list", {
        pageNum: 0,
        pageSize: 100,
      });
      const previous = listing.result?.find((item) => item.name === name);
      const result = (world) => ({
        worldId: world.worldId,
        token: signScan({ kind: "world", worldId: world.worldId }, key),
        startedAt: world.createTime ?? Date.now(),
      });
      if (
        previous &&
        !running.includes(previous.status) &&
        previous.status !== "SUCCEEDED"
      )
        return send(res, 409, {
          error:
            "Aholo couldn't read this video, try re-filming slowly for 20 to 60 seconds. Choose a new video to upload.",
          newUploadRequired: true,
        });
      if (previous) return send(res, 200, result(previous));
      if (listing.result?.some((item) => running.includes(item.status)))
        return send(res, 409, {
          error: "Another world job is running. Wait, then retry this scan.",
          busy: true,
        });
      const lux = await upstream(
        "/global/lux3d/v1/generate/task/list?page=1&pageSize=10",
      );
      const luxTasks = Array.isArray(lux)
        ? lux
        : (lux.list ?? lux.records ?? lux.items ?? []);
      if (luxTasks.some((item) => item.status === 0 || item.status === 1))
        return send(res, 409, {
          error: "Another generation is running. Wait, then retry this scan.",
          busy: true,
        });
      const url = await uploadVideoToAholo(body.url, upload, {
        fetch: request,
        createAssetClient: deps.createAssetClient,
      });
      const requestBody = {
        name,
        resources: [{ url, type: "video" }],
        taskQuality: "normal",
        scene: "space",
        useMask: false,
      };
      (deps.log ?? console.info)(
        "Aholo reconstruction request " + JSON.stringify(requestBody),
      );
      const created = await upstream(
        "/global/world/v1/reconstructions",
        requestBody,
      );
      if (!created.worldId)
        throw Error("No world ID returned: " + JSON.stringify(created));
      return send(res, 200, result(created));
    }
    if (action === "status" || action === "save") {
      const { worldId } = readScan(body.token, "world", key);
      const detail = await upstream(
        "/global/world/v1/" + encodeURIComponent(worldId),
      );
      if (action === "status")
        return send(res, 200, {
          worldId,
          status: detail.status,
          progress: worldProgress(detail),
          raw: detail,
        });
      if (detail.status !== "SUCCEEDED")
        throw Error("Room is not complete: " + JSON.stringify(detail));
      const source = detail.assets?.splats?.urls?.spzPath;
      if (!source || new URL(source).protocol !== "https:")
        throw Error(
          "Completed room has no valid SPZ download: " + JSON.stringify(detail),
        );
      const pathname = `rooms/${encodeURIComponent(worldId)}.spz`;
      try {
        const existing = await metadata(pathname);
        return send(res, 200, {
          url: existing.url,
          worldId,
          upAxis: detail.assets?.semanticsMetadata?.upAxis ?? "Z",
        });
      } catch (error) {
        if (!(error instanceof BlobNotFoundError)) throw error;
      }
      const download = await request(source, {
        signal: AbortSignal.timeout(180000),
      });
      if (!download.ok || !download.body)
        throw Error(`SPZ download HTTP ${download.status}`);
      const saved = await store(pathname, download.body, {
        access: "public",
        contentType: "application/octet-stream",
        addRandomSuffix: false,
        allowOverwrite: true,
        multipart: true,
      });
      return send(res, 200, {
        url: saved.url,
        worldId,
        upAxis: detail.assets?.semanticsMetadata?.upAxis ?? "Z",
      });
    }
    return send(res, 404, { error: "Unknown scan operation" });
  } catch (error) {
    let message = String(error?.message ?? error)
      .split(key)
      .join("[REDACTED]");
    message = message
      .split(process.env.BLOB_READ_WRITE_TOKEN)
      .join("[REDACTED]");
    return send(res, 502, { error: message });
  }
}
