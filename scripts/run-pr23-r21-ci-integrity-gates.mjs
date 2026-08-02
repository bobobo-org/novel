import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function parseZip(buffer) {
  const endSignature = 0x06054b50;
  const minimumEnd = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumEnd; offset -= 1) {
    if (buffer.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  assert.notEqual(endOffset, -1, "ZIP end-of-central-directory record missing");
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  assert.ok(entryCount > 0 && entryCount <= 100, "ZIP entry count is unsafe");
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "ZIP central entry missing");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    const name = rawName.replaceAll("\\", "/");
    assert.equal(flags & 1, 0, `Encrypted ZIP entry is prohibited: ${name}`);
    assert.ok(method === 0 || method === 8, `Unsupported ZIP method: ${name}`);
    assert.ok(
      !name.startsWith("/")
      && !/^[A-Za-z]:/u.test(name)
      && !name.split("/").includes(".."),
      `Unsafe ZIP path: ${name}`,
    );
    assert.ok(uncompressedSize <= 2_000_000, `Oversized ZIP entry: ${name}`);
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, "ZIP local entry missing");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? compressed : inflateRawSync(compressed);
    assert.equal(content.length, uncompressedSize, `ZIP size mismatch: ${name}`);
    entries.push({ name, content });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function companionZipGate() {
  const zipRelative = "public/downloads/novel-local-ai-companion-v1.4.2.zip";
  const zip = fs.readFileSync(path.join(root, zipRelative));
  const checksumLine = fs.readFileSync(
    path.join(root, "public/downloads/novel-local-ai-companion-v1.4.2.sha256"),
    "ascii",
  ).trim();
  const expectedDigest = checksumLine.split(/\s+/u)[0].toLowerCase();
  assert.equal(sha256(zip), expectedDigest, "Companion ZIP checksum mismatch");
  const releaseSource = fs.readFileSync(
    path.join(root, "lib/novel-ai/providers/local-ollama/companion-release.ts"),
    "utf8",
  );
  assert.ok(
    releaseSource.includes(expectedDigest.toUpperCase()),
    "Companion release metadata checksum mismatch",
  );
  assert.ok(
    releaseSource.includes("novel-local-ai-companion-v1.4.2.zip"),
    "Companion release metadata filename mismatch",
  );
  const entries = parseZip(zip);
  const prefix = "novel-local-ai-companion-v1.4.2/";
  const sourceByEntry = new Map([
    [`${prefix}manifest.json`, "local-ai/companion/manifest.json"],
    [`${prefix}README.md`, "local-ai/companion/README.md"],
    [`${prefix}bridge/bridge-core.mjs`, "local-ai/bridge/bridge-core.mjs"],
    [`${prefix}bridge/launcher.mjs`, "local-ai/bridge/launcher.mjs"],
    [`${prefix}bridge/novel-local-ai.ps1`, "local-ai/bridge/novel-local-ai.ps1"],
    [`${prefix}bridge/origin-registry.mjs`, "local-ai/bridge/origin-registry.mjs"],
    [`${prefix}bridge/README.md`, "local-ai/bridge/README.md"],
    [`${prefix}bridge/server.mjs`, "local-ai/bridge/server.mjs"],
    [`${prefix}cache/cache-contract.mjs`, "local-ai/cache/cache-contract.mjs"],
    [`${prefix}cache/encrypted-cache-store.mjs`, "local-ai/cache/encrypted-cache-store.mjs"],
    [`${prefix}cache/sqlite-cache-store.mjs`, "local-ai/cache/sqlite-cache-store.mjs"],
    [`${prefix}private-hub/launcher.mjs`, "local-ai/private-hub/launcher.mjs"],
    [`${prefix}private-hub/novel-private-hub.ps1`, "local-ai/private-hub/novel-private-hub.ps1"],
    [`${prefix}private-hub/preference-model.mjs`, "local-ai/private-hub/preference-model.mjs"],
    [`${prefix}private-hub/learning-experience-ledger.mjs`, "local-ai/private-hub/learning-experience-ledger.mjs"],
    [`${prefix}private-hub/continuous-learning-coordinator.mjs`, "local-ai/private-hub/continuous-learning-coordinator.mjs"],
    [`${prefix}private-hub/README.md`, "local-ai/private-hub/README.md"],
    [`${prefix}private-hub/server.mjs`, "local-ai/private-hub/server.mjs"],
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.name).sort(),
    [...sourceByEntry.keys()].sort(),
    "Companion ZIP contains missing or unexpected files",
  );
  const credentialPatterns = [
    /vcp_[A-Za-z0-9]{24,}/gu,
    /sbp_[a-f0-9]{32,}/giu,
    /gh[pousr]_[A-Za-z0-9]{36,}/gu,
    /sk-[A-Za-z0-9]{32,}/gu,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  ];
  let credentialHits = 0;
  for (const entry of entries) {
    const source = fs.readFileSync(path.join(root, sourceByEntry.get(entry.name)));
    assert.ok(entry.content.equals(source), `Companion source mismatch: ${entry.name}`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(entry.content);
    for (const pattern of credentialPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) credentialHits += 1;
    }
  }
  assert.equal(credentialHits, 0, "Companion ZIP contains a credential pattern");
  const manifest = JSON.parse(
    entries.find((entry) => entry.name === `${prefix}manifest.json`).content
      .toString("utf8"),
  );
  assert.equal(manifest.bindAddress, "127.0.0.1");
  assert.equal(manifest.lanAccess, false);
  assert.equal(manifest.telemetry, false);
  assert.equal(manifest.firewallMutation, false);
  assert.equal(manifest.installer, false);
  return {
    schemaVersion: "pr23-r2-1-companion-zip-content-v1",
    status: "PASS",
    sha256: expectedDigest,
    entryCount: entries.length,
    unexpectedEntries: 0,
    sourceMismatches: 0,
    credentialHits,
  };
}

