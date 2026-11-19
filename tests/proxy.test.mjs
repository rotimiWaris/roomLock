import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handle } from "../server/plant-service.mjs";
const secret = "local-test-credential";
function response() {
  return {
    headers: {},
    statusCode: 0,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(text) {
      this.data = JSON.parse(text);
    },
  };
}
async function withUpstream(responses, run) {
  const before = globalThis.fetch,
    old = process.env.AHOLO_API_KEY;
  let calls = 0;
  process.env.AHOLO_API_KEY = secret;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.Authorization, secret);
    const entry = responses[calls++];
    assert.ok(entry, "Unexpected upstream request");
    return new Response(JSON.stringify(entry), { status: 200 });
  };
  try {
    await run(() => calls);
  } finally {
    globalThis.fetch = before;
    if (old === undefined) delete process.env.AHOLO_API_KEY;
    else process.env.AHOLO_API_KEY = old;
  }
}
test("busy account never submits another generation", async () =>
  withUpstream(
    [{ c: "0", d: { items: [{ taskId: 7, status: 1 }] } }],
    async (calls) => {
      const res = response();
      await handle(
        {
          method: "POST",
          url: "/api/plant",
          headers: { host: "localhost" },
          body: { prompt: "a muddy boot" },
        },
        res,
        "/api/plant",
      );
      assert.equal(res.statusCode, 409);
      assert.equal(calls(), 1);
      assert.match(res.data.error, /Another job/);
    },
  ));
test("creation returns signed task access without the credential", async () =>
  withUpstream(
    [
      { c: "0", d: { items: [] } },
      { c: "0", d: 123 },
    ],
    async (calls) => {
      const res = response();
      await handle(
        {
          method: "POST",
          url: "/api/plant",
          headers: { host: "localhost" },
          body: { prompt: "a muddy boot" },
        },
        res,
        "/api/plant",
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.data.id, "123");
      assert.equal(calls(), 2);
      assert.ok(res.data.token);
      assert.ok(!JSON.stringify(res.data).includes(secret));
    },
  ));
test("unexpected status preserves the raw status while redacting credentials", async () =>
  withUpstream(
    [{ c: "0", d: { taskId: 123, status: 0 }, m: secret }],
    async () => {
      const expiry = Date.now() + 10000;
      const token = `${expiry}.${createHmac("sha256", secret).update(`123:${expiry}`).digest("hex")}`;
      const res = response();
      await handle(
        {
          method: "GET",
          url: `/api/plant-status?id=123&token=${token}`,
          headers: {},
        },
        res,
        "/api/plant-status",
      );
      assert.equal(res.data.stage, "failed");
      assert.equal(res.data.raw.d.status, 0);
      assert.ok(!JSON.stringify(res.data).includes(secret));
    },
  ));
test("invalid task token cannot query the account", async () =>
  withUpstream([], async (calls) => {
    const res = response();
    await handle(
      {
        method: "GET",
        url: "/api/plant-status?id=123&token=forged",
        headers: {},
      },
      res,
      "/api/plant-status",
    );
    assert.equal(res.statusCode, 403);
    assert.equal(calls(), 0);
  }));
