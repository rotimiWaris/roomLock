import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const roomBytes = await readFile("public/rooms/room.mobile.spz");
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 850 },
    hasTouch: true,
  });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let documents = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents++;
  });
  const records = ["one", "two"].map((worldId) => ({
    worldId,
    blobUrl: `https://fixture.public.blob.vercel-storage.com/${worldId}.spz`,
    createdAt: "2026-11-19T00:00:00Z",
    sourceVideoName: `${worldId}.mov`,
    upAxis: "Z",
  }));
  await page.addInitScript((records) => {
    if (!localStorage.getItem("roomlock.rooms")) {
      localStorage.setItem("roomlock.rooms", JSON.stringify(records));
      localStorage.setItem("roomlock.activeRoom", JSON.stringify(records[0]));
    }
  }, records);
  await page.route(
    "https://fixture.public.blob.vercel-storage.com/**",
    (route) =>
      route.fulfill({
        status: route.request().url().includes("/broken") ? 404 : 200,
        body: roomBytes,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/octet-stream",
        },
      }),
  );
  await page.goto("http://127.0.0.1:5174/?edit=1");
  await page.waitForFunction(
    () => window.roomlock?.models.size === 6,
    undefined,
    { timeout: 120000 },
  );
  await expect(
    page.getByRole("heading", { name: "Scan your room" }),
  ).toHaveCount(0);
  console.log("Saved room loaded directly in edit mode");
  await page.evaluate(() => {
    window.roomlock.camera.position.x += 0.1;
  });
  await page
    .getByRole("button", { name: "Save current camera as spawn" })
    .click();
  const edited = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("roomlock.edits.one"));
    c.evidence[0].position[0] += 0.123;
    return c;
  });
  await page
    .getByRole("textbox", { name: "Room configuration JSON" })
    .fill(JSON.stringify(edited));
  await page.getByRole("button", { name: "Apply and save room" }).click();
  await page.waitForFunction(
    (x) => window.roomlock?.config.evidence[0].position[0] === x,
    edited.evidence[0].position[0],
    { timeout: 120000 },
  );
  await page.evaluate(() => (window.beforeToggle = window.roomlock));
  const beforeDocuments = documents;
  await page.getByRole("button", { name: "Play mode", exact: true }).click();
  expect(new URL(page.url()).searchParams.has("edit")).toBe(false);
  await page.getByRole("button", { name: "Edit room", exact: true }).click();
  expect(
    await page.evaluate(() => window.beforeToggle === window.roomlock),
  ).toBe(true);
  expect(documents).toBe(beforeDocuments);
  await page.reload();
  await page.waitForFunction(
    () => window.roomlock?.models.size === 6,
    undefined,
    { timeout: 120000 },
  );
  const restored = await page.evaluate(() => ({
    camera: window.roomlock.config.camera,
    evidence: window.roomlock.config.evidence,
    calibrated: window.roomlock.config.calibrated,
    url: window.roomlock.config.url,
  }));
  expect(restored.camera).toEqual(edited.camera);
  expect(restored.evidence).toEqual(edited.evidence);
  expect(restored.calibrated).toBe(true);
  console.log(
    "Reload restored camera and evidence without automatic replacement",
  );
  await page
    .getByRole("button", { name: "Saved rooms (2)", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Saved room", exact: true })
    .selectOption("two");
  await page.waitForFunction(
    () =>
      window.roomlock?.config.url.endsWith("/two.spz") &&
      window.roomlock.models.size === 6,
    undefined,
    { timeout: 120000 },
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("roomlock.activeRoom")).worldId,
    ),
  ).toBe("two");
  await page.getByRole("button", { name: "Close panel" }).click();
  await page
    .getByRole("button", { name: "Saved rooms (2)", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete room", exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("roomlock.rooms")).length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Close panel" }).click();
  await page
    .getByRole("button", { name: "Saved rooms (1)", exact: true })
    .click();
  await page.route("**/api/scan?action=recover", (route) =>
    route.fulfill({
      json: {
        worldId: "recovered",
        url: "https://fixture.public.blob.vercel-storage.com/recovered.spz",
        upAxis: "Z",
      },
    }),
  );
  await page
    .getByLabel("Load room from worldId", { exact: true })
    .fill("recovered");
  await page
    .getByRole("button", { name: "Load room from worldId", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("roomlock.activeRoom")).worldId ===
      "recovered",
  );
  await page.waitForFunction(
    () =>
      window.roomlock?.config.url.endsWith("/recovered.spz") &&
      window.roomlock.models.size === 6,
    undefined,
    { timeout: 120000 },
  );
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem("roomlock.activeRoom"));
    r.blobUrl = "https://fixture.public.blob.vercel-storage.com/broken.spz";
    localStorage.setItem("roomlock.activeRoom", JSON.stringify(r));
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("recovered", {
    timeout: 60000,
  });
  await expect(page.getByRole("alert")).toContainText(
    "Could not load saved room",
  );
  expect(errors).toEqual([]);
  await writeFile(
    "artifacts/room-persistence-check.json",
    JSON.stringify(
      {
        restored,
        modeToggleReloaded: false,
        picker: true,
        deletion: true,
        recovery: true,
        failedBlobIdentifiesWorld: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Persistence, mode switching, picker, deletion, recovery and failure message passed",
  );
} finally {
  await browser.close();
}
