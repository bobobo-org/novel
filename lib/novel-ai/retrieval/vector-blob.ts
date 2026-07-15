import { createHash } from "node:crypto";
import { EmbeddingProviderError } from "../embeddings/embedding-errors";
import { assertValidVector } from "../embeddings/embedding-normalization";

export function encodeVector(vector: number[], expectedDimensions?: number) {
  assertValidVector(vector, expectedDimensions);
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

export function decodeVector(blob: Buffer | Uint8Array, dimensions: number) {
  validateVectorBlob(blob, dimensions);
  const buffer = Buffer.from(blob);
  const vector: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += 4) {
    vector.push(buffer.readFloatLE(offset));
  }
  assertValidVector(vector, dimensions);
  return vector;
}

export function checksumVectorBlob(blob: Buffer | Uint8Array) {
  return createHash("sha256").update(Buffer.from(blob)).digest("hex");
}

export function checksumVector(vector: number[], expectedDimensions?: number) {
  return checksumVectorBlob(encodeVector(vector, expectedDimensions));
}

export function validateVectorBlob(blob: Buffer | Uint8Array, dimensions: number, expectedChecksum?: string) {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new EmbeddingProviderError("EMBEDDING_DIMENSION_MISMATCH", `Invalid vector dimensions ${dimensions}`, { stage: "vector-blob" });
  }
  const buffer = Buffer.from(blob);
  if (buffer.length !== dimensions * 4) {
    throw new EmbeddingProviderError("EMBEDDING_DIMENSION_MISMATCH", `Expected vector blob ${dimensions * 4} bytes, received ${buffer.length}`, { stage: "vector-blob" });
  }
  if (expectedChecksum && checksumVectorBlob(buffer) !== expectedChecksum) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_VECTOR", "Vector blob checksum mismatch", { stage: "vector-blob" });
  }
  for (let offset = 0; offset < buffer.length; offset += 4) {
    const value = buffer.readFloatLE(offset);
    if (!Number.isFinite(value)) {
      throw new EmbeddingProviderError("EMBEDDING_INVALID_VECTOR", "Vector blob contains NaN or Infinity", { stage: "vector-blob" });
    }
  }
  return true;
}
