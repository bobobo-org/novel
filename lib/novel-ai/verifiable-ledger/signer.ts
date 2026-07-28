import { sha256Hex } from "../closed-ai-cache";
import type { LedgerSignature } from "./types";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export class ApprovalSigner {
  private readonly keyPair: Promise<CryptoKeyPair>;

  constructor(keyPair?: CryptoKeyPair) {
    this.keyPair = keyPair
      ? Promise.resolve(keyPair)
      : crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      ) as Promise<CryptoKeyPair>;
  }

  async sign(blockHash: string, signedAt = new Date().toISOString()): Promise<LedgerSignature> {
    const keyPair = await this.keyPair;
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const keyId = (await sha256Hex(JSON.stringify(publicKeyJwk))).slice(0, 24);
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(blockHash),
    );
    return {
      algorithm: "ECDSA-P256-SHA256",
      keyId,
      publicKeyJwk,
      signature: toBase64(new Uint8Array(signature)),
      signedAt,
    };
  }
}

export async function verifyLedgerSignature(blockHash: string, signature: LedgerSignature) {
  if (signature.algorithm !== "ECDSA-P256-SHA256") return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      signature.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      fromBase64(signature.signature),
      new TextEncoder().encode(blockHash),
    );
  } catch {
    return false;
  }
}
