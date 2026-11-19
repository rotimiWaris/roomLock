import { chromium, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
process.loadEnvFile(".env");
const key = process.env.AHOLO_API_KEY;
const jobs = JSON.parse(await readFile("assets/task-ids.json", "utf8"));
const task = jobs["cracked-vase"].at(-1);
const id = String(task.taskId),
  expiry = Date.now() + 600000;
const token = `${expiry}.${createHmac("sha256", key).update(`${id}:${expiry}`).digest("hex")}`;
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ id, token }) =>
      sessionStorage.setItem(
        "roomlock-job",
        JSON.stringify({
          id,
          token,
          started: Date.now(),
          prompt: "A vase placed during the browser check",
        }),
      ),
    { id, token },
  );
  await page.goto("http://127.0.0.1:5173/?edit=1");
  await page.waitForFunction(() => !!window.roomlock, undefined, {
    timeout: 120000,
  });
  await page.locator(".editor").evaluate((el) => (el.style.display = "none"));
  await page.screenshot({ path: "artifacts/mobile-title.png" });
  await page.getByRole("button", { name: "Open case file" }).click();
  await page.getByRole("button", { name: "Enter the room" }).click();
  const before = await page.evaluate(() =>
    window.roomlock.camera.position.toArray(),
  );
  await page.getByRole("button", { name: "Move forward" }).click();
  const after = await page.evaluate(() =>
    window.roomlock.camera.position.toArray(),
  );
  expect(after).not.toEqual(before);
  await page.screenshot({ path: "artifacts/mobile-room.png" });
  await page.getByRole("button", { name: "Plant evidence" }).click();
  await page
    .getByRole("button", { name: "Resume / retry existing job" })
    .click();
  await expect(
    page.getByText("Your object is in the room.", { exact: false }),
  ).toBeVisible({ timeout: 120000 });
  await page.screenshot({ path: "artifacts/live-plant-success.png" });
  await page.getByRole("button", { name: "Close panel" }).click();
  const result = await page.evaluate(() => ({
    models: window.roomlock.models.size,
    planted: [...window.roomlock.models.keys()].filter((k) =>
      k.startsWith("planted-"),
    ),
    roomSplats: window.roomlock.splat.splats?.getNumSplats(),
  }));
  expect(result.planted).toHaveLength(1);
  await writeFile(
    "artifacts/live-check.json",
    JSON.stringify(
      {
        errors,
        result,
        mobileMovement: true,
        existingTaskResumed: true,
        newGenerationSubmitted: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        errors,
        result,
        mobileMovement: true,
        existingTaskResumed: true,
        newGenerationSubmitted: false,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
