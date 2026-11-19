import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const calibration = JSON.parse(
  await readFile("artifacts/cleanup-check.json", "utf8"),
);
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:5174/?edit=1");
  await page.waitForFunction(() => !!window.roomlock, undefined, {
    timeout: 120000,
  });
  await page.getByRole("button", { name: "Open case file" }).click();
  await page.getByRole("button", { name: "Enter the room" }).click();
  const placements = [];
  for (const prior of calibration.evidence) {
    const candidate = await page.evaluate(async (prior) => {
      const { Vector2, Vector3, Raycaster } =
        await import("/node_modules/three/build/three.module.js");
      const r = window.roomlock,
        p = r.config.evidence.find((p) => p.id === prior.id);
      r.camera.position.fromArray(prior.camera);
      r.constrain(r.camera.position);
      let best;
      for (const dx of [0, -0.15, 0.15])
        for (const dz of [0, -0.15, 0.15]) {
          const aim = new Vector3(...p.position).add(new Vector3(dx, 0, dz));
          r.camera.lookAt(aim);
          r.camera.updateMatrixWorld(true);
          const ray = new Raycaster();
          ray.setFromCamera(new Vector2(0, 0), r.camera);
          const hit = ray
            .intersectObject(r.splat)
            .find((h) => h.distance > 0.3 && h.distance < 1.55);
          if (!hit || hit.point.y > 1.2) continue;
          const distance = hit.point.distanceTo(new Vector3(...p.position));
          if (distance > 0.65) continue;
          const score = distance + Math.abs(hit.point.y - p.position[1]);
          if (!best || score < best.score)
            best = { score, point: hit.point.toArray(), aim: aim.toArray() };
        }
      if (best) {
        r.camera.lookAt(new Vector3(...best.aim));
        r.yaw = r.camera.rotation.y;
        r.pitch = r.camera.rotation.x;
      }
      return best;
    }, prior);
    if (!candidate) throw Error(`No nearby captured surface for ${prior.id}`);
    await page
      .getByRole("combobox", { name: "Object to place" })
      .selectOption(prior.id);
    await page.waitForTimeout(150);
    await page
      .locator(".room-canvas canvas")
      .click({ position: { x: 500, y: 350 } });
    const placed = await page.evaluate(
      (id) => window.roomlock.config.evidence.find((p) => p.id === id),
      prior.id,
    );
    placements.push(placed);
    console.log(prior.id, placed.position);
  }
  const config = await page.evaluate(() => window.roomlock.config);
  await writeFile(
    "artifacts/surface-placements.json",
    JSON.stringify(placements, null, 2),
  );
  await browser.close();
  await writeFile(
    "public/rooms/room.json",
    JSON.stringify(config, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
