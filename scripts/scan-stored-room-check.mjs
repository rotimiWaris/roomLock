import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const { room } = JSON.parse(
  await readFile("artifacts/scan-storage-check.json", "utf8"),
);
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1000, height: 760 },
    hasTouch: true,
  });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("Browser error:", error.message);
  });
  page.on("requestfailed", (request) =>
    console.log(
      "Request failed:",
      new URL(request.url()).host,
      request.failure()?.errorText,
    ),
  );
  page.on("response", (response) => {
    if (response.url() === room.url)
      console.log("Blob response:", response.status());
  });
  await page.addInitScript(
    (room) =>
      localStorage.setItem("roomlock.scan.v1", JSON.stringify({ room })),
    room,
  );
  await page.goto("http://127.0.0.1:5174/?edit=1");
  await page.waitForFunction(() => !!window.roomlock, undefined, {
    timeout: 120000,
  });
  console.log("Original room ready");
  await page.locator(".capture-footnote button").click();
  await page.getByRole("button", { name: "Enter my room" }).click();
  console.log("Loading saved Blob room");
  await page.waitForFunction(
    (url) =>
      window.roomlock?.config.url === url && window.roomlock.models.size === 6,
    room.url,
    { timeout: 180000 },
  );
  await expect(
    page.getByRole("button", { name: "Enter the room" }),
  ).toBeEnabled({ timeout: 180000 });
  await page.getByRole("button", { name: "Enter the room" }).click();
  await expect(page.locator(".game-dock")).toBeVisible();
  const loaded = await page.evaluate(() => ({
    url: window.roomlock.config.url,
    captured: window.roomlock.config.captured,
    models: window.roomlock.models.size,
    camera: window.roomlock.camera.position.toArray(),
    mode: document.querySelector(".room-label").textContent,
  }));
  expect(loaded.captured).toBe(true);
  expect(loaded.mode).toContain("Captured room");
  expect(loaded.camera[1]).toBe(1.5);
  expect(errors).toEqual([]);
  await page.locator(".editor").evaluate((el) => (el.style.display = "none"));
  await page.screenshot({ path: "artifacts/blob-room-playable.png" });
  await writeFile(
    "artifacts/scan-stored-room-check.json",
    JSON.stringify({ loaded, errors }, null, 2),
  );
  console.log(JSON.stringify({ loaded, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    console.log(await page.locator(".error").allTextContents());
  }
  throw error;
} finally {
  await browser.close();
}
