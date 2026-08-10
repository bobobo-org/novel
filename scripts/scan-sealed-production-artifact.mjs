import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const RECEIPT_SCHEMA = "p24b-rc6.2-sealed-secret-scan-receipt-v1";
const STATIC_PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu, 0],
  ["openai-key", /\bsk-[A-Za-z0-9_-]{20,}\b/gu, 0],
  ["xai-key", /\bxai-[A-Za-z0-9_-]{20,}\b/gu, 0],
  ["github-token", /\bgh[opusr]_[A-Za-z0-9]{30,}\b/gu, 0],
  ["vercel-token", /\bvcp_[A-Za-z0-9]{20,}\b/gu, 0],
  ["supabase-token", /\bsbp_[A-Za-z0-9]{20,}\b/gu, 0],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}\b/gu, 0],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, 0],
  ["authorization-bearer", /\bBearer[ \t]+([A-Za-z0-9._~+/=-]{24,})/gu, 1],
  ["cookie-secret", /\bCookie:[ \t]*[A-Za-z0-9_.-]+=([^;\s]{20,})/giu, 1],
];
const CREDENTIAL_NAME = /(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|SESSION|SERVICE_ROLE|PRIVATE)/iu;
const CONNECTION_CREDENTIAL_NAME = /(?:^|_)(?:URL|URI|DSN)$/iu;
const PUBLIC_CREDENTIAL_NAME = /^(?:NEXT_PUBLIC_)?SUPABASE_(?:ANON|PUBLISHABLE)_KEY$/iu;
const NEVER_ALLOWLIST_KINDS = new Set([
  "private-key",
  "openai-key",
  "xai-key",
  "github-token",
  "vercel-token",
  "supabase-token",
  "google-api-key",
  "aws-access-key",
  "cookie-secret",
  "service-role-jwt",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeFingerprint(value) {
  return sha256(Buffer.from(String(value), "utf8")).slice(0, 16);
}

function jwtRole(value) {
  const parts = String(value).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role ?? null;
  } catch {
    return null;
  }
}

function isApprovedPublicCredential(name, value) {
  if (!PUBLIC_CREDENTIAL_NAME.test(name)) return false;
  if (/PUBLISHABLE_KEY$/iu.test(name)) return /^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(value);
  return jwtRole(value) === "anon";
}

function connectionStringContainsCredential(value) {
  const source = String(value || "");
  try {
    const parsed = new URL(source);
    if (parsed.password) return true;
    for (const [name, candidate] of parsed.searchParams) {
      if (/(?:token|key|secret|password|credential|auth|session)/iu.test(name) && candidate) return true;
    }
  } catch {
    // Non-URL DSNs are covered by the bounded credential-bearing forms below.
  }
  return /:\/\/[^/\s:@]+:[^@\s/]+@/u.test(source)
    || /(?:^|[;\s])(?:password|pwd|token|secret|key)\s*=\s*[^;\s]{4,}/iu.test(source);
}

function isConfiguredCredential(name, value) {
  return CREDENTIAL_NAME.test(name)
    || (CONNECTION_CREDENTIAL_NAME.test(name) && connectionStringContainsCredential(value));
}

function minimumCredentialLength(name) {
  return /(?:PASSWORD|SECRET|TOKEN|SERVICE_ROLE|CREDENTIAL|(?:^|_)(?:API|ACCESS|SIGNING|ENCRYPTION)_KEY(?:$|_))/iu.test(name)
    ? 1
    : 12;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function parseEnvironmentFile(source) {
  const values = [];
  for (const rawLine of String(source || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value.length >= minimumCredentialLength(match[1]) && isConfiguredCredential(match[1], value)) {
      values.push({ name: match[1], value });
    }
  }
  return values;
}

export function collectCredentialValues({ env = process.env, envFiles = [] } = {}) {
  const candidates = [];
  const allowlistedFingerprints = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (isApprovedPublicCredential(name, String(value || ""))) {
      allowlistedFingerprints.add(safeFingerprint(String(value)));
    } else if (isConfiguredCredential(name, String(value || ""))
      && String(value || "").length >= minimumCredentialLength(name)) {
      candidates.push({ name, value: String(value) });
    }
  }
  for (const envFile of envFiles) {
    if (!existsSync(envFile)) throw new Error(`SECRET_SCAN_ENV_FILE_MISSING:${safeFingerprint(resolve(envFile))}`);
    const source = readFileSync(envFile, "utf8");
    for (const rawLine of String(source).split(/\r?\n/u)) {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(rawLine.trim());
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (isApprovedPublicCredential(match[1], value)) {
        allowlistedFingerprints.add(safeFingerprint(value));
      }
    }
    candidates.push(...parseEnvironmentFile(source).filter(({ name, value }) => (
      !isApprovedPublicCredential(name, value)
    )));
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const fingerprint = safeFingerprint(candidate.value);
    if (!unique.has(fingerprint)) unique.set(fingerprint, { ...candidate, fingerprint });
  }
  return { credentialValues: [...unique.values()], allowlistedFingerprints };
}

function entropy(value) {
  const frequencies = new Map();
  for (const character of value) frequencies.set(character, (frequencies.get(character) || 0) + 1);
  return [...frequencies.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
}

function isServiceRoleJwt(value) {
  return jwtRole(value) === "service_role";
}

export function scanCredentialBytes(buffer, {
  credentialValues = [],
  allowlistedFingerprints = new Set(),
  sourcePath = "artifact",
} = {}) {
  const bytes = Buffer.from(buffer);
  const text = bytes.toString("latin1");
  const findings = [];
  const seen = new Set();
  const rawSourcePath = String(sourcePath || "artifact");
  const sourceKind = rawSourcePath.startsWith("archive-header:")
    ? "archive-header"
    : rawSourcePath.startsWith("archive:")
      ? "archive-content"
      : "filesystem";
  const classifiedPath = rawSourcePath.replace(/^archive(?:-header)?:/u, "").replaceAll("\\", "/");
  const sourceFingerprint = safeFingerprint(rawSourcePath);
  const source = {
    sourcePath: `${sourceKind}:${sourceFingerprint}`,
    sourceKind,
    sourceFingerprint,
    sourceMap: /\.map$/iu.test(classifiedPath),
    workerSurface: /manual-learning-worker|(?:^|\/)worker(?:[./-]|$)/iu.test(classifiedPath),
    clientSurface: /(?:^|\/)(?:public|static)(?:\/|$)/iu.test(classifiedPath)
      || /\.next\/static\//iu.test(classifiedPath)
      || /manual-learning-worker/iu.test(classifiedPath),
  };
  const add = (kind, value, credentialName = null) => {
    const fingerprint = safeFingerprint(value);
    const credentialNameFingerprint = credentialName ? safeFingerprint(credentialName) : null;
    if (allowlistedFingerprints.has(fingerprint) && !NEVER_ALLOWLIST_KINDS.has(kind)) return;
    const key = `${kind}:${credentialNameFingerprint || ""}:${fingerprint}:${sourceFingerprint}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ ...source, kind, credentialNameFingerprint, fingerprint });
  };
  for (const [kind, pattern, capture] of STATIC_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) add(kind, match[capture]);
  }
  const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
  for (const match of text.matchAll(jwtPattern)) {
    if (isServiceRoleJwt(match[0])) add("service-role-jwt", match[0]);
  }
  const contextualSecret = /\b(?:secret|token|password|authorization|cookie|service_role)[A-Za-z0-9_.-]*\s*[:=]\s*["']([A-Za-z0-9._~+/=-]{32,})["']/giu;
  for (const match of text.matchAll(contextualSecret)) {
    const candidate = match[1];
    if (/[A-Za-z]/u.test(candidate) && /[0-9]/u.test(candidate) && entropy(candidate) >= 4.3) {
      add("contextual-high-entropy-credential", candidate);
    }
  }
  for (const credential of credentialValues) {
    if (bytes.includes(Buffer.from(credential.value, "utf8"))) {
      add("configured-credential", credential.value, credential.name);
    }
  }
  return findings;
}

async function listFiles(target) {
  const info = statSync(target);
  if (info.isFile()) return [target];
  if (!info.isDirectory()) return [];
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => listFiles(resolve(target, entry.name))));
  return nested.flat();
}

function safeArchivePath(name) {
  const normalized = String(name || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) return false;
  return !normalized.split("/").includes("..");
}

function tarString(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  return buffer.subarray(start, end >= start && end < start + length ? end : start + length)
    .toString("utf8");
}

function parseTarSize(buffer, offset) {
  const raw = tarString(buffer, offset + 124, 12).trim().replaceAll("\0", "");
  if (!/^[0-7]*$/u.test(raw)) throw new Error("SEALED_ARCHIVE_TAR_SIZE_INVALID");
  return raw ? Number.parseInt(raw, 8) : 0;
}

export function scanTarArchiveBytes(archiveBytes, options = {}) {
  const archive = Buffer.from(archiveBytes);
  let tar;
  try {
    tar = archive[0] === 0x1f && archive[1] === 0x8b ? gunzipSync(archive) : archive;
  } catch {
    throw new Error("SEALED_ARCHIVE_GZIP_INVALID");
  }
  const findings = [];
  const contentDigests = [];
  let fileCount = 0;
  let byteCount = 0;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const archivePath = prefix ? `${prefix}/${name}` : name;
    if (!safeArchivePath(archivePath)) throw new Error("SEALED_ARCHIVE_PATH_INVALID");
    const size = parseTarSize(tar, offset);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (!Number.isSafeInteger(size) || size < 0 || contentEnd > tar.length) {
      throw new Error("SEALED_ARCHIVE_TRUNCATED");
    }
    const type = String.fromCharCode(header[156] || 48);
    findings.push(...scanCredentialBytes(header, {
      ...options,
      sourcePath: `archive-header:${archivePath}`,
    }));
    const content = tar.subarray(contentStart, contentEnd);
    if (content.length) {
      findings.push(...scanCredentialBytes(content, {
        ...options,
        sourcePath: `archive:${archivePath}`,
      }));
    }
    if (type === "0" || type === "\0" || type === "7") {
      contentDigests.push(`${archivePath}\0${size}\0${sha256(content)}`);
      fileCount += 1;
      byteCount += size;
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return {
    findings,
    fileCount,
    byteCount,
    contentDigest: sha256(Buffer.from(contentDigests.sort().join("\n"), "utf8")),
  };
}

export async function scanSealedProductionArtifact({
  roots = [],
  archivePath = null,
  envFiles = [],
  env = process.env,
  expectedArchiveDigest = null,
  priorReceipt = null,
  scannedAt = new Date().toISOString(),
} = {}) {
  if (!roots.length && !archivePath) throw new Error("SECRET_SCAN_SCOPE_EMPTY");
  const credentials = collectCredentialValues({ env, envFiles });
  const findings = [];
  const filesystemEntries = [];
  let fileCount = 0;
  let byteCount = 0;
  for (const root of roots) {
    const rootPath = resolve(root);
    if (!existsSync(rootPath)) throw new Error(`SECRET_SCAN_ROOT_MISSING:${safeFingerprint(rootPath)}`);
    const files = (await listFiles(rootPath)).sort();
    for (const file of files) {
      const bytes = await readFile(file);
      const displayPath = statSync(rootPath).isFile()
        ? basename(rootPath)
        : `${basename(rootPath)}/${relative(rootPath, file).split(sep).join("/")}`;
      findings.push(...scanCredentialBytes(bytes, { ...credentials, sourcePath: displayPath }));
      filesystemEntries.push(`${displayPath}\0${bytes.length}\0${sha256(bytes)}`);
      fileCount += 1;
      byteCount += bytes.length;
    }
  }
  let archiveSha256 = null;
  let archiveContentDigest = null;
  if (archivePath) {
    const archive = await readFile(archivePath);
    archiveSha256 = sha256(archive);
    if (expectedArchiveDigest && archiveSha256 !== expectedArchiveDigest.toLowerCase()) {
      throw new Error("SEALED_ARCHIVE_DIGEST_MISMATCH");
    }
    const scanned = scanTarArchiveBytes(archive, credentials);
    findings.push(...scanned.findings);
    archiveContentDigest = scanned.contentDigest;
    fileCount += scanned.fileCount;
    byteCount += scanned.byteCount;
  }
  if (priorReceipt) {
    const prior = typeof priorReceipt === "string" ? JSON.parse(priorReceipt) : priorReceipt;
    if (prior?.schemaVersion !== RECEIPT_SCHEMA
      || prior?.status !== "PASS"
      || prior?.trueCredentialHits !== 0
      || prior?.clientCredentialHits !== 0
      || prior?.sourceMapCredentialHits !== 0
      || prior?.workerCredentialHits !== 0
      || prior?.rawCredentialValuesStored !== false
      || prior?.archiveSha256 !== archiveSha256
      || !/^[0-9a-f]{64}$/u.test(String(prior?.receiptDigest || ""))) {
      throw new Error("PREUPLOAD_SECRET_SCAN_RECEIPT_INVALID");
    }
    const expectedReceiptDigest = sha256(Buffer.from(JSON.stringify(stableValue({
      ...prior,
      receiptDigest: undefined,
    })), "utf8"));
    if (prior.receiptDigest !== expectedReceiptDigest) {
      throw new Error("PREUPLOAD_SECRET_SCAN_RECEIPT_DIGEST_INVALID");
    }
  }
  const sourceMapCredentialHits = findings.filter(({ sourceMap }) => sourceMap).length;
  const workerCredentialHits = findings.filter(({ workerSurface }) => workerSurface).length;
  const clientCredentialHits = findings.filter(({ clientSurface }) => clientSurface).length;
  const core = {
    schemaVersion: RECEIPT_SCHEMA,
    status: findings.length ? "FAIL" : "PASS",
    scannedAt: new Date(scannedAt).toISOString(),
    scanMode: roots.length && archivePath ? "filesystem-and-sealed-archive" : archivePath ? "sealed-archive" : "filesystem",
    scope: roots.map((_root, index) => `filesystem-root-${index + 1}`)
      .concat(archivePath ? ["sealed-production-prebuilt"] : []),
    fileCount,
    byteCount,
    filesystemContentDigest: roots.length
      ? sha256(Buffer.from(filesystemEntries.sort().join("\n"), "utf8"))
      : null,
    archiveSha256,
    archiveContentDigest,
    trueCredentialHits: findings.length,
    clientCredentialHits,
    sourceMapCredentialHits,
    workerCredentialHits,
    findings,
    configuredCredentialFingerprintCount: credentials.credentialValues.length,
    publicValueAllowlistFingerprintCount: credentials.allowlistedFingerprints.size,
    rawCredentialValuesStored: false,
  };
  return {
    ...core,
    receiptDigest: sha256(Buffer.from(JSON.stringify(stableValue(core)), "utf8")),
  };
}

function parseArguments(argv) {
  const options = { roots: [], envFiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (["--root", "--env-file", "--archive", "--expected-digest", "--prior-receipt", "--report"].includes(flag) && !value) {
      throw new Error(`MISSING_ARGUMENT_VALUE:${flag}`);
    }
    if (flag === "--root") options.roots.push(value);
    else if (flag === "--env-file") options.envFiles.push(value);
    else if (flag === "--archive") options.archivePath = value;
    else if (flag === "--expected-digest") options.expectedArchiveDigest = value;
    else if (flag === "--prior-receipt") options.priorReceiptPath = value;
    else if (flag === "--report") options.reportPath = value;
    else throw new Error(`UNKNOWN_ARGUMENT:${flag}`);
    index += 1;
  }
  if (!options.reportPath) throw new Error("SECRET_SCAN_REPORT_PATH_REQUIRED");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const priorReceipt = options.priorReceiptPath
    ? await readFile(options.priorReceiptPath, "utf8")
    : null;
  const receipt = await scanSealedProductionArtifact({ ...options, priorReceipt });
  await writeFile(options.reportPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: receipt.status,
    scanMode: receipt.scanMode,
    fileCount: receipt.fileCount,
    byteCount: receipt.byteCount,
    trueCredentialHits: receipt.trueCredentialHits,
    archiveSha256: receipt.archiveSha256,
    receiptDigest: receipt.receiptDigest,
    rawCredentialValuesStored: false,
  }));
  if (receipt.status !== "PASS") throw new Error("SEALED_ARTIFACT_CREDENTIAL_DISCLOSURE_DETECTED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "sealed_secret_scan_failed",
      errorCode: String(error?.code || error?.message || "UNKNOWN_SECRET_SCAN_ERROR"),
      rawCredentialValuesStored: false,
    }));
    process.exitCode = 1;
  });
}
