import { upload } from "@vercel/blob/client";

export type ScanProgress = {
  stage: string;
  fraction: number | null;
  detail: string;
};
export type ScanJob = { worldId: string; token: string; startedAt: number };
export type SavedRoom = { url: string; worldId: string; upAxis: "Y" | "Z" };
export type VideoUpload = { proof: string; url: string };
type UploadToken = { pathname: string; proof: string };
export async function scanRequest<T>(action: string, body: object): Promise<T> {
  const response = await fetch("/api/scan?action=" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(
      action === "save" || action === "start" || action === "recover"
        ? 300000
        : 60000,
    ),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error(`HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  if (!response.ok)
    throw Error(data.error ?? `Request failed: HTTP ${response.status}`);
  return data;
}

export async function compressVideo(
  file: File,
  update: (p: ScanProgress) => void,
  registerCancel: (cancel: () => void) => void,
) {
  update({
    stage: "Loading compressor",
    fraction: null,
    detail: "Preparing the video compressor on this device.",
  });
  const { FFmpeg, FFFSType } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  registerCancel(() => ffmpeg.terminate());
  const log: string[] = [];
  ffmpeg.on("log", ({ message }) => {
    log.push(message);
    if (log.length > 20) log.shift();
  });
  try {
    const core = await fetch("/ffmpeg/ffmpeg-core.js");
    if (!core.ok)
      throw Error(
        "The video compressor could not be downloaded. Reload and retry.",
      );
    const coreURL = URL.createObjectURL(
      new Blob([await core.text()], { type: "text/javascript" }),
    );
    try {
      await ffmpeg.load({
        coreURL,
        wasmURL: new URL("/ffmpeg/ffmpeg-core.wasm", location.href).href,
      });
    } finally {
      URL.revokeObjectURL(coreURL);
    }
    await ffmpeg.createDir("/input");
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, "/input");
    const input = "/input/" + file.name;
    const probe = await ffmpeg.ffprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=duration,width,height",
      "-of",
      "json",
      "-o",
      "metadata.json",
      input,
    ]);
    if (probe !== 0 && probe !== -1)
      throw Error(
        `Cannot read this video (${probe}): ` + log.slice(-6).join("\n"),
      );
    const info = JSON.parse(
      (await ffmpeg.readFile("metadata.json", "utf8")) as string,
    );
    if (
      !info.streams?.some(
        (stream: { width?: number; height?: number }) =>
          (stream.width ?? 0) > 0 && (stream.height ?? 0) > 0,
      )
    )
      throw Error("No readable video stream: " + log.slice(-6).join("\n"));
    const rawDuration = Number(
      info.format?.duration ??
        info.streams?.find((s: { duration?: string }) => Number(s.duration) > 0)
          ?.duration,
    );
    const knownDuration = Number.isFinite(rawDuration) && rawDuration > 0;
    if (knownDuration && rawDuration < 10)
      throw Error(
        "This clip is too short. Film your room slowly for at least 10 seconds; 20 to 60 seconds works best.",
      );
    const duration = knownDuration ? Math.min(rawDuration, 60) : 60;
    let attempt = 1;
    ffmpeg.on("progress", ({ time }) => {
      const seconds = Math.max(0, time / 1000000);
      update({
        stage: "Compressing",
        fraction: knownDuration ? Math.min(1, seconds / duration) : null,
        detail: `${Math.min(seconds, duration).toFixed(1)} seconds encoded${knownDuration ? ` of ${duration.toFixed(1)}` : ""} · pass ${attempt}${rawDuration > 60 ? " · using the first 60 seconds" : ""}`,
      });
    });
    let bitrate = Math.min(1800000, Math.floor((9000000 * 8) / duration));
    for (; attempt <= 3; attempt++) {
      update({
        stage: "Compressing",
        fraction: 0,
        detail: `Encoding H.264 at 15 fps · pass ${attempt}`,
      });
      const code = await ffmpeg.exec([
        "-i",
        input,
        "-t",
        "60",
        "-map",
        "0:v:0",
        "-vf",
        "scale=w='if(gte(iw,ih),1280,-2)':h='if(gte(iw,ih),-2,1280)',setsar=1,fps=15",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "high",
        "-map_metadata",
        "-1",
        "-b:v",
        String(bitrate),
        "-maxrate",
        String(bitrate),
        "-bufsize",
        String(bitrate * 2),
        "-an",
        "-sn",
        "-movflags",
        "+faststart",
        "room.mp4",
      ]);
      if (code !== 0)
        throw Error(
          `Compression failed (${code}): ` + log.slice(-8).join("\n"),
        );
      const data = (await ffmpeg.readFile("room.mp4")) as Uint8Array;
      if (data.length < 10000000) {
        await ffmpeg.ffprobe([
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          "-o",
          "output-metadata.json",
          "room.mp4",
        ]);
        const outputInfo = JSON.parse(
          (await ffmpeg.readFile("output-metadata.json", "utf8")) as string,
        );
        const outputDuration = Number(outputInfo.format?.duration);
        if (!Number.isFinite(outputDuration) || outputDuration < 10)
          throw Error(
            "This clip is too short or its duration could not be read. Film your room slowly for 20 to 60 seconds and try again.",
          );
        update({
          stage: "Compressed",
          fraction: 1,
          detail: `${(data.length / 1000000).toFixed(2)} MB · H.264 · 15 fps · no audio`,
        });
        return new File([new Uint8Array(data)], "room.mp4", {
          type: "video/mp4",
        });
      }
      bitrate = Math.floor(bitrate * Math.min(0.8, 8500000 / data.length));
      await ffmpeg.deleteFile("room.mp4");
    }
    throw Error(
      "The compressed video is still over 10 MB. Choose a shorter clip and retry.",
    );
  } finally {
    ffmpeg.terminate();
    registerCancel(() => {});
  }
}

export async function uploadVideo(
  file: File,
  update: (p: ScanProgress) => void,
): Promise<VideoUpload> {
  const token = await scanRequest<UploadToken>("upload", { size: file.size });
  update({
    stage: "Uploading",
    fraction: 0,
    detail: "Uploading your MP4 to public video storage.",
  });
  const saved = await upload(token.pathname, file, {
    access: "public",
    contentType: "video/mp4",
    handleUploadUrl: "/api/scan?action=blob-upload",
    clientPayload: token.proof,
    multipart: true,
    abortSignal: AbortSignal.timeout(120000),
    onUploadProgress: ({ loaded, total }) =>
      update({
        stage: "Uploading",
        fraction: total > 0 ? loaded / total : null,
        detail:
          (loaded / 1000000).toFixed(2) +
          " / " +
          (file.size / 1000000).toFixed(2) +
          " MB uploaded",
      }),
  });
  update({
    stage: "Checking video",
    fraction: null,
    detail: "Checking that the public MP4 is readable before reconstruction.",
  });
  return { proof: token.proof, url: saved.url };
}
