import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { uploadVideoToAholo, readScan } from "../server/scan-service.mjs";
process.loadEnvFile(".env");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  page.on("requestfailed", (request) =>
    console.log(
      "Request failed:",
      new URL(request.url()).host,
      request.failure()?.errorText,
    ),
  );
  page.on("response", (response) => {
    if (
      response.url().includes("/api/scan") ||
      response.url().includes("blob.vercel-storage")
    )
      console.log(
        "Upload HTTP",
        response.status(),
        new URL(response.url()).host,
      );
  });
  await page.route("**/__pipeline", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("http://127.0.0.1:5174/__pipeline");
  console.log("Checking portrait MP4 encoding and minimum duration");
  const encoded = await page.evaluate(async () => {
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
    if (
      await f.exec([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=15",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440",
        "-t",
        "12",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "fixture.mp4",
      ])
    )
      throw Error("Fixture encode failed");
    if (
      await f.exec([
        "-i",
        "fixture.mp4",
        "-c",
        "copy",
        "-metadata:s:v:0",
        "rotate=90",
        "portrait.mp4",
      ])
    )
      throw Error("Rotation fixture failed");
    if (
      await f.exec(["-i", "fixture.mp4", "-t", "9", "-c", "copy", "short.mp4"])
    )
      throw Error("Short fixture failed");
    const file = new File([await f.readFile("portrait.mp4")], "portrait.mp4", {
      type: "video/mp4",
    });
    const short = new File([await f.readFile("short.mp4")], "short.mp4", {
      type: "video/mp4",
    });
    f.terminate();
    const { compressVideo } = await import("/src/scan-client.ts");
    const events = [];
    const compressed = await compressVideo(
      file,
      (p) => events.push(p),
      () => {},
    );
    window.compressedScanFixture = compressed;
    const bytes = new Uint8Array(await compressed.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const atoms = [];
    for (let offset = 0; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset);
      if (size < 8) break;
      atoms.push(
        String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)),
      );
      offset += size;
    }
    const probe = await load();
    await probe.writeFile("encoded.mp4", bytes);
    await probe.ffprobe([
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "-o",
      "info.json",
      "encoded.mp4",
    ]);
    const info = JSON.parse(await probe.readFile("info.json", "utf8"));
    probe.terminate();
    let shortError = "";
    try {
      await compressVideo(
        short,
        () => {},
        () => {},
      );
    } catch (error) {
      shortError = error.message;
    }
    return {
      bytes: bytes.length,
      info,
      atoms,
      shortError,
      realProgress: events.some(
        (p) => p.stage === "Compressing" && p.fraction > 0 && p.fraction < 1,
      ),
    };
  });
  const stream = encoded.info.streams[0];
  expect(encoded.info.streams).toHaveLength(1);
  expect(stream.codec_name).toBe("h264");
  expect(stream.profile).toBe("High");
  expect(stream.pix_fmt).toBe("yuv420p");
  expect([stream.width, stream.height]).toEqual([720, 1280]);
  expect(stream.avg_frame_rate).toBe("15/1");
  expect(encoded.bytes).toBeLessThan(10000000);
  expect(encoded.realProgress).toBe(true);
  expect(encoded.atoms.indexOf("moov")).toBeLessThan(
    encoded.atoms.indexOf("mdat"),
  );
  expect(encoded.shortError).toContain("too short");
  console.log("Encoding passed; uploading the real MP4 to public Blob");
  const uploaded = await page.evaluate(async () => {
    const { uploadVideo } = await import("/src/scan-client.ts");
    const events = [];
    const result = await uploadVideo(window.compressedScanFixture, (p) =>
      events.push(p),
    );
    return { ...result, events };
  });
  const uploadData = readScan(
    uploaded.proof,
    "blob-upload",
    process.env.AHOLO_API_KEY,
  );
  const assetUrl = await uploadVideoToAholo(uploaded.url, uploadData);
  console.log("Public upload, server validation, and Aholo SDK upload passed");
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
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("roomlock.scan.v1")),
    ),
  ).toEqual({});
  await page.waitForTimeout(9000);
  expect(polls).toBe(1);
  const result = {
    encoded,
    upload: { url: uploaded.url, assetUrl, events: uploaded.events },
    failedWorldPolls: polls,
    newReconstructionSubmitted: false,
  };
  await writeFile(
    "artifacts/scan-pipeline-check.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      bytes: encoded.bytes,
      profile: stream.profile,
      dimensions: [stream.width, stream.height],
      faststart: true,
      shortClipRejected: true,
      publicUploadVerified: true,
      failedWorldPolls: polls,
    }),
  );
} finally {
  await browser.close();
}
