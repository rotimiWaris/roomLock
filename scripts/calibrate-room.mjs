import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:5173/?edit=1");
await page.waitForFunction(() => !!window.roomlock, { timeout: 120000 });
await page.getByRole("button", { name: "Open case file" }).click();
await page.getByRole("button", { name: "Enter the room" }).click();
for (let i = 0; i < 4; i++) {
  await page.evaluate((i) => {
    const r = window.roomlock;
    r.yaw = (i * Math.PI) / 2;
    r.pitch = -0.1;
  }, i);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `artifacts/view-${i}.png` });
}
const result = await page.evaluate(async () => {
  const { Raycaster, Vector2, Vector3 } =
    await import("/node_modules/three/build/three.module.js");
  const r = window.roomlock;
  const points = [];
  for (let i = 0; i < 4; i++) {
    r.camera.rotation.set(-0.25, (i * Math.PI) / 2, 0, "YXZ");
    r.camera.updateMatrixWorld(true);
    for (const x of [-0.55, 0, 0.55]) {
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(x, -0.3), r.camera);
      const hits = ray.intersectObject(r.splat);
      points.push({
        yaw: (i * Math.PI) / 2,
        x,
        hit: hits[0]?.point.toArray(),
        distance: hits[0]?.distance,
      });
    }
  }
  return points;
});
await writeFile(
  "artifacts/surface-points.json",
  JSON.stringify(result, null, 2),
);
console.log(result);
await browser.close();
