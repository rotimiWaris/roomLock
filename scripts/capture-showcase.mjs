import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("public/media", { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const save = async (name, data) =>
  writeFile(
    `public/media/${name}.webp`,
    Buffer.from(data.split(",")[1], "base64"),
  );
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: true,
  });
  await page.goto("http://127.0.0.1:5174/?edit=1");
  await page.waitForFunction(() => !!window.roomlock, undefined, {
    timeout: 120000,
  });
  for (const [name, yaw, pitch] of [
    ["room-entry", 0, -0.12],
    ["room-corner", 1.6, -0.14],
    ["room-window", -1.3, -0.1],
  ]) {
    await page.evaluate(
      ({ yaw, pitch }) => {
        const r = window.roomlock;
        r.camera.rotation.set(pitch, yaw, 0, "YXZ");
        r.camera.updateMatrixWorld(true);
      },
      { yaw, pitch },
    );
    await page.waitForTimeout(1200);
    await save(
      name,
      await page.evaluate(() => {
        const r = window.roomlock;
        r.renderer.render(r.scene, r.camera);
        return r.renderer.domElement.toDataURL("image/webp", 0.88);
      }),
    );
    console.log(`Saved ${name}`);
  }
  await page.goto("about:blank");
  await page.route("**/__assetstage", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="margin:0"></body></html>',
    }),
  );
  await page.goto("http://127.0.0.1:5174/__assetstage");
  const data = await page.evaluate(async () => {
    const T = await import("/node_modules/three/build/three.module.js");
    const { GLTFLoader } =
      await import("/node_modules/three/examples/jsm/loaders/GLTFLoader.js");
    const { MeshoptDecoder } =
      await import("/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js");
    const renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(1200, 1400);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    document.body.append(renderer.domElement);
    const scene = new T.Scene();
    scene.add(new T.AmbientLight(0xb8bed5, 2.1));
    const key = new T.DirectionalLight(0xffd5ac, 5);
    key.position.set(-3, 5, 5);
    scene.add(key);
    const rim = new T.DirectionalLight(0xed4035, 4);
    rim.position.set(3, 2, -3);
    scene.add(rim);
    const fill = new T.DirectionalLight(0x809abf, 2);
    fill.position.set(2, 3, 3);
    scene.add(fill);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const model = (await loader.loadAsync("/models/archway-door.glb")).scene;
    const box = new T.Box3().setFromObject(model);
    const size = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    model.position.sub(center);
    const group = new T.Group();
    group.add(model);
    group.scale.setScalar(3.8 / size.y);
    group.rotation.y = -0.22;
    scene.add(group);
    const camera = new T.PerspectiveCamera(32, 1200 / 1400, 0.1, 100);
    camera.position.set(0, 0.2, 8.5);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    const result = renderer.domElement.toDataURL("image/webp", 0.94);
    renderer.dispose();
    return result;
  });
  await save("case-door", data);
  console.log("Saved case-door");
} finally {
  await browser.close();
}
