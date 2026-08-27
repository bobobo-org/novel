import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const pnpmDirectory = path.join(root, "node_modules", ".pnpm");
const sharpPackage = (await readdir(pnpmDirectory, { withFileTypes: true }))
  .find((entry) => entry.isDirectory() && entry.name.startsWith("sharp@"));

if (!sharpPackage) throw new Error("Sharp is unavailable. Run the existing dependency install first.");

const sharpModule = path.join(
  pnpmDirectory,
  sharpPackage.name,
  "node_modules",
  "sharp",
  "lib",
  "index.js",
);
const { default: sharp } = await import(pathToFileURL(sharpModule).href);

async function convertDirectory(directory, { maxWidth, quality }) {
  const absoluteDirectory = path.join(root, "public", directory);
  const sources = (await readdir(absoluteDirectory))
    .filter((name) => name.endsWith(".png"))
    .sort();

  for (const sourceName of sources) {
    const source = path.join(absoluteDirectory, sourceName);
    const target = path.join(absoluteDirectory, sourceName.replace(/\.png$/u, ".webp"));
    const pipeline = sharp(source).rotate();
    if (maxWidth) pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    await pipeline.webp({ quality, effort: 6, smartSubsample: true }).toFile(target);
    process.stdout.write(`${directory}/${path.basename(target)}\n`);
  }
}

await convertDirectory("character-portraits", { quality: 80 });
await convertDirectory("item-icons", { maxWidth: 256, quality: 84 });

for (const size of [192, 512]) {
  const target = path.join(root, "public", `app-icon-${size}.png`);
  await sharp(path.join(root, "public", "app-icon.svg"))
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toFile(target);
  process.stdout.write(`app-icon-${size}.png\n`);
}
