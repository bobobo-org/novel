import { sha256Hex, stableStringify } from "../closed-ai-cache";
import {
  ADULT_NARRATIVE_RUNTIME_BINDING_VERSION,
  ADULT_NARRATIVE_RUNTIME_PROMPT_CONTRACT_VERSION,
  assertAdultNarrativeFadeToBlackOutput,
  assertAdultNarrativeParticipantsAuthorized,
  type AdultNarrativeRuntimeBindingApplicable,
} from "../adult/scenes/adult-narrative-runtime-binding";
import type { RpgChatSnapshot, RpgChatTurnCandidate } from "./rpg-chat-turn";

export const RPG_ADULT_RUNTIME_POLICY_RECEIPT_SCHEMA = "rpg-adult-runtime-policy-receipt-v1" as const;
export const RPG_ADULT_RUNTIME_POLICY_VERSION = "adult-structural-fade-to-black-v1" as const;

const RECEIPT_KEYS = [
  "schemaVersion",
  "required",
  "policyVersion",
  "bindingSchemaVersion",
  "promptContractVersion",
  "outputKind",
  "fadeToBlack",
  "explicitText",
  "externalExecutionAllowed",
  "dataEgressAllowed",
  "participantDisplayNames",
  "participantCount",
  "runtimeBindingDigest",
  "scopeBindingDigest",
  "participantDisplayNameDigest",
  "policyBindingDigest",
  "promptBindingDigest",
  "candidateContentDigest",
  "upstreamTaskDigest",
  "upstreamRequestContractDigest",
  "upstreamApplicationValidationBaseDigest",
  "upstreamApplicationValidationBindingDigest",
  "upstreamExecutionReceiptDigest",
  "receiptDigest",
] as const;

const CANONICAL_IDENTIFIER_SHAPE = /(?:\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b(?:character|participant|consent|safety|evidence|project|scope|turn|artifact|candidate|task|message)[-_:/][a-z0-9][a-z0-9_.:-]{4,}\b|\b[0-9A-HJKMNP-TV-Z]{26}\b)/iu;
const HEX_DIGEST = /^[a-f0-9]{64}$/u;

type RpgAdultRuntimePolicyReceiptBody = {
  schemaVersion: typeof RPG_ADULT_RUNTIME_POLICY_RECEIPT_SCHEMA;
  required: true;
  policyVersion: typeof RPG_ADULT_RUNTIME_POLICY_VERSION;
  bindingSchemaVersion: typeof ADULT_NARRATIVE_RUNTIME_BINDING_VERSION;
  promptContractVersion: typeof ADULT_NARRATIVE_RUNTIME_PROMPT_CONTRACT_VERSION;
  outputKind: "structural_json";
  fadeToBlack: true;
  explicitText: false;
  externalExecutionAllowed: false;
  dataEgressAllowed: false;
  participantDisplayNames: string[];
  participantCount: number;
  runtimeBindingDigest: string;
  scopeBindingDigest: string;
  participantDisplayNameDigest: string;
  policyBindingDigest: string;
  promptBindingDigest: string;
  candidateContentDigest: string;
  upstreamTaskDigest: string;
  upstreamRequestContractDigest: string;
  upstreamApplicationValidationBaseDigest: string;
  upstreamApplicationValidationBindingDigest: string;
  upstreamExecutionReceiptDigest: string;
};

export type RpgAdultRuntimePolicyReceipt = RpgAdultRuntimePolicyReceiptBody & {
  receiptDigest: string;
};

type AuthoritativeClosedCandidate = {
  taskId: string;
  contentDigest: string;
  requestContractDigest?: unknown;
  applicationValidationBindingDigest?: unknown;
  executionReceipt: unknown;
};

