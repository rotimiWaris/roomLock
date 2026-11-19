import test from "node:test";
import assert from "node:assert/strict";
import { BlobNotFoundError } from "@vercel/blob";
import {
  handleScan,
  signScan,
  readScan,
  worldProgress,
  validateVideo,
} from "../server/scan-service.mjs";
const key = "test-key-never-return";
process.env.AHOLO_API_KEY = key;
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
async function call(action, body, deps = {}) {
  const req = {
    url: "/api/scan?action=" + action,
    method: "POST",
    headers: { host: "localhost" },
    body,
  };
  const res = {
    statusCode: 0,
    setHeader() {},
    end(body) {
      this.body = JSON.parse(body);
    },
  };
  await handleScan(req, res, deps);
  assert.ok(!JSON.stringify(res.body).includes(key));
  return res;
}
test("scan proofs enforce purpose, integrity, and expiration", (context) => {
  const token = signScan({ kind: "world", worldId: "world-1" }, key);
  assert.equal(readScan(token, "world", key).worldId, "world-1");
  assert.throws(() => readScan(token, "upload", key));
  assert.throws(() => readScan(token + "0", "world", key));
  assert.throws(() => readScan(token, "world", "different-key"));
  const future = Date.now() + 86400001;
  context.mock.method(Date, "now", () => future);
  assert.throws(() => readScan(token, "world", key), /expired/);
});
test("world progress passes through real fractions without guessing", () => {
  for (const progress of [0, 0.42, 1])
    assert.equal(worldProgress({ progress }), progress);
  for (const progress of [undefined, "42", 42, -1, NaN])
    assert.equal(worldProgress({ progress }), null);
});
const uploadData = {
  kind: "blob-upload",
  scanId: "scan-1",
  pathname: "videos/scan-1.mp4",
  size: 4096,
};
const videoUrl =
  "https://store.public.blob.vercel-storage.com/videos/scan-1.mp4";
const videoHead = (status = 200, type = "video/mp4", size = 4096) =>
  new Response(null, {
    status,
    headers: { "content-type": type, "content-length": String(size) },
  });
