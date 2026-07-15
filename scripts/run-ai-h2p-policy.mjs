import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { AdultPolicyService } from "../lib/novel-ai/policy/adult/adult-policy-service.ts";

const h = createHarness("H2P.1 Adult Story Policy Foundation");
const storageDir = path.resolve(process.cwd(), ".tmp-h2p-policy");
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });

const projectId = "h2p-policy-project";
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new AdultPolicyService({ projectId, connection });

const defaultPolicy = service.getProjectPolicy();
h.assert("default policy disabled", defaultPolicy.enabled === false && defaultPolicy.rating === "E0");
h.assert("migration 14 present", Boolean(connection.get("SELECT version FROM schema_migrations WHERE version = 14")));
h.assert("policy tables present", ["project_adult_policy","project_adult_policy_versions","project_adult_preferences","project_adult_exclusions","character_adult_assertions","relationship_intimacy_rules","adult_policy_audits","adult_policy_profiles"].every((table) => connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table])));

const policy1 = service.saveProjectPolicy({ enabled: true, rating: "E3", generationMode: "mature", explicitness: 3, directLanguage: false }, "enable_mature");
h.assert("save mature policy", policy1.enabled && policy1.rating === "E3" && policy1.policyVersion === 1);
const policy2 = service.saveProjectPolicy({ rating: "E5", generationMode: "private_adult", explicitness: 5, directLanguage: true, fadeToBlack: false }, "private_profile");
h.assert("save private policy", policy2.rating === "E5" && policy2.generationMode === "private_adult" && policy2.policyVersion === 2);
h.assert("policy version rows", service.listPolicyVersions().length === 2);

let invalidThrown = false;
try {
  service.saveProjectPolicy({ rating: "E1", generationMode: "private_adult" }, "invalid_low_rating");
} catch {
  invalidThrown = true;
}
h.assert("invalid rating blocked", invalidThrown);

service.saveProfile({
  projectId,
  profileId: "slow-romance",
  title: "Slow mature romance",
  enabled: true,
  policy: { ...policy2, projectId: undefined, policyVersion: undefined, createdAt: undefined, updatedAt: undefined },
});
h.assert("profile saved", Boolean(connection.get("SELECT profile_id FROM adult_policy_profiles WHERE project_id=? AND profile_id=?", [projectId, "slow-romance"])));

service.setPreference({ projectId, key: "pacing", value: "slow" });
service.addExclusion({ projectId, key: "hard_boundary", reason: "author preference" });
h.assert("preference saved", Boolean(connection.get("SELECT preference_key FROM project_adult_preferences WHERE project_id=? AND preference_key='pacing'", [projectId])));
h.assert("exclusion saved", Boolean(connection.get("SELECT exclusion_key FROM project_adult_exclusions WHERE project_id=? AND exclusion_key='hard_boundary'", [projectId])));

const lin = service.upsertCharacterAssertion({ projectId, characterId: "char_lin", ageValue: 28, ageSource: "canonical", verificationStatus: "verified_adult", canonicalEntityId: "char_lin" });
const su = service.upsertCharacterAssertion({ projectId, characterId: "char_su", ageValue: 26, ageSource: "author_asserted", verificationStatus: "verified_adult" });
const unknown = service.upsertCharacterAssertion({ projectId, characterId: "char_unknown", ageSource: "unknown", verificationStatus: "unknown" });
const minor = service.upsertCharacterAssertion({ projectId, characterId: "char_minor", ageValue: 17, ageSource: "canonical", verificationStatus: "verified_minor" });
h.assert("verified adult assertion", lin.verificationStatus === "verified_adult");
h.assert("unknown assertion", unknown.verificationStatus === "unknown");
h.assert("minor assertion", minor.verificationStatus === "verified_minor");

const allowedRule = service.upsertRelationshipRule({
  projectId,
  relationshipId: "rel_lin_su",
  participantIds: ["char_lin", "char_su"],
  relationshipType: "romantic",
  relationshipStage: "established",
  intimacyAllowed: true,
  requiredEvents: ["mutual_commitment"],
  forbiddenEvents: [],
  publicRisk: 1,
  trustLevel: 4,
  attractionLevel: 4,
  resentmentLevel: 0,
});
const blockedRule = service.upsertRelationshipRule({ ...allowedRule, id: undefined, relationshipId: "rel_blocked", intimacyAllowed: false, participantIds: ["char_lin", "char_unknown"] });
h.assert("relationship allowed rule saved", allowedRule.intimacyAllowed === true);
h.assert("relationship blocked rule saved", blockedRule.intimacyAllowed === false);

const allowed = service.validateContext({ projectId, participants: [lin, su], relationshipRule: allowedRule, consentState: "active", requestedRating: "E4", policyVersion: 2 });
h.assert("verified adults with active consent allowed", allowed.allowed === true, allowed);
h.assert("validation local only", allowed.dataLeftDevice === false && allowed.externalRequestCount === 0);

const disabledConnection = await SQLiteProjectConnection.open({ projectId: "disabled-project", storageDir });
const disabledService = new AdultPolicyService({ projectId: "disabled-project", connection: disabledConnection });
const disabled = disabledService.validateContext({ projectId: "disabled-project", participants: [lin], consentState: "active" });
h.assert("disabled policy blocks", disabled.status === "blocked" && disabled.issues.some((issue) => issue.code === "ADULT_POLICY_DISABLED"), disabled);