function invalidAdultPolicyReceipt() {
  return Object.assign(new Error("成人 RPG 候選缺少完整且可驗證的本機安全綁定。"), {
    code: "RPG_ADULT_RUNTIME_POLICY_RECEIPT_INVALID",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>) {
  const actual = Object.keys(value).sort();
  const expected = [...RECEIPT_KEYS].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function activeCharacterDisplayNames(snapshot: RpgChatSnapshot) {
  return [...new Set(snapshot.characters.flatMap((character) => [
    character.name,
    ...(character.aliases ?? []),
  ]).map((name) => name.normalize("NFKC").trim()).filter(Boolean))];
}

export type RpgAdultRuntimePolicyBindingDigests = {
  runtimeBindingDigest: string;
  scopeBindingDigest: string;
  participantDisplayNameDigest: string;
  policyBindingDigest: string;
  promptBindingDigest: string;
};

export async function createRpgAdultRuntimePolicyBindingDigests(input: {
  binding: AdultNarrativeRuntimeBindingApplicable;
  promptBinding: string;
}): Promise<RpgAdultRuntimePolicyBindingDigests> {
  return {
    runtimeBindingDigest: await sha256Hex(stableStringify({
      schemaVersion: input.binding.schemaVersion,
      projectId: input.binding.projectId,
      scopeId: input.binding.scopeId,
      evaluatedAt: input.binding.evaluatedAt,
      executionSource: input.binding.executionSource,
      participantIds: input.binding.participantIds,
      participantDisplayNames: input.binding.participantDisplayNames,
      evidence: input.binding.evidence,
      executionPolicy: input.binding.executionPolicy,
      rendering: input.binding.rendering,
      blueprint: input.binding.blueprint,
    })),
    scopeBindingDigest: await sha256Hex(stableStringify({
      projectId: input.binding.projectId,
      scopeId: input.binding.scopeId,
      participantIds: input.binding.participantIds,
    })),
    participantDisplayNameDigest: await sha256Hex(stableStringify(
      input.binding.participantDisplayNames,
    )),
    policyBindingDigest: await sha256Hex(stableStringify({
      policyVersion: RPG_ADULT_RUNTIME_POLICY_VERSION,
      bindingSchemaVersion: ADULT_NARRATIVE_RUNTIME_BINDING_VERSION,
      promptContractVersion: ADULT_NARRATIVE_RUNTIME_PROMPT_CONTRACT_VERSION,
      outputKind: input.binding.rendering.outputKind,
      fadeToBlack: input.binding.rendering.fadeToBlack,
      explicitText: input.binding.rendering.explicitText,
      externalExecutionAllowed:
        input.binding.executionPolicy.externalExecutionAllowed,
      dataEgressAllowed: input.binding.executionPolicy.dataEgressAllowed,
    })),
    promptBindingDigest: await sha256Hex(input.promptBinding),
  };
}

export async function bindRpgAdultApplicationValidationDigest(input: {
  baseApplicationValidationDigest: string;
  policyDigests: RpgAdultRuntimePolicyBindingDigests;
}) {
  if (!HEX_DIGEST.test(input.baseApplicationValidationDigest)) {
    throw invalidAdultPolicyReceipt();
  }
  return sha256Hex(stableStringify({
    domain: "rpg-adult-application-validation-envelope-v1",
    baseApplicationValidationDigest: input.baseApplicationValidationDigest,
    ...input.policyDigests,
  }));
}

export async function sealRpgAdultRuntimePolicyReceipt(input: {
  binding: AdultNarrativeRuntimeBindingApplicable;
  promptBinding: string;
  baseApplicationValidationDigest: string;
  candidate: AuthoritativeClosedCandidate;
}): Promise<RpgAdultRuntimePolicyReceipt> {
  const requestContractDigest = input.candidate.requestContractDigest;
  const applicationValidationBindingDigest =
    input.candidate.applicationValidationBindingDigest;
  if (
    typeof requestContractDigest !== "string"
    || !HEX_DIGEST.test(requestContractDigest)
    || typeof applicationValidationBindingDigest !== "string"
    || !HEX_DIGEST.test(applicationValidationBindingDigest)
  ) {
    throw invalidAdultPolicyReceipt();
  }
  const policyDigests = await createRpgAdultRuntimePolicyBindingDigests(input);
  const expectedApplicationValidationBindingDigest =
    await bindRpgAdultApplicationValidationDigest({
      baseApplicationValidationDigest:
        input.baseApplicationValidationDigest,
      policyDigests,
    });
  if (
    expectedApplicationValidationBindingDigest
      !== applicationValidationBindingDigest
  ) throw invalidAdultPolicyReceipt();
  const body: RpgAdultRuntimePolicyReceiptBody = {
    schemaVersion: RPG_ADULT_RUNTIME_POLICY_RECEIPT_SCHEMA,
    required: true,
    policyVersion: RPG_ADULT_RUNTIME_POLICY_VERSION,
    bindingSchemaVersion: ADULT_NARRATIVE_RUNTIME_BINDING_VERSION,
    promptContractVersion: ADULT_NARRATIVE_RUNTIME_PROMPT_CONTRACT_VERSION,
    outputKind: "structural_json",
    fadeToBlack: true,
    explicitText: false,
    externalExecutionAllowed: false,
    dataEgressAllowed: false,
    participantDisplayNames: [...input.binding.participantDisplayNames],
    participantCount: input.binding.participantIds.length,
    ...policyDigests,
    candidateContentDigest: input.candidate.contentDigest,
    upstreamTaskDigest: await sha256Hex(input.candidate.taskId),
    upstreamRequestContractDigest: requestContractDigest,
    upstreamApplicationValidationBaseDigest:
      input.baseApplicationValidationDigest,
    upstreamApplicationValidationBindingDigest:
      applicationValidationBindingDigest,
    upstreamExecutionReceiptDigest: await sha256Hex(stableStringify(input.candidate.executionReceipt)),
  };
  return {
    ...body,
    receiptDigest: await sha256Hex(stableStringify(body)),
  };
}

export async function verifyRpgAdultRuntimePolicyReceipt(input: {
  candidate: RpgChatTurnCandidate;
  snapshot: RpgChatSnapshot;
  authoritativeClosedCandidate?: AuthoritativeClosedCandidate | null;
}) {
  const envelope = isRecord(input.candidate.executionReceipt)
    ? input.candidate.executionReceipt
    : null;
  const raw = envelope?.adultNarrativeRuntime;

  if (!input.snapshot.project.adultMode) {
    if (raw !== undefined) throw invalidAdultPolicyReceipt();
    return null;
  }
  if (
    !isRecord(raw)
    || !hasExactKeys(raw)
    || input.candidate.externalRequest
    || input.candidate.dataLeftDevice
  ) throw invalidAdultPolicyReceipt();

  const receipt = raw as RpgAdultRuntimePolicyReceipt;
  const { receiptDigest, ...body } = receipt;
  const displayNames = receipt.participantDisplayNames;
  const knownNames = activeCharacterDisplayNames(input.snapshot);
  const knownNameSet = new Set(knownNames);
  if (
    receipt.schemaVersion !== RPG_ADULT_RUNTIME_POLICY_RECEIPT_SCHEMA
    || receipt.required !== true
    || receipt.policyVersion !== RPG_ADULT_RUNTIME_POLICY_VERSION
    || receipt.bindingSchemaVersion !== ADULT_NARRATIVE_RUNTIME_BINDING_VERSION
    || receipt.promptContractVersion !== ADULT_NARRATIVE_RUNTIME_PROMPT_CONTRACT_VERSION
    || receipt.outputKind !== "structural_json"
    || receipt.fadeToBlack !== true
    || receipt.explicitText !== false
    || receipt.externalExecutionAllowed !== false
    || receipt.dataEgressAllowed !== false
    || !Array.isArray(displayNames)
    || displayNames.length < 2
    || displayNames.length !== new Set(displayNames).size
    || displayNames.some((name) => (
      typeof name !== "string"
      || !name.trim()
      || name !== name.normalize("NFKC").trim()
      || CANONICAL_IDENTIFIER_SHAPE.test(name)
      || !knownNameSet.has(name)
    ))
    || !Number.isInteger(receipt.participantCount)
    || receipt.participantCount < 2
    || displayNames.length < receipt.participantCount
    || receipt.candidateContentDigest !== input.candidate.candidateDigest
    || receipt.upstreamTaskDigest !== await sha256Hex(input.candidate.taskId)
    || !HEX_DIGEST.test(receipt.runtimeBindingDigest ?? "")
    || !HEX_DIGEST.test(receipt.scopeBindingDigest ?? "")
    || receipt.participantDisplayNameDigest
      !== await sha256Hex(stableStringify(displayNames))
    || !HEX_DIGEST.test(receipt.policyBindingDigest ?? "")
    || !HEX_DIGEST.test(receipt.promptBindingDigest ?? "")
    || !HEX_DIGEST.test(receipt.candidateContentDigest ?? "")
    || !HEX_DIGEST.test(receipt.upstreamRequestContractDigest ?? "")
    || !HEX_DIGEST.test(
      receipt.upstreamApplicationValidationBaseDigest ?? "",
    )
    || !HEX_DIGEST.test(
      receipt.upstreamApplicationValidationBindingDigest ?? "",
    )
    || !HEX_DIGEST.test(receipt.upstreamExecutionReceiptDigest ?? "")
    || !HEX_DIGEST.test(receiptDigest ?? "")
    || receipt.upstreamApplicationValidationBindingDigest
      !== await bindRpgAdultApplicationValidationDigest({
        baseApplicationValidationDigest:
          receipt.upstreamApplicationValidationBaseDigest,
        policyDigests: {
          runtimeBindingDigest: receipt.runtimeBindingDigest,
          scopeBindingDigest: receipt.scopeBindingDigest,
          participantDisplayNameDigest:
            receipt.participantDisplayNameDigest,
          policyBindingDigest: receipt.policyBindingDigest,
          promptBindingDigest: receipt.promptBindingDigest,
        },
      })
    || await sha256Hex(stableStringify(body)) !== receiptDigest
  ) throw invalidAdultPolicyReceipt();

  const authoritative = input.authoritativeClosedCandidate;
  if (authoritative && (
    authoritative.taskId !== input.candidate.taskId
    || authoritative.contentDigest !== input.candidate.candidateDigest
    || receipt.upstreamTaskDigest !== await sha256Hex(authoritative.taskId)
    || receipt.upstreamRequestContractDigest !== authoritative.requestContractDigest
    || receipt.upstreamApplicationValidationBindingDigest
      !== authoritative.applicationValidationBindingDigest
    || receipt.upstreamExecutionReceiptDigest
      !== await sha256Hex(stableStringify(authoritative.executionReceipt))
  )) throw invalidAdultPolicyReceipt();

  assertAdultNarrativeFadeToBlackOutput(input.candidate.story);
  assertAdultNarrativeParticipantsAuthorized({
    story: input.candidate.story,
    allowedParticipantDisplayNames: displayNames,
    knownCharacterDisplayNames: knownNames,
  });
  return receipt;
}
