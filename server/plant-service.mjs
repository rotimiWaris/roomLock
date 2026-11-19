import { createHmac, timingSafeEqual } from "node:crypto";
const base = "https://api.aholo.ai/global/lux3d/v1/";
const clean = (text, key) => String(text).split(key).join("[REDACTED]");
function tokenFor(id, expiry, key) {
  return `${expiry}.${createHmac("sha256", key).update(`${id}:${expiry}`).digest("hex")}`;
}
export function validToken(id, token, key) {
  if (typeof token !== "string") return false;
  const [expiry] = token.split(".");
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
  const expected = Buffer.from(tokenFor(id, expiry, key)),
    received = Buffer.from(token);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
export function classifyStatus(status) {
  return status === 1 ? "generating" : status === 3 ? "succeeded" : "failed";
}
export function validatePrompt(prompt) {
  return (
    typeof prompt === "string" &&
    prompt.trim().length >= 3 &&
    prompt.trim().length <= 240
  );
}
async function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 2048) throw new Error("Request too large");
  }
  return JSON.parse(text || "{}");
}
async function upstream(key, path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: key,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Upstream HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  if (!response.ok || String(data.c) !== "0") {
    const error = new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
    error.code = data.c;
    throw error;
  }
  return data;
}
function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
export async function handle(req, res, path) {
  const key = process.env.AHOLO_API_KEY;
  if (!key)
    return send(res, 503, {
      error: "Live generation is not configured on this server.",
    });
  try {
    const url = new URL(req.url, "http://localhost");
    if (path === "/api/plant") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return send(res, 405, { error: "Use POST." });
      }
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host)
        return send(res, 403, { error: "Origin not allowed." });
      const body = await bodyOf(req);
      if (!validatePrompt(body.prompt))
        return send(res, 400, {
          error: "Describe one object using 3–240 characters.",
        });
      const prompt = body.prompt.trim();
      const listing = await upstream(
        key,
        "generate/task/list?page=1&pageSize=20",
      );
      const jobs = listing.d?.items ?? [];
      if (jobs.some((j) => j.status === 0 || j.status === 1))
        return send(res, 409, {
          error:
            "Another job is running. Wait for it to finish, then retry. No additional job was submitted.",
        });
      let result;
      try {
        result = await upstream(key, "generate/text-to-3d/task/create", {
          prompt,
          style: "photorealistic",
          version: "G1",
          faceCount: 30000,
          outputFormat: ["zip", "glb"],
        });
      } catch (error) {
        if (error.code === "GENERATION_CONCURRENCY_LIMIT_EXCEEDED")
          return send(res, 409, {
            error:
              "Another job is running. Wait and retry; no additional job was submitted.",
          });
        if (error.code) throw error;
        return send(res, 502, {
          error:
            "Connection interrupted during submission. The task may have started. Retry checks account activity before submitting again; if it reports busy, wait for the task to finish.",
        });
      }
      const id = String(result.d);
      if (!/^\d+$/.test(id))
        throw new Error(
          "Unexpected task ID returned. Do not resubmit until account activity is checked.",
        );
      return send(res, 200, {
        id,
        token: tokenFor(id, Date.now() + 24 * 60 * 60 * 1000, key),
      });
    }
    if (path === "/api/plant-status") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return send(res, 405, { error: "Use GET." });
      }
      const id = url.searchParams.get("id"),
        token = url.searchParams.get("token");
      if (!id || !/^\d+$/.test(id) || !validToken(id, token, key))
        return send(res, 403, { error: "Invalid or expired task access." });
      const raw = await upstream(
        key,
        `generate/task/get?taskid=${encodeURIComponent(id)}`,
      );
      const status = raw.d?.status;
      let modelUrl;
      if (status === 3) {
        const outputs = raw.d.outputs ?? [];
        modelUrl =
          outputs.find((o) => /\.glb(?:\?|$)/i.test(o?.content ?? ""))
            ?.content ?? outputs[1]?.content;
        if (!modelUrl?.startsWith("https://"))
          throw new Error("Completed task did not return an HTTPS GLB URL.");
      }
      return send(res, 200, {
        status,
        stage: classifyStatus(status),
        ...(modelUrl ? { url: modelUrl } : {}),
        ...(status !== 1 && status !== 3
          ? { raw: JSON.parse(clean(JSON.stringify(raw), key)) }
          : {}),
      });
    }
    return send(res, 404, { error: "Not found." });
  } catch (error) {
    return send(res, 502, {
      error: clean(error.message || "Connection failed. Please retry.", key),
    });
  }
}
