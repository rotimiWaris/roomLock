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
  });
  page.setDefaultTimeout(30000);
  page.on("console", (message) => {
    if (message.type() === "error") console.log("Browser:", message.text());
  });
  await page.route("**/__scancheck", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>Compression verification</body></html>",
    }),
  );
  await page.goto("http://127.0.0.1:5174/__scancheck");
  console.log("Encoding a 65-second input, with audio, in the browser");
  const result = await page.evaluate(async () => {
    const { FFmpeg } =
      await import("/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js");
    const load = async () => {
      const f = new FFmpeg();
      const coreURL = URL.createObjectURL(
        new Blob(
          [await fetch("/ffmpeg/ffmpeg-core.js").then((r) => r.text())],
          { type: "text/javascript" },
        ),
      );
      await f.load({
        coreURL,
        wasmURL: new URL("/ffmpeg/ffmpeg-core.wasm", location.href).href,
      });
      URL.revokeObjectURL(coreURL);
      return f;
    };
    const f = await load();
    const generated = await f.exec([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "65",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "fixture.mp4",
    ]);
    if (generated) throw Error("Fixture creation failed: " + generated);
    const data = await f.readFile("fixture.mp4");
    const file = new File([data], "fixture.mp4", { type: "video/mp4" });
    f.terminate();
    const events = [];
    const { compressVideo } = await import("/src/scan-client.ts");
    const compressed = await compressVideo(
      file,
      (event) => events.push(event),
      () => {},
    );
    window.compressedScanFixture = compressed;
    const probe = await load();
    await probe.writeFile(
      "result.mp4",
      new Uint8Array(await compressed.arrayBuffer()),
    );
    await probe.ffprobe([
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "-o",
      "result.json",
      "result.mp4",
    ]);
    const info = JSON.parse(await probe.readFile("result.json", "utf8"));
    probe.terminate();
    return {
      bytes: compressed.size,
      info,
      eventCount: events.length,
      fractions: events
        .filter((e) => e.stage === "Compressing")
        .map((e) => e.fraction),
    };
  });
  expect(result.bytes).toBeLessThan(10000000);
  expect(Number(result.info.format.duration)).toBeLessThanOrEqual(60.1);
  expect(result.info.streams).toHaveLength(1);
  expect(result.info.streams[0].codec_name).toBe("h264");
  expect(result.info.streams[0].avg_frame_rate).toBe("15/1");
  expect(result.info.streams[0].width).toBeLessThanOrEqual(1280);
  expect(result.info.streams[0].height).toBeLessThanOrEqual(720);
  expect(result.fractions.some((value) => value > 0 && value < 1)).toBe(true);
  await writeFile(
    "artifacts/scan-compression-check.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      bytes: result.bytes,
      duration: result.info.format.duration,
      codec: result.info.streams[0].codec_name,
      fps: result.info.streams[0].avg_frame_rate,
      events: result.eventCount,
    }),
  );
  if (process.argv.includes("--live-upload")) {
    process.loadEnvFile(".env");
    const { readScan, uploadVideoToAholo } =
      await import("../server/scan-service.mjs");
    const upload = await page.evaluate(async () => {
      const { uploadVideo } = await import("/src/scan-client.ts");
      const events = [];
      const result = await uploadVideo(window.compressedScanFixture, (event) =>
        events.push(event),
      );
      return {
        ...result,
        stages: events.map((e) => ({ stage: e.stage, fraction: e.fraction })),
      };
    });
    const assetUrl = await uploadVideoToAholo(
      upload.url,
      readScan(upload.proof, "blob-upload", process.env.AHOLO_API_KEY),
    );
    delete upload.proof;
    upload.assetUrl = assetUrl;
    upload.completed = true;
    expect(upload.completed).toBe(true);
    await writeFile(
      "artifacts/scan-direct-upload-check.json",
      JSON.stringify(upload, null, 2),
    );
    console.log("Direct upload", JSON.stringify(upload));
  }
} finally {
  await browser.close();
}
