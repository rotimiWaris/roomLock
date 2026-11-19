import { readdir, readFile, writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
await MeshoptDecoder.ready;
const result = [];
for (const name of (await readdir("public/models")).filter((n) =>
  n.endsWith(".glb"),
)) {
  const bytes = await readFile(`public/models/${name}`);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length).trim());
  const document = await io.read(`public/models/${name}`);
  const textures = [];
  for (const texture of document.getRoot().listTextures()) {
    const info = await sharp(texture.getImage()).metadata();
    if (info.width > 1024 || info.height > 1024)
      throw Error(`Oversized texture: ${name}`);
    if (texture.getMimeType() !== "image/webp")
      throw Error(`Texture is not WebP: ${name}`);
    textures.push({
      width: info.width,
      height: info.height,
      mime: texture.getMimeType(),
    });
  }
  if (!json.extensionsUsed?.includes("EXT_meshopt_compression"))
    throw Error(`Missing meshopt compression: ${name}`);
  if (!document.getRoot().listMeshes().length)
    throw Error(`No meshes: ${name}`);
  result.push({
    name,
    bytes: bytes.length,
    under3MB: bytes.length < 3000000,
    meshoptDecoded: true,
    textures,
  });
}
await writeFile(
  "assets/model-validation.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
