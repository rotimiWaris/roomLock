import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, hasTouch: true });
  page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('roomlock.scan.v1', JSON.stringify({ job: { worldId: 'fixture', token: 'mock-proof', startedAt: Date.now() - 650000 } })));
  let polls = 0, saves = 0;
  await page.route('**/api/scan?*', route => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'status') {
      polls++;
      return route.fulfill({ json: polls === 1 ? { status: 'RUNNING', progress: 0.37, raw: { status: 'RUNNING', progress: 0.37 } } : { status: 'SUCCEEDED', progress: 1, raw: { status: 'SUCCEEDED', progress: 1 } } });
    }
    if (action === 'save') {
      saves++;
      return saves === 1 ? route.fulfill({ status: 503, json: { error: 'Fixture: temporary storage connection failure' } }) : route.fulfill({ json: { url: '/rooms/room.mobile.spz', worldId: 'fixture', upAxis: 'Z' } });
    }
    return route.fulfill({ json: { ready: true } });
  });
  await page.goto('http://127.0.0.1:5174/?edit=1');
  await page.waitForFunction(() => !!window.roomlock, undefined, { timeout: 120000 });
  const defaults = await page.evaluate(() => window.roomlock.config.cleanup);
  expect(defaults.minOpacity).toBe(0.02); expect(defaults.maxScaleMultiple).toBe(10);
  await page.locator('.capture-footnote button').click();
  await expect(page.getByRole('heading', { name: 'Scan your room' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '0.37');
  await page.screenshot({ path: 'artifacts/scan-progress.png' });
  await expect(page.getByRole('alert')).toContainText('temporary storage connection failure', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Enter my room' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Enter my room' }).click();
  await page.waitForFunction(() => window.roomlock?.config.captured && window.roomlock.models.size === 6, undefined, { timeout: 120000 });
  await expect(page.getByRole('button', { name: 'Enter the room' })).toBeEnabled({ timeout: 120000 });
  await page.getByRole('button', { name: 'Enter the room' }).click();
  const loaded = await page.evaluate(() => ({ url: window.roomlock.config.url, count: window.roomlock.models.size, camera: window.roomlock.camera.position.toArray(), crop: window.roomlock.config.crop, mode: document.querySelector('.room-label').textContent }));
  expect(loaded.url).toBe('/rooms/room.mobile.spz'); expect(loaded.mode).toContain('Captured room');
  await page.locator('.editor').evaluate(el => el.style.display = 'none');
  await page.screenshot({ path: 'artifacts/scanned-room-playable.png' });
  await expect(page.locator('.game-dock')).toBeVisible();
  const reachable = await page.evaluate(async () => {
    const { Box3, Vector3, Vector2 } = await import('/node_modules/three/build/three.module.js');
    const r = window.roomlock;
    const results = [];
    for (const [id, group] of r.models) {
      const target = new Box3().setFromObject(group.userData.model).getCenter(new Vector3());
      let best = null;
      for (const radius of [0, 0.45, 0.89]) for (let i=0;i<32;i++) {
        const angle = i * Math.PI / 16;
        r.camera.position.set(Math.cos(angle)*radius,1.5,Math.sin(angle)*radius);
        r.constrain(r.camera.position); r.camera.lookAt(target); r.camera.updateMatrixWorld(true);
        r.ray.setFromCamera(new Vector2(0,0),r.camera);
        if(r.evidenceInReach() === id) best = {id,camera:r.camera.position.toArray(),target:target.toArray()};
      }
      results.push(best ?? {id,unreachable:true});
    }
    return results;
  });
  console.log('Auto-placement reachability',JSON.stringify(reachable));
  expect(reachable.every(item => !item.unreachable)).toBe(true);
  for(const item of reachable) {
    await page.evaluate(async item => {
      const {Vector3}=await import('/node_modules/three/build/three.module.js');const r=window.roomlock;
      r.camera.position.fromArray(item.camera);r.camera.lookAt(new Vector3(...item.target));r.yaw=r.camera.rotation.y;r.pitch=r.camera.rotation.x;
    },item);
    await page.waitForFunction(id=>window.roomlock.focused===id,item.id);
    await page.keyboard.press('KeyE');await page.getByRole('button',{name:'Pin as evidence'}).click();
  }
  await page.getByRole('button',{name:'Suspects'}).click();await page.getByRole('button',{name:'Accuse Mara'}).click();
  await expect(page.locator('.closed-screen')).toBeVisible({timeout:25000});
  await writeFile('artifacts/scan-flow-check.json', JSON.stringify({ defaults, polls, saves, loaded, reachable, errors, caseClosed:true }, null, 2));
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ defaults, polls, saves, loaded, errors }));
} finally { await browser.close(); }
