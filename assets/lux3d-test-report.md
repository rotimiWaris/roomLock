# Single-object generation test

- Object: a single muddy leather boot.
- Model: G1, photorealistic, requested 30,000 faces, ZIP and GLB outputs.
- Task ID: 8249889.
- Result: succeeded; downloaded to `assets/muddy-boot.glb`.
- Generation completion observed after 406 seconds (6 minutes 46 seconds).
- Download and GLB validation complete after 415 seconds (6 minutes 55 seconds).
- File size: 12,666,548 bytes (12.67 MB, 12.08 MiB).
- Status responses recorded: 57.

## Observed response fields

The response envelope contains `f`, `c`, `m`, and `d`.
The task data contains `bizId`, `status`, `outputs`, and `taskId`.
The only observed progress field was `d.status`: 1 while running, then 3 on success.
No numeric percentage, progress fraction, stage name, queue position, or server timestamps appeared in this test.
The log timestamps and request timings are measured locally, not returned by the service.
While running, outputs contained two null entries. On success, outputs contained ZIP and GLB URLs.

## Errors and attempts

The initial sandboxed submission failed with `fetch failed`. An authenticated account task-list check returned zero tasks before retrying. The second submission succeeded with network access enabled. Only one remote generation job was created. No remote generation failure occurred.

## Interface implication

Use the actual status with an indeterminate generating indicator and a locally measured elapsed timer. Do not display a generation percentage. Download progress can use received bytes when the response exposes a reliable total length; otherwise show bytes received without a percentage. Queue position is not provided by these responses.

## Saved records

- `lux3d-status-log.json`: raw response bodies with credential redaction, plus local timing metadata.
- `task-ids.json`: attempts, task ID, timing, terminal status, and file size.

The remaining objects have not been generated. The script defaults to the boot test and skips a valid existing GLB. `node scripts/lux3d.mjs --remaining` runs the remaining seven objects sequentially.
