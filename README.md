# RoomLock: Case File

A playable mystery inside a captured room. Explore, inspect six objects, pin clues to a timeline, and identify who moved the missing heirloom. Solving the case reveals a passage and the necklace.

The original room and case objects are pre-generated with Aholo World and Lux3D because generation is slow. **Plant evidence** runs Lux3D live. **Scan your room** runs Aholo World live and plays the same mystery in the new capture. This is a fictional game, not a real forensic tool. Room scale is adjusted for navigation and is not a real-world measurement.

## Run locally

Use Node 24 or a supported recent Node release.

```sh
npm install
npm run dev
```

The room and prepared evidence work without credentials. For live generation, set `AHOLO_API_KEY` in an ignored `.env` file. The local development server and serverless functions read it on the server; the browser never receives it. Restart the development server after changing the key.

```sh
npm run build
npm test
```

For the browser regression check, start the preview with `npm run dev -- --port 5174`, then run `node scripts/game-check.mjs`. The check uses installed Microsoft Edge and does not submit generation jobs.

Desktop: WASD or arrow keys to move; drag to look; click objects to inspect. Double-click the scene for mouse look, press E to inspect the center target, and Escape to release the pointer. On phones, drag to look and tap the floor to walk; directional buttons are also available.

## Room and evidence

- `public/rooms/room.spz`: the original reconstructed room.
- `public/rooms/room.web.spz`: a cropped desktop copy with 627,448 splats (10.71 MB before runtime filtering).
- `public/rooms/room.mobile.spz`: a cropped copy for touch devices with 313,724 splats (5.48 MB before runtime filtering). Both preserve the capture's directional color coefficients; the original is unchanged.
- `public/rooms/room.json`: camera, room transform, crop bounds, walk bounds, evidence, path, and finale positions.
- `assets/raw/`: original generated GLBs, kept unchanged.
- `public/models/`: web copies with textures capped at 1024 px, WebP textures, and meshopt compression.
- `assets/model-sizes.json`: original and optimized byte counts.
- `assets/task-ids.json`: generation attempt records and task IDs, retained locally.
- `assets/lux3d-status-log.json`: redacted raw API responses and local timing metadata, retained locally because output URLs may be signed.

Open `/?edit=1` to select an evidence object, click a captured surface, and copy the resulting room configuration. Minimum-opacity and maximum-scale sliders filter the room live; maximum scale is a multiple of the median longest splat axis. Raise minimum opacity or lower maximum scale to remove more splats. Crop bounds and camera clearance are in the JSON and can also be applied live. Save the JSON to `public/rooms/room.json`; reload to apply other changes. Expanding the crop beyond the prepared margin requires running `node scripts/prepare-room.mjs` again. `/?practice=1` opens the explicitly labeled practice room.

The camera starts at a calibrated central viewpoint, 1.5 scene units above the floor, with a one-unit horizontal movement radius. The SPZ does not include the capture-camera trajectory, so this position is an approximation rather than a recovered camera pose. Splats inside 0.3 units of the camera are hidden. The scene uses sRGB output without tone mapping; the flashlight illuminates evidence meshes without adding brightness to the captured room.

Evidence uses approximate scene-scale dimensions (boot 30 cm, letter 20 cm, watch 5 cm), normal material brightness, and soft contact shadows. Unfound objects briefly glint every 5.5 seconds, staggered across the clues. Discovery rings appear after pinning. Aim at a visible object within 1.5 units to see “Inspect”; distant objects and objects behind captured surfaces cannot be inspected. Two original pinned clues reveal Suspects and activate the flashlight. Cleanup defaults are minimum opacity 0.02 and maximum scale 10 times the median. Editor adjustments also persist in this browser per room. Capture artifacts can remain after filtering, and aggressive thresholds can remove valid furniture detail.

## Landing page and captured rooms

The landing page has a captured-room gallery with three views of the current room, a fullscreen preview, case information, and game launch buttons. These are actual in-game stills of one capture, not three separate rooms or original phone footage. The door artwork is rendered from the case's existing model.

