# RoomLock implementation report

All eight original GLBs are stored in `assets/raw/`. All web copies use 1024 px WebP textures and meshopt compression. Every web model is below 0.51 MB.

| Model | Original MB | Web MB | Task ID |
| --- | ---: | ---: | --- |
| archway-door.glb | 10.41 | 0.45 | 8253011 |
| cracked-vase.glb | 7.50 | 0.25 | 8251117 |
| heirloom.glb | 10.20 | 0.49 | 8253491 |
| jewelry-box.glb | 13.11 | 0.29 | 8252692 |
| muddy-boot.glb | 12.67 | 0.45 | 8249889 |
| music-box.glb | 8.25 | 0.45 | 8251777 |
| pocket-watch.glb | 11.09 | 0.44 | 8252200 |
| torn-letter.glb | 9.45 | 0.50 | 8251478 |

Total: 82.67 MB original → 3.33 MB web.

The original 866,257-splat capture remains in `public/rooms/room.spz`. Desktop uses a 10.71 MB / 627,448-splat cropped copy; touch devices use a 5.48 MB / 313,724-splat copy. Both preserve directional color coefficients. Runtime filtering removes low-opacity and oversized splats while preserving the color data of each surviving splat. Room transforms, cleanup thresholds, crop bounds, movement limits, evidence positions, and finale placement are configurable in `public/rooms/room.json`.

The camera starts at 1.5 scene units high and stays inside a one-unit horizontal radius during investigation. Splats inside 0.3 units of the camera are hidden. sRGB output and no tone mapping are used; the flashlight does not add brightness to splats. The editor exposes live opacity and median-scale sliders.

Evidence uses normal material brightness, soft contact shadows, and faint periodic glints until pinned. Surface-click placements were saved for all six clues. Inspection requires aiming at visible geometry within 1.5 units. Rings appear only after pinning, and Suspects unlocks after two original clues. Cleanup defaults are minimum opacity 0.02 and maximum scale 10 times the median; editor changes persist locally per room.

Scan your room compresses the first 60 seconds in the browser to silent H.264 at 15 fps, with a 1280-pixel long edge and below 10 MB. Video uploads first to public Blob storage. The server validates and downloads the MP4, uploads it using the Aholo asset SDK in the com region, and passes only its holo-cos URL to reconstruction. Completed SPZ files stream into Vercel Blob, then load as playable rooms with automatically fitted camera, crop, and evidence positions.

## Verification

- The landing page includes a captured-room gallery with three real in-game stills, fullscreen previews, and case launch links. Cinzel, Space Grotesk, Inter, and Geist Mono loaded successfully in browser checks. Desktop and 390 px / 320 px phone layouts have no horizontal overflow; gallery switching, preview navigation, and launching from the footer pass.
- Production type check and build pass.
- Nineteen automated tests cover status classification, task token protection, prompt validation, account concurrency, credential redaction, direct-upload verification, reconstruction progress, and streamed room storage.
- The revised encoder passed a real phone-orientation fixture: 720 by 1280 portrait output, H.264 High profile, yuv420p, 15 fps, no audio, and moov before mdat. A nine-second clip was rejected. The resulting MP4 uploaded through public Blob storage and the server-side Aholo asset SDK, which returned a holo-cos URL. FAILED-world recovery clears the old session and stops polling.
- Real browser compression trimmed a 65-second clip to 60 seconds, removed audio, produced H.264 at 15 fps and 8.65 MB, and emitted real progress events. A real multipart upload of that clip to Aholo passed without submitting a reconstruction job.
- The scan browser flow passed simulated provider progress, a storage failure and retry, loading a captured room, reaching all six clues, and case completion.
- Live Blob verification passed: an existing completed room was streamed to storage, downloaded, reused on retry, and loaded from its public URL in the game with all six evidence objects, camera height 1.5, and no browser errors.
- Browser checks cover all six raycast inspections and pins, timeline entries, locked accusations before four clues, wrong-answer retry, room reactions, and case completion.
- Cleanup regression checks pass: both live sliders remove and restore splats, all six smaller clues remain reachable, distant inspection is rejected, pre-discovery markers are hidden, Suspects unlocks at two original pins, and movement remains inside the configured radius. The complete case finishes with no browser errors.
- Mobile browser emulation verifies the reduced room, controls, and live placement.
- Live status, direct CDN download, GLB decoding, and placement were tested using a completed provider task; this verification did not submit an extra generation.
- Every optimized GLB was decoded and its texture format and dimensions checked.
- Source, generated client files, and local response logs were checked for the configured credential; none contained it.

## Practical limits

- Vercel configuration is provided; deployment has not been performed.
- An existing successful reconstruction was saved to live Blob storage and downloaded successfully (14,619,347 bytes); save retries reused its permanent URL. A fresh video-to-reconstruction run has not been performed through this UI. Keep the page open to save finished rooms; polling has no background scheduler. Automatically fitted rooms may need adjustments in edit mode.
- Phone checks used browser emulation, not a physical handset.
- The captured room contains reconstruction artifacts; the crop removes material outside its bounds but does not repair capture quality.
- The SPZ contains no capture-camera trajectory. The central start is manually calibrated, not a recovered camera pose. Some white streaks remain in the reconstruction; stronger cleanup can also remove valid surfaces.
- Live models retain their original size; only prepared models are optimized offline.
- The one-job account limit is respected. There is no durable queue; a busy request asks the player to wait and retry.
- Generation timers include client-observed waiting and interruptions; they are not provider compute-time measurements.

Run `npm run dev` for the local game. See README.md for preparation, editing, and deployment instructions.
