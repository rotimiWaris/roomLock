import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page
  .getByRole("button", { name: "Open case file" })
  .waitFor({ state: "visible", timeout: 120000 });
await page.getByRole("button", { name: "Open case file" }).isEnabled();
await page.waitForTimeout(5000);
await page.screenshot({ path: "artifacts/desktop-title.png" });
await page.getByRole("button", { name: "Open case file" }).click();
await page.getByRole("button", { name: "Enter the room" }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: "artifacts/desktop-room.png" });
await page.getByRole("button", { name: /Evidence board/ }).click();
await page.screenshot({ path: "artifacts/board-empty.png" });
await page.getByRole("button", { name: "Close panel" }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "artifacts/mobile-room.png" });
await writeFile(
  "artifacts/browser-errors.json",
  JSON.stringify(errors, null, 2),
);
console.log(JSON.stringify({ errors, title: await page.title() }, null, 2));
await browser.close();
