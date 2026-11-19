import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
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
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.FULL_ROOM === "1")
    await page.route("**/room.mobile.spz", (route) =>
      route.fulfill({
        path: "public/rooms/room.spz",
        contentType: "application/octet-stream",
      }),
    );
  await page.goto("http://127.0.0.1:5174/?edit=1");
  await page.waitForFunction(() => !!window.roomlock, undefined, {
    timeout: 120000,
  });
  console.log("Room loaded");
  await page.getByRole("button", { name: "Open case file" }).click();
  await page.getByRole("button", { name: "Enter the room" }).click();
  await page.waitForFunction(() => [...window.roomlock.models.values()].some(group => {
    const glint = group.getObjectByName("glint");
    return glint?.visible && glint.material.opacity > 0;
  }), undefined, { timeout: 8000 });
  await expect(
    page.getByRole("button", { name: "Suspects", exact: false }),
  ).toHaveCount(0);
  const initial = await page.evaluate(() => ({
    ...window.roomlock.cleanupStats,
  }));
  const opacity = page.getByRole("slider", { name: "Minimum splat opacity" });
  await opacity.fill("0.3");
  const stricter = await page.evaluate(() => window.roomlock.cleanupStats.kept);
  expect(stricter).toBeLessThan(initial.kept);
  await opacity.fill("0.02");
  expect(await page.evaluate(() => window.roomlock.cleanupStats.kept)).toBe(
    initial.kept,
  );
  await page
    .getByRole("slider", { name: "Maximum splat scale multiple" })
    .fill("2");
  expect(
    await page.evaluate(() => window.roomlock.cleanupStats.kept),
  ).toBeLessThan(initial.kept);
  await page.waitForTimeout(800);
  await page.screenshot({ path: "artifacts/cleanup-strict.png" });
  await page
    .getByRole("slider", { name: "Maximum splat scale multiple" })
    .fill("10");
  await page.screenshot({ path: "artifacts/cleanup-editor.png" });
  await page.locator(".editor").evaluate((el) => (el.style.display = "none"));
  for (let i = 0; i < 4; i++) {
    await page.evaluate((i) => {
      const r = window.roomlock;
      r.yaw = (i * Math.PI) / 2;
      r.pitch = -0.15;
    }, i);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `artifacts/clean-room-${i}.png` });
  }
  const calibration = await page.evaluate(async () => {
    const { Vector2, Vector3, Box3, Raycaster } =
      await import("/node_modules/three/build/three.module.js");
    const r = window.roomlock;
    const evidence = [];
    for (const [id, group] of r.models) {
      const box = new Box3().setFromObject(group.userData.model);
      const target = box.getCenter(new Vector3());
      let best = null;
      for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8;
        r.camera.position.set(
          r.config.camera[0] + Math.cos(angle) * 0.98,
          1.5,
          r.config.camera[2] + Math.sin(angle) * 0.98,
        );
        r.constrain(r.camera.position);
        r.camera.lookAt(target);
        r.camera.updateMatrixWorld(true);
        r.ray.setFromCamera(new Vector2(0, 0), r.camera);
        const hit = r.ray.intersectObject(group, true)[0];
        const surface = r.ray
          .intersectObject(r.splat)
          .find((h) => h.distance >= 0.3);
        const entry = {
          camera: r.camera.position.toArray(),
          target: target.toArray(),
          distance: hit?.distance,
          surface: surface?.distance,
          reachable: r.evidenceInReach() === id,
        };
        if (
          !best ||
          (entry.reachable && !best.reachable) ||
          (entry.reachable === best.reachable &&
            (entry.distance ?? 100) < (best.distance ?? 100))
        )
          best = entry;
      }
      evidence.push({ id, ...best });
    }
    r.camera.position.fromArray(r.config.camera);
    const surfaces = [];
    for (let i = 0; i < 4; i++) {
      r.camera.rotation.set(-0.35, (i * Math.PI) / 2, 0, "YXZ");
      r.camera.updateMatrixWorld(true);
      for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) {
        const ray = new Raycaster();
        ray.setFromCamera(new Vector2(x, -0.3), r.camera);
        const hit = ray.intersectObject(r.splat).find((h) => h.distance >= 0.3);
        surfaces.push({
          yaw: (i * Math.PI) / 2,
          x,
          point: hit?.point.toArray(),
          distance: hit?.distance,
        });
      }
    }
    return { evidence, surfaces };
  });
  await writeFile('artifacts/reachability.json',JSON.stringify(calibration.evidence,null,2));
  console.log(calibration.evidence.map(e=>({id:e.id,reachable:e.reachable,distance:e.distance,surface:e.surface})));
  expect(calibration.evidence.every((e) => e.reachable)).toBe(true);
  expect(
    await page.evaluate(() =>
      [...window.roomlock.models.values()].every(
        (m) => !m.getObjectByName("marker").visible,
      ),
    ),
  ).toBe(true);
  const rangeCheck = await page.evaluate(async () => {
    const { Vector2, Vector3, Box3 } =
      await import("/node_modules/three/build/three.module.js");
    const r = window.roomlock;
    r.camera.position.set(0, 1.5, 2.08);
    const target = new Box3()
      .setFromObject(r.models.get("pocket-watch").userData.model)
      .getCenter(new Vector3());
    r.camera.lookAt(target);
    r.camera.updateMatrixWorld(true);
    r.ray.setFromCamera(new Vector2(), r.camera);
    return {
      distance: r.camera.position.distanceTo(target),
      hit: r.evidenceInReach(),
    };
  });
  expect(rangeCheck.distance).toBeGreaterThan(1.5);
  expect(rangeCheck.hit).toBeNull();
  for (const [index, evidence] of calibration.evidence.entries()) {
    await page.evaluate(async (e) => {
      const { Vector3 } =
        await import("/node_modules/three/build/three.module.js");
      const r = window.roomlock;
      r.camera.position.fromArray(e.camera);
      r.camera.lookAt(new Vector3(...e.target));
      r.yaw = r.camera.rotation.y;
      r.pitch = r.camera.rotation.x;
    }, evidence);
    await page.waitForFunction(id => window.roomlock.focused === id && !window.roomlock.blocked, evidence.id);
    await expect(page.locator(".inspect-prompt")).toBeVisible();
    if (index === 0)
      await page.screenshot({ path: "artifacts/evidence-in-reach.png" });
    await page.keyboard.press("KeyE");
    await expect(
      page.getByRole("button", { name: "Pin as evidence" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pin as evidence" }).click();
    if (index === 0)
      await expect(page.getByRole("button", { name: "Suspects" })).toHaveCount(
        0,
      );
    if (index === 1) {
      await expect(
        page.getByRole("button", { name: "Suspects" }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toContainText(
        "New lead: suspects unlocked",
      );
      await page.screenshot({ path: "artifacts/suspects-unlocked.png" });
      await page.getByRole("button", { name: "Suspects" }).click();
      await expect(
        page.getByRole("button", { name: "Accuse Mara" }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "Close panel" }).click();
    }
  }
  expect(await page.evaluate(() => window.roomlock.pinned.size)).toBe(6);
  await page.waitForFunction(() => [...window.roomlock.models.values()].every(group => !group.getObjectByName("glint")?.visible));
  const radius = await page.evaluate(() => {
    const r = window.roomlock;
    for (let i = 0; i < 30; i++) r.move(1, 1);
    return Math.hypot(
      r.camera.position.x - r.config.camera[0],
      r.camera.position.z - r.config.camera[2],
    );
  });
  expect(radius).toBeLessThanOrEqual(1.0001);
  await page.getByRole("button", { name: "Suspects" }).click();
  await page.getByRole("button", { name: "Accuse Theo" }).click();
  await expect(page.getByRole('alert')).toContainText('That alibi holds up');
  await page.getByRole("button", { name: "Accuse Mara" }).click();
  await expect(page.locator(".closed-screen")).toBeVisible({ timeout: 25000 });
  await writeFile(
    "artifacts/cleanup-check.json",
    JSON.stringify({ errors, initial, stricter, ...calibration }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        errors,
        initial,
        stricter,
        evidence: calibration.evidence,
        radius,
        caseClosed: true,
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
