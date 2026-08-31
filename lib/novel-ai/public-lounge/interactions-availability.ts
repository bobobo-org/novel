export const PUBLIC_LOUNGE_INTERACTIONS_HEALTH_SCHEMA_VERSION =
  "public-lounge-interactions-health-v1" as const;
export const PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION =
  "public_lounge_interactions_v1_027" as const;
export const PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION =
  "public_lounge_interactions_runtime_v1" as const;

export const PUBLIC_LOUNGE_INTERACTION_BLOCKERS = [
  "production_magic_link_redirect_not_verified",
  "production_owner_lifecycle_not_verified",
  "production_two_account_rpc_self_test_not_verified",
] as const;

export type PublicLoungeInteractionBlocker =
  typeof PUBLIC_LOUNGE_INTERACTION_BLOCKERS[number]
  | "feature_flag_disabled"
  | "supabase_public_url_missing"
  | "supabase_anon_key_missing"
  | "supabase_service_role_missing"
  | "migration_marker_not_declared"
  | "activation_verification_not_declared"
  | "live_rpc_status_not_verified";

export type PublicLoungeInteractionsAvailability = {
  schemaVersion: typeof PUBLIC_LOUNGE_INTERACTIONS_HEALTH_SCHEMA_VERSION;
  status: "not_connected";
  ready: false;
  identity: "not_connected";
  persistence: "migration_prepared_not_activated";
  counts: null;
  capabilities: {
    oneVotePerWork: false;
    comments: false;
    reports: false;
    authorCommentDeletion: false;
  };
  blockers: readonly PublicLoungeInteractionBlocker[];
};

type InteractionEnvironment = Record<string, string | undefined>;

/**
 * This synchronous view intentionally cannot return ready. The health route
 * removes the final live-RPC blocker only after the service-role-only migration
 * status function succeeds. Environment variables alone can never activate it.
 */
export function publicLoungeInteractionsAvailability(
  env: InteractionEnvironment = process.env,
): PublicLoungeInteractionsAvailability {
  const blockers: PublicLoungeInteractionBlocker[] = [];
  if (env.PUBLIC_LOUNGE_INTERACTIONS_ENABLED !== "1") blockers.push("feature_flag_disabled");
  if (!(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL)) blockers.push("supabase_public_url_missing");
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) blockers.push("supabase_anon_key_missing");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) blockers.push("supabase_service_role_missing");
  if (env.PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION !== PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION) {
    blockers.push("migration_marker_not_declared");
  }
  if (env.PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION !== PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION) {
    blockers.push("activation_verification_not_declared");
    blockers.push(...PUBLIC_LOUNGE_INTERACTION_BLOCKERS);
  }
  blockers.push("live_rpc_status_not_verified");
  return {
    schemaVersion: PUBLIC_LOUNGE_INTERACTIONS_HEALTH_SCHEMA_VERSION,
    status: "not_connected",
    ready: false,
    identity: "not_connected",
    persistence: "migration_prepared_not_activated",
    counts: null,
    capabilities: {
      oneVotePerWork: false,
      comments: false,
      reports: false,
      authorCommentDeletion: false,
    },
    blockers,
  };
}