Gallery content is in `src/Landing.tsx`, with images in `public/media/` and layout styles in `src/landing.css`. The interface uses Cinzel for the title, Space Grotesk for section headings, Inter for body copy, and Geist Mono for labels. Fonts load from a hosted stylesheet, with local fallback fonts if unavailable.

To refresh the stills after changing the room, start the local server on port 5174 and run `node scripts/capture-showcase.mjs`. To check the landing page on desktop and narrow phone layouts, run `node scripts/design-check.mjs` against the same server.

## Asset preparation

```sh
node scripts/lux3d.mjs
node scripts/lux3d.mjs --remaining
npm run optimize
node scripts/prepare-room.mjs
```

The first command runs only the boot test. The remaining command generates the other seven objects sequentially. Valid downloaded files are skipped, interrupted tasks resume by ID, and each object has at most two submission attempts. An uncertain submission stops instead of silently creating a duplicate. The optimizer leaves originals untouched and skips current web copies.

## Live evidence

`POST /api/plant` starts a task. `GET /api/plant-status` polls using a signed, expiring task token. Status `1` means generating, `3` means succeeded, and all other statuses are displayed as failures with the raw response. The generating stage has an indeterminate indicator and elapsed time; the initial test took about seven minutes. Download progress reports received bytes and a percentage only when the download supplies its total length.

The browser downloads the returned GLB directly from the provider's CORS-enabled CDN, avoiding the serverless response-size limit. Live assets remain at their original size and are not run through the offline optimization pipeline. They may be heavier than the prepared evidence.

The account allows one generation at a time. Busy requests tell players to wait and retry; this version does not claim to provide a durable queue. Status connection failures retry automatically, and a saved task can be resumed after closing the panel. A submission connection failure can leave an uncertain task at the provider; the account is checked before another submission. Reloading does not preserve already planted objects or case progress.

Player-created objects are marked as extras. They can be inspected and pinned, but do not change the original case solution or count toward the four-clue accusation requirement.

## Scan your room

Connect a public Blob store to the deployment and set `BLOB_READ_WRITE_TOKEN` server-side alongside `AHOLO_API_KEY`. Add both to the ignored local `.env` for development. Restart the local server after changing credentials. The scan checks this configuration before spending time compressing.

Choose an MP4, MOV, or WebM file, or use the phone's record-video picker. Clips shorter than 10 seconds are rejected. Every new clip is compressed locally to H.264 High profile with yuv420p pixels, a 1280-pixel long edge, 15 fps, and no audio. Aspect ratio and displayed orientation are preserved, including phone rotation metadata. MP4 fast-start metadata is placed before the video data. Clips longer than 60 seconds use their first 60 seconds. Compression aims for 9 MB and checks the finished size, reducing the bitrate and re-encoding if needed; files at or above 10 MB never upload. Progress comes from processed timestamps reported by the encoder, divided by the trimmed duration. The compressor is downloaded only when needed, and its worker is released afterward.

`POST /api/scan?action=upload` reserves a unique video path. The browser uses a scoped client token from `action=blob-upload` to upload a public MP4 directly to Vercel Blob. Only small JSON metadata passes through `/api`. Before reconstruction, the server verifies the public URL with HEAD (HTTP 200, video/mp4, nonzero expected size), downloads the bytes, and uploads them server-side using `@manycore/aholo-sdk-asset` with `createAssetClient({ region: "com" })`. Only the SDK-returned HTTPS holo-cos URL is submitted as the video resource to `/global/world/v1/reconstructions`; Blob URLs are never passed to World. The exact reconstruction JSON body is written to server logs, prefixed with `Aholo reconstruction request`, without authentication headers or keys. Both credentials remain server-side.

