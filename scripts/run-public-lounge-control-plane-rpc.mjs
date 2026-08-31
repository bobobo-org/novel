import assert from "node:assert/strict";
import {
  SupabasePublicLoungeStorageGateway,
} from "../lib/novel-ai/storage/supabase/public-lounge-storage-gateway.ts";

const PUBLISHED_AT = "2026-08-31T01:02:03.000Z";
const PUBLIC_ID = "novel_rpccontract0001";
const IDENTITY_HASH = "a".repeat(64);

class FakeSupabaseClient {
  constructor(overrides = {}) {
    this.calls = [];
    this.overrides = overrides;
  }

  async rpc(functionName, parameters) {
    this.calls.push({ functionName, parameters: structuredClone(parameters) });
    if (this.overrides[functionName]) return this.overrides[functionName];
    switch (functionName) {
      case "novel_public_lounge_control_plane_status":
        return {
          data: [{
            migration_version: "public_lounge_control_plane_028",
            catalog_ready: true,
            rate_ready: true,
          }],
          error: null,
        };
      case "novel_public_lounge_catalog_list":
        return {
          data: [{
            public_id: PUBLIC_ID,
            published_at: "2026-08-31T01:02:03+00:00",
            has_more: true,
          }],
          error: null,
        };
      case "novel_public_lounge_catalog_upsert":
        return { data: true, error: null };
      case "novel_public_lounge_catalog_deactivate":
        return { data: false, error: null };
      case "novel_public_lounge_rate_reserve":
        return {
          data: [{ allowed: true, quota_limit: 6, remaining: 5, retry_after_seconds: 42 }],
          error: null,
        };
      default:
        return { data: null, error: { status: 404, message: "missing rpc" } };
    }
  }
}

const client = new FakeSupabaseClient();
const gateway = new SupabasePublicLoungeStorageGateway(client);

assert.deepEqual(await gateway.controlPlaneStatus(), {
  migrationVersion: "public_lounge_control_plane_028",
  catalogReady: true,
  rateReady: true,
});
assert.deepEqual(await gateway.listCatalogCandidates({ after: null, limit: 1 }), {
  items: [{ publicId: PUBLIC_ID, publishedAt: PUBLISHED_AT }],
  hasMore: true,
});
await gateway.upsertCatalogAnchor({ publicId: PUBLIC_ID, publishedAt: PUBLISHED_AT });
await gateway.deactivateCatalogAnchor(PUBLIC_ID);
assert.deepEqual(await gateway.reserveRate({
  identityHash: IDENTITY_HASH,
  scope: "publish",
  now: PUBLISHED_AT,
}), {
  allowed: true,
  limit: 6,
  remaining: 5,
  retryAfterSeconds: 42,
});

assert.deepEqual(client.calls, [
  {
    functionName: "novel_public_lounge_control_plane_status",
    parameters: {},
  },
  {
    functionName: "novel_public_lounge_catalog_list",
    parameters: {
      p_after_published_at: null,
      p_after_public_id: null,
      p_limit: 1,
    },
  },
  {
    functionName: "novel_public_lounge_catalog_upsert",
    parameters: { p_public_id: PUBLIC_ID, p_published_at: PUBLISHED_AT },
  },
  {
    functionName: "novel_public_lounge_catalog_deactivate",
    parameters: { p_public_id: PUBLIC_ID },
  },
  {
    functionName: "novel_public_lounge_rate_reserve",
    parameters: { p_identity_hash: IDENTITY_HASH, p_scope: "publish" },
  },
]);

const staleGateway = new SupabasePublicLoungeStorageGateway(new FakeSupabaseClient({
  novel_public_lounge_control_plane_status: {
    data: [{
      migration_version: "stale",
      catalog_ready: true,
      rate_ready: true,
    }],
    error: null,
  },
}));
await assert.rejects(
  staleGateway.controlPlaneStatus(),
  (error) => error?.code === "PUBLIC_LOUNGE_CONTROL_PLANE_NOT_READY",
);

const missingRpcGateway = new SupabasePublicLoungeStorageGateway(new FakeSupabaseClient({
  novel_public_lounge_catalog_list: {
    data: null,
    error: { status: 404, message: "function not found" },
  },
}));
await assert.rejects(
  missingRpcGateway.listCatalogCandidates({ after: null, limit: 1 }),
  (error) => error?.code === "SUPABASE_STORAGE_HTTP_404",
);

console.log("PUBLIC_LOUNGE_CONTROL_PLANE_RPC_CONTRACT_PASS");
