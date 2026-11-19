import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/__failure", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  let polls = 0;
  await page.route("**/api/scan?action=status", (route) => {
    polls++;
    return route.fulfill({
      json: {
        status: "FAILED",
        progress: 1,
        raw: { status: "FAILED", progress: 1 },
      },
    });
  });
  await page.goto("http://127.0.0.1:5174/__failure");
  await page.evaluate(async () => {
    localStorage.setItem(
      "roomlock.scan.v1",
      JSON.stringify({
        proof: "old-proof",
        url: "old-upload",
        job: { worldId: "failed-world", token: "test", startedAt: Date.now() },
      }),
    );
    const reactModule = await import("/node_modules/.vite/deps/react.js");
    const React = reactModule.default ?? reactModule;
    const domModule =
      await import("/node_modules/.vite/deps/react-dom_client.js");
    const { createRoot } = domModule.default ?? domModule;
    const { default: ScanRoom } = await import("/src/ScanRoom.tsx");
    createRoot(document.getElementById("root")).render(
      React.createElement(ScanRoom, { onReady() {} }),
    );
  });
  await expect(page.getByRole("alert")).toContainText(
    "Aholo couldn't read this video, try re-filming slowly for 20 to 60 seconds",
  );
  await expect(
    page.getByRole("button", { name: "Retry status / save" }),
  ).toHaveCount(0);
  await expect(page.locator("input[type=file]").first()).toBeEnabled();
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("roomlock.scan.v1")),
  );
  expect(session).toEqual({});
  await page.waitForTimeout(9000);
  expect(polls).toBe(1);
  await writeFile(
    "artifacts/scan-failure-check.json",
    JSON.stringify({ polls, session, newUploadAvailable: true }, null, 2),
  );
  console.log("Failed world cleared; new upload available; no further polling");
} finally {
  await browser.close();
}
