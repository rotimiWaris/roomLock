import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { Vector3, Euler } from "three";
const source = await readFile("public/rooms/room.spz");
const data = gunzipSync(source);
if (data.readUInt32LE(0) !== 0x5053474e || data.readUInt32LE(4) !== 2)
  throw new Error("Expected SPZ version 2.");
const count = data.readUInt32LE(8),
  degree = data[12];
const stride = 19 + 3 * ((degree + 1) ** 2 - 1);
if (data.length !== 16 + count * stride)
  throw new Error("Unexpected SPZ layout.");
const config = JSON.parse(await readFile("public/rooms/room.json", "utf8"));
const rotation = new Euler(...config.rotation);
const point = new Vector3();
const divisor = 2 ** data[13];
const inside = [];
for (let i = 0; i < count; i++) {
  const offset = 16 + i * 9;
  point.set(
    data.readIntLE(offset, 3) / divisor,
    data.readIntLE(offset + 3, 3) / divisor,
    data.readIntLE(offset + 6, 3) / divisor,
  );
  point
    .applyEuler(rotation)
    .multiplyScalar(config.scale)
    .add(new Vector3(...config.offset));
  if (
    point
      .toArray()
      .every(
        (n, axis) =>
          n >= config.crop.min[axis] - 0.5 && n <= config.crop.max[axis] + 0.5,
      )
  )
    inside.push(i);
}
const report = [];
for (const [name, step] of [
  ["web", 1],
  ["mobile", 2],
]) {
  const selected = inside.filter((_, i) => i % step === 0);
  const header = Buffer.from(data.subarray(0, 16));
  header.writeUInt32LE(selected.length, 8);
  let offset = 16;
  const chunks = [header];
  for (const width of [9, 1, 3, 3, 3, stride - 19].filter(Boolean)) {
    const part = Buffer.alloc(selected.length * width);
    selected.forEach((id, index) =>
      data.copy(
        part,
        index * width,
        offset + id * width,
        offset + (id + 1) * width,
      ),
    );
    chunks.push(part);
    offset += count * width;
  }
  const output = gzipSync(Buffer.concat(chunks));
  await writeFile(`public/rooms/room.${name}.spz`, output);
  report.push({
    variant: name,
    bytes: output.length,
    splats: selected.length,
    shDegree: degree,
  });
  console.log(
    JSON.stringify(
      {
        variant: name,
        originalBytes: source.length,
        webBytes: output.length,
        originalSplats: count,
        webSplats: selected.length,
      },
      null,
      2,
    ),
  );
}
await writeFile(
  "assets/room-sizes.json",
  JSON.stringify(report, null, 2) + "\n",
);
