import assert from "node:assert/strict";
import {
  SupabasePublicLoungeStorageGateway,
} from "../lib/novel-ai/storage/supabase/public-lounge-storage-gateway.ts";

const HASHES = {
  attestationIdHash: "a".repeat(64),
  attestationDigest: "b".repeat(64),
  bindingDigest: "c".repeat(64),
  eligibilityTicketHash: "d".repeat(64),
  authorizedOwnerIdHash: "e".repeat(64),
};
const CONSUMPTION = {
  ...HASHES,
  environment: "preview",
  intent: "publish",
  expiresAt: "2026-09-04T08:30:00.000Z",
};

class FakeSupabaseClient {
  constructor(overrides = {}) {
    this.calls = [];
    this.overrides = overrides;
  }

  async rpc(functionName, parameters) {
    this.calls.push({ functionName, parameters: structuredClone(parameters) });
    if (Object.prototype.hasOwnProperty.call(this.overrides, functionName)) {
      return this.overrides[functionName];
    }
    if (functionName === "novel_public_lounge_attestation_ledger_status") {
      return {
        data: [{
          migration_version: "public_lounge_attestation_nonce_ledger_029",
          ledger_ready: true,
        }],
        error: null,
      };
    }
    if (functionName === "novel_public_lounge_consume_attestation_v5") {
      return { data: true, error: null };
    }
    return { data: null, error: { status: 404, message: "missing rpc" } };
  }
}

const client = new FakeSupabaseClient();
const gateway = new SupabasePublicLoungeStorageGateway(client);
assert.deepEqual(await gateway.attestationNonceLedgerStatus(), {
  migrationVersion: "public_lounge_attestation_nonce_ledger_029",
  ledgerReady: true,
});
assert.equal(await gateway.consumeAttestationNonceV5(CONSUMPTION), "consumed");
assert.deepEqual(client.calls, [
  {
    functionName: "novel_public_lounge_attestation_ledger_status",
    parameters: {},
  },
  {
    functionName: "novel_public_lounge_consume_attestation_v5",
    parameters: {
      p_attestation_id_hash: HASHES.attestationIdHash,
      p_attestation_digest: HASHES.attestationDigest,
      p_binding_digest: HASHES.bindingDigest,
      p_eligibility_ticket_hash: HASHES.eligibilityTicketHash,
      p_authorized_owner_id_hash: HASHES.authorizedOwnerIdHash,
      p_environment: "preview",
      p_intent: "publish",
      p_expires_at: CONSUMPTION.expiresAt,
    },
  },
]);

const replayGateway = new SupabasePublicLoungeStorageGateway(new FakeSupabaseClient({
  novel_public_lounge_consume_attestation_v5: { data: false, error: null },
}));
assert.equal(await replayGateway.consumeAttestationNonceV5(CONSUMPTION), "replayed");

for (const malformed of [null, [], {}, "true", 1]) {
  const malformedGateway = new SupabasePublicLoungeStorageGateway(new FakeSupabaseClient({
    novel_public_lounge_consume_attestation_v5: { data: malformed, error: null },
  }));
  await assert.rejects(
    malformedGateway.consumeAttestationNonceV5(CONSUMPTION),
    (error) => error?.code === "SUPABASE_STORAGE_EMPTY_RESPONSE",
  );
}

const errorGateway = new SupabasePublicLoungeStorageGateway(new FakeSupabaseClient({
  novel_public_lounge_consume_attestation_v5: {
    data: null,
    error: { status: 503, message: "ambiguous timeout" },
  },
}));
await assert.rejects(
  errorGateway.consumeAttestationNonceV5(CONSUMPTION),
  (error) => error?.code === "SUPABASE_STORAGE_HTTP_503",
);

const staleStatusGateway = new SupabasePublicLoungeStorageGateway(new FakeSupabaseClient({
  novel_public_lounge_attestation_ledger_status: {
    data: [{ migration_version: "stale", ledger_ready: true }],
    error: null,
  },
}));
await assert.rejects(
  staleStatusGateway.attestationNonceLedgerStatus(),
  (error) => error?.code === "PUBLIC_LOUNGE_ATTESTATION_LEDGER_NOT_READY",
);

for (const patch of [
  { attestationIdHash: "not-a-hash" },
  { environment: "production-like" },
  { intent: "withdraw" },
  { expiresAt: "2026-09-04T08:30:00Z" },
]) {
  const validatingClient = new FakeSupabaseClient();
  const validatingGateway = new SupabasePublicLoungeStorageGateway(validatingClient);
  await assert.rejects(
    validatingGateway.consumeAttestationNonceV5({ ...CONSUMPTION, ...patch }),
    (error) => error?.code === "PUBLIC_LOUNGE_ATTESTATION_CONSUMPTION_INVALID",
  );
  assert.equal(validatingClient.calls.length, 0);
}

console.log("PUBLIC_LOUNGE_ATTESTATION_LEDGER_RPC_CONTRACT_PASS");
