import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { EmbeddingProviderError } from "../lib/novel-ai/embeddings/embedding-errors.ts";
import { encodeVector, decodeVector, validateVectorBlob, checksumVector, checksumVectorBlob } from "../lib/novel-ai/retrieval/vector-blob.ts";

const h = createHarness("H2A Vector Blob Storage");
const vector = Array.from({ length: 768 }, (_, i) => Math.sin(i) / 100);
const blob = encodeVector(vector, 768);
const decoded = decodeVector(blob, 768);
const checksum = checksumVectorBlob(blob);

h.assert("encode decode parity", decoded.length === vector.length && Math.abs(decoded[10] - vector[10]) < 0.000001);
h.assert("768 dimensions", blob.length === 768 * 4);
h.assert("finite values", decoded.every(Number.isFinite));
h.assert("checksum stable", checksum === checksumVector(vector, 768));
h.assert("little endian", Math.abs(blob.readFloatLE(0) - vector[0]) < 0.000001);

try { validateVectorBlob(blob.subarray(0, blob.length - 1), 768); h.fail("truncated blob rejected"); }
catch (error) { h.assert("truncated blob rejected", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_DIMENSION_MISMATCH"); }

try { decodeVector(blob, 767); h.fail("dimension mismatch rejected"); }
catch (error) { h.assert("dimension mismatch rejected", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_DIMENSION_MISMATCH"); }

try { validateVectorBlob(blob, 768, "bad"); h.fail("checksum mismatch rejected"); }
catch (error) { h.assert("checksum mismatch rejected", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_INVALID_VECTOR"); }

try { encodeVector([1, Number.NaN], 2); h.fail("NaN rejected"); }
catch (error) { h.assert("NaN rejected", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_INVALID_VECTOR"); }

try { encodeVector([1, Number.POSITIVE_INFINITY], 2); h.fail("Infinity rejected"); }
catch (error) { h.assert("Infinity rejected", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_INVALID_VECTOR"); }

const projectA = checksumVector(Array.from({ length: 768 }, (_, i) => i / 1000), 768);
const projectB = checksumVector(Array.from({ length: 768 }, (_, i) => (i + 1) / 1000), 768);
h.assert("project isolation checksum differs", projectA !== projectB);
h.assert("non-zero blob", blob.some((byte) => byte !== 0));
h.assert("blob is Buffer", Buffer.isBuffer(blob));
h.assert("validate returns true", validateVectorBlob(blob, 768, checksum) === true);
h.assert("roundtrip checksum", checksumVectorBlob(encodeVector(decoded, 768)) === checksum);

printAndExit(h.summary({ expectedPass: 15, vectorBlobStatus: "ready" }));
