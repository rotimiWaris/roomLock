import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/__save-room", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.route("**/api/scan?*", (route) =>
    route.fulfill({
      json: route.request().url().includes("action=status")
        ? { status: "SUCCEEDED", progress: 1, raw: { status: "SUCCEEDED" } }
        : {
            worldId: "just-finished",
            url: "https://fixture.public.blob.vercel-storage.com/just-finished.spz",
            upAxis: "Z",
          },
    }),
  );
  await page.goto("http://127.0.0.1:5174/__save-room");
  await page.evaluate(async () => {
    localStorage.setItem(
      "roomlock.scan.v1",
      JSON.stringify({
        sourceVideoName: "My living room.MOV",
        job: {
          worldId: "just-finished",
          token: "fixture",
          startedAt: Date.now(),
        },
      }),
    );
    const reactModule = await import("/node_modules/.vite/deps/react.js");
    const React = reactModule.default ?? reactModule;
    const domModule =
      await import("/node_modules/.vite/deps/react-dom_client.js");
    const { createRoot } = domModule.default ?? domModule;
    const { default: ScanRoom } = await import("/src/ScanRoom.tsx");
    createRoot(document.getElementById("root")).render(
      React.createElement(ScanRoom, {
        onReady() {
          throw Error("Test must not enter the room");
        },
      }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Enter my room" }),
  ).toBeVisible();
  const stored = await page.evaluate(() => ({
    rooms: JSON.parse(localStorage.getItem("roomlock.rooms")),
    active: JSON.parse(localStorage.getItem("roomlock.activeRoom")),
  }));
  expect(stored.rooms).toHaveLength(1);
  expect(stored.active).toEqual(stored.rooms[0]);
  expect(stored.active.worldId).toBe("just-finished");
  expect(stored.active.sourceVideoName).toBe("My living room.MOV");
  expect(stored.active.blobUrl).toContain("blob.vercel-storage.com");
  expect(stored.active.createdAt).toBeTruthy();
  await writeFile(
    "artifacts/room-save-check.json",
    JSON.stringify(stored, null, 2),
  );
  console.log("Completed room persisted before Enter my room was clicked");
} finally {
  await browser.close();
}