test("upload reserves a unique MP4 path and rejects oversized input", async () => {
  const good = await call("upload", { size: 9000000 });
  assert.equal(good.statusCode, 200);
  const data = readScan(good.body.proof, "blob-upload", key);
  assert.equal(data.size, 9000000);
  assert.match(data.pathname, /^videos\/[a-z0-9-]+\.mp4$/);
  assert.equal((await call("upload", { size: 10000000 })).statusCode, 400);
});
test("Blob upload token is bound to one path, MP4 type, and byte limit", async () => {
  const proof = signScan(uploadData, key);
  const result = await call(
    "blob-upload",
    {},
    {
      handleUpload: async (options) => {
        const limits = await options.onBeforeGenerateToken(
          uploadData.pathname,
          proof,
        );
        assert.deepEqual(limits.allowedContentTypes, ["video/mp4"]);
        assert.equal(limits.maximumSizeInBytes, 4096);
        assert.equal(limits.allowOverwrite, false);
        await assert.rejects(
          options.onBeforeGenerateToken("videos/other.mp4", proof),
        );
        await assert.rejects(
          options.onBeforeGenerateToken(uploadData.pathname, proof + "bad"),
        );
        return {
          type: "blob.generate-client-token",
          clientToken: "temporary-token",
        };
      },
    },
  );
  assert.equal(result.statusCode, 200);
});
test("start verifies public MP4 before submitting and logs the exact request body", async () => {
  const proof = signScan(uploadData, key);
  let creation,
    checked = false,
    logged;
  const fetch = async (url, options) => {
    if (url.includes("/world/v1/list")) return response({ result: [] });
    if (url.includes("/lux3d/")) return response({ c: "0", d: { items: [] } });
    if (url === videoUrl) {
      assert.equal(options.redirect, "error");
      checked = true;
      return options.method === "HEAD"
        ? videoHead()
        : new Response(new Uint8Array(4096), {
            headers: { "content-type": "video/mp4" },
          });
    }
    assert.equal(checked, true);
    creation = JSON.parse(options.body);
    return response({ worldId: "created-world" });
  };
  const result = await call(
    "start",
    { proof, url: videoUrl },
    {
      fetch,
      log: (line) => (logged = line),
      createAssetClient: (config) => {
        assert.deepEqual(config, { region: "com" });
        return {
          uploadBuffer: async (bytes, options) => {
            assert.equal(bytes.length, 4096);
            assert.equal(options.filename, "room.mp4");
            return { url: "https://holo-cos.example.test/room.mp4" };
          },
        };
      },
    },
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(creation.resources, [
    { url: "https://holo-cos.example.test/room.mp4", type: "video" },
  ]);
  assert.ok(!JSON.stringify(creation).includes("vercel-storage.com"));
  assert.deepEqual(
    JSON.parse(logged.slice("Aholo reconstruction request ".length)),
    creation,
  );
  assert.ok(!logged.includes(key));
  assert.equal(
    readScan(result.body.token, "world", key).worldId,
    "created-world",
  );
});
test("video verification rejects local URLs, wrong paths, redirects, bad types, and empty files", async () => {
  for (const url of [
    "blob:http://localhost/a",
    "http://localhost/a.mp4",
    "https://localhost/a.mp4",
    "https://example.com/videos/scan-1.mp4",
    videoUrl + "?x=1",
    videoUrl.replace("scan-1", "wrong"),
  ]) {
    await assert.rejects(
      validateVideo(url, uploadData, async () => {
        throw Error("Must not fetch");
      }),
      /public|missing/,
    );
  }
  for (const head of [
    videoHead(302),
    videoHead(404),
    videoHead(200, "text/html"),
    videoHead(200, "video/mp4", 0),
    videoHead(200, "video/mp4", 100),
  ]) {
    await assert.rejects(
      validateVideo(videoUrl, uploadData, async () => head),
      /not readable/,
    );
  }
});
test("an unreadable video never starts a reconstruction", async () => {
  let submitted = false;
  const result = await call(
    "start",
    { proof: signScan(uploadData, key), url: videoUrl },
    {
      fetch: async (url) => {
        if (url.includes("/world/v1/list")) return response({ result: [] });
        if (url.includes("/lux3d/")) return response({ items: [] });
        if (url === videoUrl) return videoHead(200, "application/octet-stream");
        submitted = true;
        return response({ worldId: "unexpected" });
      },
    },
  );
  assert.equal(result.statusCode, 502);
  assert.equal(submitted, false);
});
test("start recovers a running submission but rejects a failed world for a fresh upload", async () => {
  const proof = signScan(uploadData, key);
  for (const status of ["RUNNING", "FAILED"]) {
    let calls = 0;
    const result = await call(
      "start",
      { proof },
      {
        fetch: async () => {
          calls++;
          return response({
            result: [
              { name: "RoomLock scan-1", worldId: "existing-world", status },
            ],
          });
        },
      },
    );
    assert.equal(calls, 1);
    if (status === "FAILED") {
      assert.equal(result.statusCode, 409);
      assert.equal(result.body.newUploadRequired, true);
    } else assert.equal(result.body.worldId, "existing-world");
  }
});
test("status exposes provider status and progress, including failure details", async () => {
  const token = signScan({ kind: "world", worldId: "test-world" }, key);
  const data = { status: "RUNNING", progress: 0.37 };
  const result = await call(
    "status",
    { token },
    { fetch: async () => response(data) },
  );
  assert.equal(result.body.progress, 0.37);
  assert.deepEqual(result.body.raw, data);
});
test("save streams the provider SPZ into Blob and returns only its permanent URL", async () => {
  const token = signScan({ kind: "world", worldId: "test-world" }, key);
  let stored = 0;
  const result = await call(
    "save",
    { token, url: "http://localhost/ignored" },
    {
      fetch: async (url) =>
        url.includes("/world/v1/")
          ? response({
              status: "SUCCEEDED",
              assets: {
                splats: {
                  urls: { spzPath: "https://cdn.example.test/room.spz" },
                },
              },
            })
          : new Response(new Uint8Array([1, 2, 3])),
      head: async () => {
        throw new BlobNotFoundError();
      },
      put: async (path, stream, options) => {
        assert.equal(path, "rooms/test-world.spz");
        assert.equal(options.access, "public");
        for await (const chunk of stream) stored += chunk.length;
        return { url: "https://store.public.blob.vercel-storage.com/room.spz" };
      },
    },
  );
  assert.equal(result.statusCode, 200);
  assert.equal(stored, 3);
  assert.match(result.body.url, /blob.vercel-storage.com/);
});
test("save retries reuse already saved SPZ and never download again", async () => {
  const token = signScan({ kind: "world", worldId: "saved" }, key);
  let calls = 0;
  const result = await call(
    "save",
    { token },
    {
      fetch: async () => {
        calls++;
        return response({
          status: "SUCCEEDED",
          assets: {
            splats: { urls: { spzPath: "https://cdn.example.test/a.spz" } },
          },
        });
      },
      head: async () => ({
        url: "https://store.public.blob.vercel-storage.com/saved.spz",
      }),
    },
  );
  assert.equal(result.statusCode, 200);
  assert.equal(calls, 1);
});
test("server errors redact the configured API key", async () => {
  const result = await call(
    "status",
    { token: signScan({ kind: "world", worldId: "test-world" }, key) },
    {
      fetch: async () => {
        throw Error("Failure with " + key);
      },
    },
  );
  assert.equal(result.statusCode, 502);
  assert.match(result.body.error, /REDACTED/);
});

test("recover validates world IDs and reuses an existing Blob without an expiring source URL", async () => {
  assert.equal((await call("recover", { worldId: "../bad" })).statusCode, 400);
  const result = await call(
    "recover",
    { worldId: "saved-world" },
    {
      fetch: async (url) => {
        assert.ok(url.endsWith("/saved-world"));
        return response({ status: "SUCCEEDED" });
      },
      head: async () => ({
        url: "https://store.public.blob.vercel-storage.com/saved-world.spz",
      }),
    },
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.worldId, "saved-world");
});
test("recover downloads and saves a completed world and reports unfinished worlds", async () => {
  let bytes = 0;
  const result = await call(
    "recover",
    { worldId: "fresh-world" },
    {
      fetch: async (url) =>
        url.includes("/world/v1/")
          ? response({
              status: "SUCCEEDED",
              assets: {
                splats: {
                  urls: { spzPath: "https://cdn.example.test/fresh.spz" },
                },
              },
            })
          : new Response(new Uint8Array([1, 2, 3])),
      head: async () => {
        throw new BlobNotFoundError();
      },
      put: async (path, stream) => {
        for await (const chunk of stream) bytes += chunk.length;
        return { url: "https://store.public.blob.vercel-storage.com/" + path };
      },
    },
  );
  assert.equal(result.statusCode, 200);
  assert.equal(bytes, 3);
  const failed = await call(
    "recover",
    { worldId: "unfinished" },
    { fetch: async () => response({ status: "FAILED" }) },
  );
  assert.match(failed.body.error, /unfinished.*FAILED/);
});
