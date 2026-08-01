import { CLOUD_SYNC_SCHEMA_VERSION, type CloudProjectSnapshot, type EncryptedCloudSnapshot } from "./types";
import { assertCloudSnapshot, hashCloudRecords, stableCloudStringify } from "./snapshot";

const KEY_PREFIX = "ncs_";

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digestBytes(bytes: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer(bytes)));
}

async function digestHex(bytes: Uint8Array) {
  return [...await digestBytes(bytes)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

async function importEncryptionKey(syncKey: string) {
  const raw = parseCloudSyncKey(syncKey);
  const separated = await digestBytes(new Uint8Array([
    ...new TextEncoder().encode("novel-cloud-sync-aes-gcm-v1|"),
    ...raw,
  ]));
  return crypto.subtle.importKey("raw", arrayBuffer(separated), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function compress(bytes: Uint8Array): Promise<{ bytes: Uint8Array; compression: "gzip" | "none" }> {
  if (typeof CompressionStream === "undefined") return { bytes, compression: "none" };
  const stream = new Blob([arrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), compression: "gzip" };
}

async function decompress(bytes: Uint8Array, compression: "gzip" | "none") {
  if (compression === "none") return bytes;
  if (typeof DecompressionStream === "undefined") {
    throw Object.assign(new Error("此瀏覽器無法解壓縮雲端快照。"), {
      code: "CLOUD_SYNC_DECOMPRESSION_UNAVAILABLE",
    });
  }
  const stream = new Blob([arrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function createCloudSyncKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${KEY_PREFIX}${bytesToBase64Url(bytes)}`;
}

export function parseCloudSyncKey(value: string) {
  const normalized = value.trim();
  if (!/^ncs_[A-Za-z0-9_-]{43}$/u.test(normalized)) {
    throw Object.assign(new Error("雲端同步復原金鑰格式不正確。"), {
      code: "CLOUD_SYNC_KEY_INVALID",
      retryable: false,
    });
  }
  const bytes = base64UrlToBytes(normalized.slice(KEY_PREFIX.length));
  if (bytes.length !== 32) throw Object.assign(new Error("雲端同步復原金鑰長度不正確。"), {
    code: "CLOUD_SYNC_KEY_INVALID",
    retryable: false,
  });
  return bytes;
}

export async function cloudSyncOwnerId(syncKey: string) {
  return digestHex(new Uint8Array([
    ...new TextEncoder().encode("novel-cloud-sync-owner-v1|"),
    ...parseCloudSyncKey(syncKey),
  ]));
}

export async function encryptCloudSnapshot(
  snapshot: CloudProjectSnapshot,
  syncKey: string,
): Promise<EncryptedCloudSnapshot> {
  assertCloudSnapshot(snapshot);
  const plaintext = new TextEncoder().encode(stableCloudStringify(snapshot));
  const compressed = await compress(plaintext);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(syncKey);
  const additionalData = new TextEncoder().encode(`${CLOUD_SYNC_SCHEMA_VERSION}|${snapshot.projectId}`);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: arrayBuffer(iv),
    additionalData: arrayBuffer(additionalData),
    tagLength: 128,
  }, key, arrayBuffer(compressed.bytes)));
  return {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    projectId: snapshot.projectId,
    algorithm: "AES-GCM-256",
    compression: compressed.compression,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(encrypted),
    ciphertextHash: await digestHex(encrypted),
    plaintextHash: await digestHex(plaintext),
    plaintextBytes: plaintext.byteLength,
    encryptedBytes: encrypted.byteLength,
  };
}

export async function decryptCloudSnapshot(
  envelope: EncryptedCloudSnapshot,
  syncKey: string,
): Promise<CloudProjectSnapshot> {
  if (
    envelope.schemaVersion !== CLOUD_SYNC_SCHEMA_VERSION
    || envelope.algorithm !== "AES-GCM-256"
    || !envelope.projectId
  ) {
    throw Object.assign(new Error("雲端密文格式不相容。"), {
      code: "CLOUD_SYNC_ENVELOPE_INVALID",
    });
  }
  const key = await importEncryptionKey(syncKey);
  const additionalData = new TextEncoder().encode(`${CLOUD_SYNC_SCHEMA_VERSION}|${envelope.projectId}`);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  if (await digestHex(ciphertext) !== envelope.ciphertextHash) {
    throw Object.assign(new Error("雲端密文傳輸雜湊不一致，已拒絕解密。"), {
      code: "CLOUD_SYNC_CIPHERTEXT_HASH_MISMATCH",
    });
  }
  let decrypted: Uint8Array;
  try {
    decrypted = new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: arrayBuffer(base64UrlToBytes(envelope.iv)),
      additionalData: arrayBuffer(additionalData),
      tagLength: 128,
    }, key, arrayBuffer(ciphertext)));
  } catch (cause) {
    throw Object.assign(new Error("雲端快照無法解密；復原金鑰可能不正確。"), {
      code: "CLOUD_SYNC_DECRYPT_FAILED",
      cause,
    });
  }
  const plaintext = await decompress(decrypted, envelope.compression);
  if (await digestHex(plaintext) !== envelope.plaintextHash) {
    throw Object.assign(new Error("雲端快照完整性驗證失敗。"), {
      code: "CLOUD_SYNC_HASH_MISMATCH",
    });
  }
  const snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as CloudProjectSnapshot;
  assertCloudSnapshot(snapshot);
  if (snapshot.projectId !== envelope.projectId) {
    throw Object.assign(new Error("雲端快照作品身分不一致。"), {
      code: "CLOUD_SYNC_PROJECT_SCOPE_INVALID",
    });
  }
  if (await hashCloudRecords(snapshot.records) !== snapshot.contentHash) {
    throw Object.assign(new Error("雲端作品內容索引驗證失敗，已拒絕匯入。"), {
      code: "CLOUD_SYNC_CONTENT_HASH_MISMATCH",
    });
  }
  return snapshot;
}