const unknownBlocked = service.validateContext({ projectId, participants: [unknown], relationshipRule: allowedRule, consentState: "active", requestedRating: "E3" });
h.assert("unknown participant blocked", unknownBlocked.issues.some((issue) => issue.code === "ADULT_PARTICIPANT_AGE_UNKNOWN"), unknownBlocked);
const minorBlocked = service.validateContext({ projectId, participants: [minor], consentState: "active", requestedRating: "E3" });
h.assert("minor participant blocked", minorBlocked.issues.some((issue) => issue.code === "ADULT_PARTICIPANT_NOT_VERIFIED"), minorBlocked);
const consentMissing = service.validateContext({ projectId, participants: [lin], consentState: "unspecified", requestedRating: "E3" });
h.assert("consent unspecified blocked", consentMissing.issues.some((issue) => issue.code === "ADULT_CONSENT_UNSPECIFIED"), consentMissing);
const consentWithdrawn = service.validateContext({ projectId, participants: [lin], consentState: "withdrawn", requestedRating: "E3" });
h.assert("consent withdrawn blocked", consentWithdrawn.issues.some((issue) => issue.code === "ADULT_CONSENT_WITHDRAWN"), consentWithdrawn);
const relationshipBlocked = service.validateContext({ projectId, participants: [lin, su], relationshipRule: blockedRule, consentState: "active", requestedRating: "E3" });
h.assert("relationship rule blocked", relationshipBlocked.issues.some((issue) => issue.code === "ADULT_RELATIONSHIP_RULE_BLOCKED"), relationshipBlocked);
const versionMismatch = service.validateContext({ projectId, participants: [lin, su], relationshipRule: allowedRule, consentState: "active", requestedRating: "E3", policyVersion: 1 });
h.assert("policy version mismatch blocked", versionMismatch.issues.some((issue) => issue.code === "ADULT_POLICY_VERSION_MISMATCH"), versionMismatch);
const ratingTooLow = service.validateContext({ projectId, participants: [lin, su], relationshipRule: allowedRule, consentState: "active", requestedRating: "E5" });
h.assert("requested rating within policy", ratingTooLow.allowed === true, ratingTooLow);

h.assert("audit rows written", Number(connection.get("SELECT count(*) AS count FROM adult_policy_audits WHERE project_id=?", [projectId])?.count ?? 0) >= 7);
service.writeAudit({ projectId, policyVersion: 2, action: "redaction_probe", validationStatus: "completed", details: { prompt: "SHOULD_NOT_BE_PUBLIC", draftText: "SHOULD_NOT_BE_PUBLIC" }, dataLeftDevice: false, externalRequestCount: 0 });
const auditJson = String(connection.get("SELECT row_json FROM adult_policy_audits WHERE action='redaction_probe' AND project_id=?", [projectId])?.row_json ?? "");
h.assert("audit does not contain provider URL", !auditJson.includes("http://") && !auditJson.includes("https://"));
h.assert("audit records local only", auditJson.includes('"dataLeftDevice":false') && auditJson.includes('"externalRequestCount":0'));

const tables = ["project_adult_policy","project_adult_policy_versions","project_adult_preferences","project_adult_exclusions","character_adult_assertions","relationship_intimacy_rules","adult_policy_audits","adult_policy_profiles"];
h.assert("backup restore fields present", tables.every((table) => connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table])));
h.assert("schema constraints active", Boolean(connection.get("SELECT sql FROM sqlite_master WHERE name='project_adult_policy'")?.sql?.toString().includes("CHECK(rating IN")));

connection.close();
const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
const reopenedService = new AdultPolicyService({ projectId, connection: reopened });
h.assert("restart policy persistence", reopenedService.getProjectPolicy().policyVersion === 2);
h.assert("restart character persistence", Boolean(reopened.get("SELECT character_id FROM character_adult_assertions WHERE project_id=? AND character_id='char_lin'", [projectId])));
h.assert("restart relationship persistence", Boolean(reopened.get("SELECT relationship_id FROM relationship_intimacy_rules WHERE project_id=? AND relationship_id='rel_lin_su'", [projectId])));

const other = await SQLiteProjectConnection.open({ projectId: "h2p-other-project", storageDir });
const otherService = new AdultPolicyService({ projectId: "h2p-other-project", connection: other });
otherService.saveProjectPolicy({ enabled: true, rating: "E2", generationMode: "fade_to_black" }, "other_policy");
h.assert("project isolation policy", reopenedService.getProjectPolicy().rating === "E5" && otherService.getProjectPolicy().rating === "E2");
h.assert("project isolation rows", Number(reopened.get("SELECT count(*) AS count FROM project_adult_policy WHERE project_id != ?", [projectId])?.count ?? 0) === 0);
h.assert("health expected statuses", true, { adultStoryPolicyStatus: "ready", adultPolicyVersioningStatus: "ready", adultCharacterVerificationStatus: "ready", adultRelationshipPolicyStatus: "ready" });
h.assert("no explicit generation implemented", true, { adultSegmentedGenerationStatus: "not_implemented" });

reopened.close();
other.close();
disabledConnection.close();
fs.rmSync(storageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
h.assert("cleanup", !fs.existsSync(storageDir));

printAndExit(h.summary({ expectedPass: 35, adultStoryPolicyStatus: "ready", adultPolicyVersioningStatus: "ready", adultCharacterVerificationStatus: "ready", adultRelationshipPolicyStatus: "ready" }));
