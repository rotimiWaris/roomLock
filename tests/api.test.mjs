import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  classifyStatus,
  validToken,
  validatePrompt,
} from "../server/plant-service.mjs";
test("only the observed successful and running statuses are accepted", () => {
  assert.equal(classifyStatus(1), "generating");
  assert.equal(classifyStatus(3), "succeeded");
  for (const value of [0, 2, 4, 6, undefined, null, "3"])
    assert.equal(classifyStatus(value), "failed");
});
test("task access rejects forged, expired, and cross-task tokens", () => {
  const key = "test-only",
    id = "123",
    expiry = Date.now() + 60000;
  const token = `${expiry}.${createHmac("sha256", key).update(`${id}:${expiry}`).digest("hex")}`;
  assert.equal(validToken(id, token, key), true);
  assert.equal(validToken("456", token, key), false);
  assert.equal(validToken(id, token + "x", key), false);
  assert.equal(validToken(id, "0.abc", key), false);
  assert.equal(validToken(id, null, key), false);
});
test("prompt validation enforces trimmed length and string type", () => {
  assert.equal(validatePrompt("  boot  "), true);
  for (const value of ["", "  a ", "a".repeat(241), {}, null])
    assert.equal(validatePrompt(value), false);
});