World status is polled through `/api/scan?action=status`. Progress uses the provider's 0–1 fraction. Expect 10 minutes or longer. A completed capture immediately triggers `/api/scan?action=save`, which streams its SPZ into Blob and returns the permanent URL. Saving retries reuse an existing object. Keep the page open for prompt saving: there is no background scheduler while the browser is closed. The current job is stored locally and resumes when the scan panel reopens; job tokens expire after 24 hours. Provider download URLs can expire after roughly two hours, so a long interruption can prevent recovery.

A FAILED world clears its saved upload and world ID, shows re-filming guidance, and asks for a fresh clip instead of polling the failed job again. Connection failures retain status/save retry.

New rooms load their exact saved SPZ URL and respect the returned up-axis. Robust scene bounds provide an approximate central camera, crop, and navigation scale. Clues are automatically placed on nearby captured surfaces where available, with nearby floor positions as a fallback. The existing suspects, timeline, and ending are reused. Automatic placement is approximate and may need adjustment in `?edit=1` for unusual captures; it does not recover metric scale or the original capture path. Scanned rooms do not use the offline mobile reduction pipeline and can require more memory on phones.

Source videos and finished captures use unlisted public Blob URLs; anyone with a URL can read them. The server also uploads the video to Aholo. There is no scheduled retention cleanup. The browser's file picker can record video on supported phones; desktop users can choose existing recordings. Compression performance depends on the device and clip codec.

Local checks, with the development server on port 5174:

```sh
node scripts/scan-browser-check.mjs
node scripts/scan-flow-check.mjs
```

The first performs a real browser encode and checks trimming, codec, audio removal, frame rate, size, and progress. The second uses simulated provider/storage responses and a real local room to check progress, save retries, new-room loading, and case completion. `--live-upload` on the compression check additionally sends its test clip through Blob and the server-side Aholo asset SDK; it does not create a reconstruction job.

`node scripts/scan-pipeline-check.mjs` checks portrait orientation, High profile, fast-start placement, short-clip rejection, real Blob and server-side SDK upload, and recovery from a FAILED world. It does not create a reconstruction job.

`node scripts/scan-storage-check.mjs` saves an existing successful Aholo reconstruction to the configured Blob store, downloads it to verify its size, and checks that retrying reuses the saved room. It writes its result into ignored `artifacts/`. With the dev server on port 5174, `node scripts/scan-stored-room-check.mjs` then checks loading that actual Blob URL into the game. Neither check starts a new reconstruction.

## Saved rooms and editing

Completed captures are copied to Blob before their temporary download links expire. The browser keeps records in `roomlock.rooms` and the selected record in `roomlock.activeRoom`, including world ID, permanent Blob URL, creation time, source video filename, and up-axis. Reloading any URL, including `?edit=1`, restores the selected room. Existing completed scan sessions migrate into the library.

Use Saved rooms to select a capture or recover one by world ID. Recovery requests the current Aholo world details and copies an available SPZ into Blob; it cannot recover an expired source that is no longer available and was never saved. Delete room removes the record and its edits from this browser; online files remain available. Browser storage is local to this browser and origin.

Edit room and Play mode change the query with browser history without reloading the page or scene. Surface-click evidence placements, cleanup settings, applied room JSON, and the Save current camera as spawn action persist under `roomlock.edits.<worldId>`. Saved configurations bypass automatic room fitting and evidence placement. Failed saved-room loads display their world ID and a recovery option.

Run `node scripts/room-persistence-check.mjs` with the development server on port 5174 to verify restoration, mode switching, room selection, deletion, recovery, and saved-file errors using local room data.

## Vercel

Import this project, select the Vite preset, build with `npm run build`, and use `dist` as the output directory. Set `AHOLO_API_KEY` as a server environment variable. The `/api` directory contains the live generation functions. Never use a `VITE_` prefix for the secret. `.vercelignore` excludes local originals, logs, screenshots, and environment files.

This version has no logins, database, multiplayer, or automatic mystery writing. Anyone able to access the deployed generation endpoints can use the connected account's generation credits and Blob storage. Provider concurrency limits are enforced; no durable per-user quota is implemented.
