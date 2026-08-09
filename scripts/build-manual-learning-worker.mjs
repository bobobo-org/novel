import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "public", "generated", "manual-learning-worker.js");
const verifyOnly = process.argv.includes("--verify");

async function verifyWorkerAsset() {
  const source = await readFile(outputPath, "utf8");
  const bytes = Buffer.byteLength(source);
  assert.ok(bytes >= 500_000, `manual-learning worker is unexpectedly small: ${bytes} bytes`);
  assert.ok(bytes <= 3_500_000, `manual-learning worker exceeds its isolated asset budget: ${bytes} bytes`);
  assert.match(source, /LEARNING_FILE_MAGIC_MISMATCH/u);
  assert.match(source, /LEARNING_WORKER_DUPLICATE_REQUEST/u);
  assert.match(source, /prepare_import_file/u);
  assert.match(source, /manual-learning-worker-protocol-v2/u);
  assert.match(source, /addEventListener\("message"/u);
  assert.doesNotMatch(source, /sourceMappingURL=/u);
  assert.doesNotMatch(source, /[A-Z]:\\[^"'\s]+/u, "worker asset must not disclose a build-machine path");
  return {
    bytes,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
}

if (!verifyOnly) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: [
        'import "pdfjs-dist/legacy/build/pdf.worker.mjs";',
        'import "./lib/novel-ai/web/manual-learning.worker.ts";',
      ].join("\n"),
      loader: "ts",
      resolveDir: root,
      sourcefile: "manual-learning-worker-public-entry.ts",
    },
    outfile: outputPath,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["es2022"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    banner: {
      js: "/* worker-capability:splitManualLearningDocumentSemantically */",
    },
    treeShaking: true,
    metafile: true,
    logLevel: "warning",
  });
  const output = Object.values(result.metafile.outputs).find((entry) => entry.entryPoint);
  assert(output, "manual-learning worker build did not emit its entry asset");
  assert.equal(output.imports.length, 0, "manual-learning worker must be a self-contained demand asset");
}

const evidence = await verifyWorkerAsset();
console.log(JSON.stringify({
  schemaVersion: "manual-learning-public-worker-build-v1",
  status: "PASS",
  mode: verifyOnly ? "verify" : "build",
  output: "public/generated/manual-learning-worker.js",
  ...evidence,
}));
