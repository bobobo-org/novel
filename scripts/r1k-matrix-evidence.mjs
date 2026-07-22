import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
export const newRunId = (prefix) => `${prefix}-${randomUUID().replaceAll("-", "")}`;
export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}
export async function sealEvidence({ sourceDir, bundleDir, metadata }) {
  await mkdir(bundleDir, { recursive: true });
  for (const name of await readdir(sourceDir)) {
    if (name === path.basename(bundleDir) || name === "immutable") continue;
    const source = path.join(sourceDir, name);
    try { await copyFile(source, path.join(bundleDir, name)); } catch { /* directories are not evidence files */ }
  }
  const excluded = new Set(["evidence-manifest.json", "checksums.sha256", "bundle-seal.json"]);
  const names = (await readdir(bundleDir)).filter((name) => !excluded.has(name)).sort();
  const records = [];
  for (const name of names) {
    const file = path.join(bundleDir, name);
    records.push({ file: name, bytes: (await readFile(file)).length, sha256: await sha256(file) });
  }
  const manifest = { schemaVersion: "r1k-matrix-evidence-manifest-v1", createdAt: new Date().toISOString(), ...metadata, records };
  await writeJson(path.join(bundleDir, "evidence-manifest.json"), manifest);
  await writeFile(path.join(bundleDir, "checksums.sha256"), `${records.map((row) => `${row.sha256}  ${row.file}`).join("\n")}\n`, "utf8");
  const seal = { schemaVersion: "r1k-matrix-bundle-seal-v1", sealedAt: new Date().toISOString(), manifestSha256: await sha256(path.join(bundleDir, "evidence-manifest.json")), checksumsSha256: await sha256(path.join(bundleDir, "checksums.sha256")), recordCount: records.length, mismatchCount: 0, status: "SEALED" };
  await writeJson(path.join(bundleDir, "bundle-seal.json"), seal);
  return seal;
}
