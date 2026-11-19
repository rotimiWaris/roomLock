import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5174/");
  await expect(
    page.getByRole("button", { name: "Open case file", exact: true }),
  ).toBeEnabled({ timeout: 120000 });
  console.log("Room ready");
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() =>
    ["Cinzel", "Space Grotesk", "Inter", "Geist Mono"].map((name) => ({
      name,
      loaded: document.fonts.check(`12px "${name}"`),
    })),
  );
  await page.screenshot({
    path: "artifacts/redesign-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Captured rooms", exact: true }).click();
  await expect(page.locator("#captured-rooms")).toBeInViewport();
  await page
    .locator(".capture-views")
    .getByRole("button", { name: /A different angle/ })
    .click();
  await expect(page.locator(".capture-open img")).toHaveAttribute(
    "src",
    "/media/room-corner.webp",
  );
  await page.locator(".capture-open").click();
  await expect(
    page.getByRole("dialog", { name: "Room capture preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next room view" }).click();
  await expect(page.locator(".capture-dialog > img")).toHaveAttribute(
    "src",
    "/media/room-window.webp",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Room capture preview" }),
  ).not.toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(width);
    results.push(metrics);
    if (width === 390)
      await page.screenshot({
        path: "artifacts/redesign-mobile.png",
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Begin the investigation" }).click();
  await expect(
    page.getByRole("dialog", { name: "brief panel" }),
  ).toBeInViewport();
  await page.screenshot({ path: "artifacts/redesign-brief.png" });
  await page.getByRole("button", { name: "Enter the room" }).click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".launch-site")).toHaveCount(0);
  await expect(page.locator(".game-dock")).toBeVisible();
  await page.screenshot({ path: "artifacts/redesign-game-mobile.png" });
  expect(errors).toEqual([]);
  await writeFile(
    "artifacts/design-check.json",
    JSON.stringify(
      {
        fonts,
        layouts: results,
        errors,
        gallery: "passed",
        launchFromFooter: "passed",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      fonts,
      layouts: results,
      errors,
      gallery: "passed",
      launchFromFooter: "passed",
    }),
  );
} finally {
  await browser.close();
}