function evidenceSchemaGate() {
  const live = readJson("artifacts/closed-ai-live-model/live-model-results.json");
  const remote = readJson("artifacts/closed-ai-runtime-r2/remote-preview-gate.json");
  const secretScan = readJson("artifacts/p24b-ci/secret-scan-results.json");
  assert.equal(live.schemaVersion, "closed-ai-live-model-results-v1");
  assert.equal(live.fail, 0);
  assert.ok(live.pass > 0);
  assert.ok(live.localModel.modelId);
  assert.match(live.localModel.modelDigest, /^[a-f0-9]{64}$/u);
  assert.match(live.localBridgeVerification.outputDigest, /^[a-f0-9]{64}$/u);
  assert.equal(live.externalAiCalls, 0);
  assert.equal(live.dataLeftDevice, false);
  assert.ok(
    live.networkDestinations.every((destination) =>
      /^127\.0\.0\.1:\d+$/u.test(destination)),
  );
  const generated = live.results.find((result) =>
    result.name.includes("real Private Hub model"));
  assert.equal(generated?.status, "PASS");
  assert.ok(generated?.evidence?.outputChars > 0);
  assert.equal(remote.schemaVersion, "closed-ai-runtime-r2-remote-preview-gate-v1");
  assert.equal(remote.status, "PASS");
  assert.equal(remote.browserGate.execution.externalRequest, false);
  assert.equal(remote.browserGate.execution.dataLeftDevice, false);
  assert.ok(remote.browserGate.execution.candidateCharacters > 0);
  assert.match(remote.browserGate.execution.contentDigest, /^[a-f0-9]{64}$/u);
  assert.equal(secretScan.status, "PASS");
  assert.equal(secretScan.trueCredentialHits, 0);
  return {
    schemaVersion: "pr23-r2-1-evidence-schema-verification-v1",
    status: "PASS",
    modelId: live.localModel.modelId,
    modelDigest: live.localModel.modelDigest,
    outputDigest: live.localBridgeVerification.outputDigest,
    externalRequest: false,
    dataLeftDevice: false,
    generatedOutputCharacters: generated.evidence.outputChars,
    trueCredentialHits: secretScan.trueCredentialHits,
  };
}

const result = mode === "companion-zip"
  ? companionZipGate()
  : mode === "evidence-schema"
    ? evidenceSchemaGate()
    : null;
if (!result) {
  throw new Error("Usage: run-pr23-r21-ci-integrity-gates.mjs companion-zip|evidence-schema");
}
console.log(JSON.stringify(result, null, 2));
