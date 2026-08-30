import assert from "node:assert/strict";

import { sha256Hex, stableStringify } from "../lib/novel-ai/closed-ai-cache/index.ts";

import { generateRpgChatTurnCandidate } from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { generateRpgChatTurnCandidateWithExternalCascade } from "../lib/novel-ai/web/rpg-external-cascade.ts";
import { verifyExternalRpgFailureLineage } from "../lib/novel-ai/web/rpg-external-receipt.ts";
import {
  bindRpgAdultApplicationValidationDigest,
  verifyRpgAdultRuntimePolicyReceipt,
} from "../lib/novel-ai/web/rpg-adult-runtime-receipt.ts";
import {
  RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
  createRpgAdultRuntimeClosedResult,
  createRpgAdultRuntimeExternalResult,
  createRpgAdultRuntimeProductionFixture,
} from "./fixtures/rpg-adult-runtime-production-fixture.mjs";

const ADULT_PROMPT_VERSION = "adult-narrative-runtime-prompt-v1";
const ADULT_RECEIPT_KEYS = [
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
].sort();

function cloneFixture() {
  return createRpgAdultRuntimeProductionFixture();
}

const INJECTED_READY_COORDINATION = {
  probeAvailability: async () => "ready",
};

function assertNoPrivateAdultEvidence(serialized, fixture, label) {
  const blockedValues = [
    ...fixture.adultNarrativeRuntime.participantIds,
    ...fixture.adultNarrativeRuntime.consentEvidence.map((item) => item.evidenceId),
    fixture.adultNarrativeRuntime.safetyEvidence.evidenceId,
  ];
  for (const blockedValue of blockedValues) {
    const leakIndex = serialized.indexOf(blockedValue);
    assert.equal(
      leakIndex >= 0,
      false,
      `${label} leaked private adult runtime value ${blockedValue}: ${leakIndex >= 0 ? serialized.slice(Math.max(0, leakIndex - 100), leakIndex + blockedValue.length + 100) : ""}`,
    );
  }
  assert.doesNotMatch(serialized, /"age(?:Verified)?"\s*:/u, `${label} leaked age fields`);
}

const directFixture = cloneFixture();
const directRequests = [];
const callerAttemptedOverride = {
  ...directFixture.adultNarrativeRuntime,
  executionSource: "gemini",
  scopeId: "attacker-controlled-scope",
  project: { id: "attacker-project", adultMode: false },
  characters: [{ id: "attacker-character", age: 17, ageVerified: false }],
};
const directCandidate = await generateRpgChatTurnCandidate({
  snapshot: directFixture.snapshot,
  choice: directFixture.choice,
  logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
  adultNarrativeRuntime: callerAttemptedOverride,
  adultNarrativeRuntimeClock: () => new Date("2026-08-30T06:00:00.000Z"),
  generationDeadlineMs: 100,
  coordinationDependencies: INJECTED_READY_COORDINATION,
  closedAIInvoker: async (request) => {
    directRequests.push(request);
    return createRpgAdultRuntimeClosedResult(request, directFixture);
  },
});
assert.equal(directRequests.length, 1, "valid adult runtime should reach the closed generator exactly once");
assert.match(directRequests[0].input, new RegExp(ADULT_PROMPT_VERSION, "u"));
assert.match(directRequests[0].input, /"outputMode":"structural_fade_to_black"/u);
assert.match(directRequests[0].input, /"explicitText":false/u);
assert.match(directRequests[0].input, /"externalExecutionAllowed":false/u);
assert.match(directRequests[0].input, /"allowedParticipantDisplayNames":\["林澄","蘇錦魚"\]/u);
assertNoPrivateAdultEvidence(directRequests[0].input, directFixture, "closed generation prompt");
assert.equal(directCandidate.story, directFixture.story);
const directAdultReceipt = directCandidate.executionReceipt.adultNarrativeRuntime;
assert.deepEqual(Object.keys(directAdultReceipt).sort(), ADULT_RECEIPT_KEYS);
assert.equal(directAdultReceipt.schemaVersion, "rpg-adult-runtime-policy-receipt-v1");
assert.equal(directAdultReceipt.bindingSchemaVersion, "adult-narrative-runtime-binding-v1");
assert.equal(directAdultReceipt.promptContractVersion, ADULT_PROMPT_VERSION);
assert.equal(directAdultReceipt.outputKind, "structural_json");
assert.equal(directAdultReceipt.fadeToBlack, true);
assert.equal(directAdultReceipt.explicitText, false);
assert.equal(directAdultReceipt.externalExecutionAllowed, false);
assert.equal(directAdultReceipt.dataEgressAllowed, false);
assert.deepEqual(directAdultReceipt.participantDisplayNames, ["林澄", "蘇錦魚"]);
assert.equal(directAdultReceipt.participantCount, 2);
for (const digestKey of [
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
]) assert.match(directAdultReceipt[digestKey], /^[a-f0-9]{64}$/u, `${digestKey} must be sealed`);
await verifyRpgAdultRuntimePolicyReceipt({ candidate: directCandidate, snapshot: directFixture.snapshot });
assertNoPrivateAdultEvidence(
  JSON.stringify(directCandidate.executionReceipt),
  directFixture,
  "returned execution receipt",
);
assert.equal(directCandidate.actualExecutor, "local-ollama");
assert.equal(directCandidate.executionReceipt.externalRequest, false);
assert.equal(directCandidate.executionReceipt.dataLeftDevice, false);

{
  const tamperedCandidate = structuredClone(directCandidate);
  const receipt = tamperedCandidate.executionReceipt.adultNarrativeRuntime;
  receipt.participantDisplayNames = [...receipt.participantDisplayNames].reverse();
  receipt.participantDisplayNameDigest = await sha256Hex(stableStringify(
    receipt.participantDisplayNames,
  ));
  receipt.upstreamApplicationValidationBindingDigest =
    await bindRpgAdultApplicationValidationDigest({
      baseApplicationValidationDigest:
        receipt.upstreamApplicationValidationBaseDigest,
      policyDigests: {
        runtimeBindingDigest: receipt.runtimeBindingDigest,
        scopeBindingDigest: receipt.scopeBindingDigest,
        participantDisplayNameDigest: receipt.participantDisplayNameDigest,
        policyBindingDigest: receipt.policyBindingDigest,
        promptBindingDigest: receipt.promptBindingDigest,
      },
    });
  const tamperedBody = { ...receipt };
  delete tamperedBody.receiptDigest;
  receipt.receiptDigest = await sha256Hex(stableStringify(tamperedBody));
  await verifyRpgAdultRuntimePolicyReceipt({
    candidate: tamperedCandidate,
    snapshot: directFixture.snapshot,
  });
  await assert.rejects(
    () => verifyRpgAdultRuntimePolicyReceipt({
      candidate: tamperedCandidate,
      snapshot: directFixture.snapshot,
      authoritativeClosedCandidate: createRpgAdultRuntimeClosedResult(
        directRequests[0],
        directFixture,
      ),
    }),
    (error) => error?.code === "RPG_ADULT_RUNTIME_POLICY_RECEIPT_INVALID",
    "a self-resealed adult wrapper must fail against the request-contract-bound authoritative candidate",
  );

  const extraKeyCandidate = structuredClone(directCandidate);
  extraKeyCandidate.executionReceipt.adultNarrativeRuntime.participantId =
    directFixture.adultNarrativeRuntime.participantIds[0];
  await assert.rejects(
    () => verifyRpgAdultRuntimePolicyReceipt({
      candidate: extraKeyCandidate,
      snapshot: directFixture.snapshot,
    }),
    (error) => error?.code === "RPG_ADULT_RUNTIME_POLICY_RECEIPT_INVALID",
    "adult wrapper extra keys must fail the exact allowlist",
  );
}

for (const missingEvidenceKind of ["consent", "safety", "consent_scope", "safety_scope"]) {
  const fixture = cloneFixture();
  if (missingEvidenceKind === "consent") fixture.adultNarrativeRuntime.consentEvidence = [];
  if (missingEvidenceKind === "safety") fixture.adultNarrativeRuntime.safetyEvidence = null;
  if (missingEvidenceKind === "consent_scope") {
    fixture.adultNarrativeRuntime.consentEvidence[0].scopeId = "stale-logical-turn";
  }
  if (missingEvidenceKind === "safety_scope") {
    fixture.adultNarrativeRuntime.safetyEvidence.scopeId = "stale-logical-turn";
  }
  let invocations = 0;
  await assert.rejects(
    () => generateRpgChatTurnCandidate({
      snapshot: fixture.snapshot,
      choice: fixture.choice,
      logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
      adultNarrativeRuntime: fixture.adultNarrativeRuntime,
      adultNarrativeRuntimeClock: () => new Date("2026-08-30T06:00:00.000Z"),
      generationDeadlineMs: 10,
      closedAIInvoker: async (request) => {
        invocations += 1;
        return createRpgAdultRuntimeClosedResult(request, fixture);
      },
    }),
    (error) => error?.code === "ADULT_NARRATIVE_RUNTIME_BINDING_REJECTED",
    `missing ${missingEvidenceKind} evidence must reject`,
  );
  assert.equal(invocations, 0, `missing ${missingEvidenceKind} evidence reached generation`);
}

{
  const fixture = cloneFixture();
  let invocations = 0;
  await assert.rejects(
    () => generateRpgChatTurnCandidate({
      snapshot: fixture.snapshot,
      choice: fixture.choice,
      logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
      generationDeadlineMs: 10,
      closedAIInvoker: async () => { invocations += 1; throw new Error("must not run"); },
    }),
    (error) => error?.code === "RPG_ADULT_RUNTIME_EVIDENCE_REQUIRED",
    "adultMode without runtime evidence must fail closed",
  );
  assert.equal(invocations, 0, "adultMode without runtime evidence reached generation");
}

for (const requestField of ["narrativeGoal", "irreversibleEvent", "cost"]) {
  const fixture = cloneFixture();
  const privateId = requestField === "cost"
    ? "2f9c6f8b-6ce0-4dd2-91b9-a28a5e7c50f2"
    : fixture.adultNarrativeRuntime.participantIds[0];
  fixture.adultNarrativeRuntime.request[requestField] = `A prose request containing ${privateId}`;
  let invocations = 0;
  await assert.rejects(
    () => generateRpgChatTurnCandidate({
      snapshot: fixture.snapshot,
      choice: fixture.choice,
      logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
      adultNarrativeRuntime: fixture.adultNarrativeRuntime,
      adultNarrativeRuntimeClock: () => new Date("2026-08-30T06:00:00.000Z"),
      generationDeadlineMs: 10,
      closedAIInvoker: async () => { invocations += 1; throw new Error("must not run"); },
    }),
    (error) => {
      assert.equal(error?.code, "ADULT_NARRATIVE_RUNTIME_BINDING_REJECTED");
      const serializedIssues = JSON.stringify(error?.issues ?? []);
      assert.doesNotMatch(serializedIssues, new RegExp(privateId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.match(serializedIssues, /INTERNAL_IDENTIFIER_NOT_ALLOWED/u);
      return true;
    },
    `${requestField} must reject canonical/internal IDs without leaking them in issues`,
  );
  assert.equal(invocations, 0, `${requestField} identifier injection reached generation`);
}

{
  const fixture = cloneFixture();
  fixture.adultNarrativeRuntime.evaluatedAt = "2026-08-30T05:00:00.000Z";
  let invocations = 0;
  await assert.rejects(
    () => generateRpgChatTurnCandidate({
      snapshot: fixture.snapshot,
      choice: fixture.choice,
      logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
      adultNarrativeRuntime: fixture.adultNarrativeRuntime,
      adultNarrativeRuntimeClock: () => new Date("2026-08-30T08:00:00.000Z"),
      generationDeadlineMs: 10,
      closedAIInvoker: async () => { invocations += 1; throw new Error("must not run"); },
    }),
    (error) => error?.code === "ADULT_NARRATIVE_RUNTIME_BINDING_REJECTED"
      && JSON.stringify(error.issues).includes("CONSENT_EVIDENCE_EXPIRED"),
    "caller-controlled evaluatedAt must not backdate expired consent",
  );
  assert.equal(invocations, 0, "expired consent reached generation");
}

const reviewFixture = cloneFixture();
let reviewClock = 0;
const reviewGenerationRequests = [];
const reviewRequests = [];
const fallbackReviewedCandidate = await generateRpgChatTurnCandidate({
  snapshot: reviewFixture.snapshot,
  choice: reviewFixture.choice,
  logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
  adultNarrativeRuntime: reviewFixture.adultNarrativeRuntime,
  adultNarrativeRuntimeClock: () => new Date("2026-08-30T06:00:00.000Z"),
  // Leave enough real wall-clock headroom for raceRpgClosedAIOperation while
  // the injected coordination clock still deterministically exhausts it.
  generationDeadlineMs: 200,
  fallbackReviewDeadlineMs: 200,
  coordinationDependencies: {
    now: () => reviewClock,
    wait: async (delayMs) => { reviewClock += delayMs; },
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async (request) => {
    if (request.ephemeralPrompt) {
      reviewRequests.push(request);
      return createRpgAdultRuntimeClosedResult(request, reviewFixture, {
        candidateId: "candidate-adult-runtime-fallback-review",
      });
    }
    reviewGenerationRequests.push(request);
    throw Object.assign(new Error("closed generation still loading"), { code: "MODEL_LOADING" });
  },
});
assert.equal(reviewGenerationRequests.length, 1, "closed generation must dispatch exactly once before fallback");
assert.notEqual(reviewGenerationRequests[0].ephemeralPrompt, true);
assert.equal(reviewRequests.length, 1, "hidden fallback review should execute once");
assert.equal(reviewRequests[0].ephemeralPrompt, true);
assert.match(reviewRequests[0].input, new RegExp(ADULT_PROMPT_VERSION, "u"));
assert.match(reviewRequests[0].input, /"outputMode":"structural_fade_to_black"/u);
assertNoPrivateAdultEvidence(reviewRequests[0].input, reviewFixture, "hidden fallback review prompt");
assert.equal(
  fallbackReviewedCandidate.executionReceipt.adultNarrativeRuntime?.fadeToBlack,
  true,
  "fallback-reviewed receipt must retain the adult structural policy summary",
);
assert.deepEqual(
  Object.keys(fallbackReviewedCandidate.executionReceipt.adultNarrativeRuntime).sort(),
  ADULT_RECEIPT_KEYS,
  "fallback review must retain the exact adult receipt allowlist",
);
await verifyRpgAdultRuntimePolicyReceipt({
  candidate: fallbackReviewedCandidate,
  snapshot: reviewFixture.snapshot,
});
assert.ok(
  fallbackReviewedCandidate.executionReceipt.postFallbackClosedReview,
  "fallback output must retain its verified hidden-review receipt",
);
assertNoPrivateAdultEvidence(
  JSON.stringify(fallbackReviewedCandidate.executionReceipt),
  reviewFixture,
  "fallback-reviewed execution receipt",
);

{
  const cascadeFixture = cloneFixture();
  let externalDispatches = 0;
  let closedDispatches = 0;
  const policyBlockedCandidate =
    await generateRpgChatTurnCandidateWithExternalCascade({
      snapshot: cascadeFixture.snapshot,
      choice: cascadeFixture.choice,
      logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
      providerId: "gemini",
      executionMode: "external-only",
      consentIntent: null,
      publicExecutionEnabled: true,
      providerConfigured: true,
      adultNarrativeRuntime: cascadeFixture.adultNarrativeRuntime,
      adultNarrativeRuntimeClock: () =>
        new Date("2026-08-30T06:00:00.000Z"),
      externalInvoker: async () => {
        externalDispatches += 1;
        throw new Error("adult content must never reach external dispatch");
      },
      closedInvoker: async (closedInput) => {
        closedDispatches += 1;
        return generateRpgChatTurnCandidate({
          ...closedInput,
          generationDeadlineMs: 100,
          coordinationDependencies: INJECTED_READY_COORDINATION,
          closedAIInvoker: async (request) =>
            createRpgAdultRuntimeClosedResult(
              request,
              cascadeFixture,
              { candidateId: "candidate-adult-policy-blocked-cascade" },
            ),
        });
      },
    });
  assert.equal(externalDispatches, 0, "adult external cascade crossed the dispatch boundary");
  assert.equal(closedDispatches, 1, "adult external selection did not route directly to local closed AI");
  const policyBlockedLineage = await verifyExternalRpgFailureLineage(
    policyBlockedCandidate,
  );
  assert.equal(policyBlockedLineage?.attempted, false);
  assert.equal(policyBlockedLineage?.dispatchState, "policy-blocked");
  assert.equal(policyBlockedLineage?.dataLeftDevice, false);
  assert.equal(policyBlockedLineage?.publicContextDigest, null);
  assert.equal(policyBlockedLineage?.promptDigest, null);
  assert.equal(policyBlockedLineage?.fieldManifestDigest, null);
  assertNoPrivateAdultEvidence(
    JSON.stringify(policyBlockedCandidate.executionReceipt),
    cascadeFixture,
    "policy-blocked external lineage",
  );
  await verifyRpgAdultRuntimePolicyReceipt({
    candidate: policyBlockedCandidate,
    snapshot: cascadeFixture.snapshot,
  });
}

const externalFixture = cloneFixture();
let externalClock = 0;
let externalGenerationInvocations = 0;
let externalReviewInvocations = 0;
await assert.rejects(
  () => generateRpgChatTurnCandidate({
    snapshot: externalFixture.snapshot,
    choice: externalFixture.choice,
    logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
    adultNarrativeRuntime: externalFixture.adultNarrativeRuntime,
    adultNarrativeRuntimeClock: () => new Date("2026-08-30T06:00:00.000Z"),
    generationDeadlineMs: 2,
    fallbackReviewDeadlineMs: 2,
    coordinationDependencies: {
      now: () => externalClock,
      wait: async (delayMs) => { externalClock += delayMs; },
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
    closedAIInvoker: async (request) => {
      if (request.ephemeralPrompt) externalReviewInvocations += 1;
      else externalGenerationInvocations += 1;
      return createRpgAdultRuntimeExternalResult(request, externalFixture);
    },
  }),
  (error) => error?.code === "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED",
  "an external execution result must never become an adult RPG candidate",
);
assert.equal(externalGenerationInvocations, 1, "external-proof generation must dispatch exactly once");
assert.equal(externalReviewInvocations, 1, "external-proof review must dispatch exactly once");

for (const [label, unsafeSentence] of [
  ["direct terms", "她沒有聲張；兩人隨即明確描寫性交與射精，之後才把東側窄巷交給可信的人盯住。"],
  ["euphemistic entry", "她沒有聲張；兩人脫去衣物，他反覆進入她體內直到高潮，之後才把東側窄巷交給可信的人盯住。"],
  ["undress and contact", "她沒有聲張；她解開衣物，他觸碰她裸露的乳房，兩人纏綿至天亮。"],
]) {
  const explicitFixture = cloneFixture();
  const explicitStory = explicitFixture.story.replace(
    "她沒有聲張，只把東側窄巷交給可信的人盯住。",
    unsafeSentence,
  );
  let explicitClock = 0;
  let explicitGenerationInvocations = 0;
  let explicitReviewInvocations = 0;
  await assert.rejects(
    () => generateRpgChatTurnCandidate({
      snapshot: explicitFixture.snapshot,
      choice: explicitFixture.choice,
      logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
      adultNarrativeRuntime: explicitFixture.adultNarrativeRuntime,
      adultNarrativeRuntimeClock: () => new Date("2026-08-30T06:00:00.000Z"),
      generationDeadlineMs: 2,
      fallbackReviewDeadlineMs: 2,
      coordinationDependencies: {
        now: () => explicitClock,
        wait: async (delayMs) => { explicitClock += delayMs; },
        probeAvailability: async () => "ready",
        retryBackoffMs: 1,
      },
      closedAIInvoker: async (request) => {
        if (request.ephemeralPrompt) explicitReviewInvocations += 1;
        else explicitGenerationInvocations += 1;
        return createRpgAdultRuntimeClosedResult(request, explicitFixture, {
          candidateId: `candidate-explicit-${label}-${explicitGenerationInvocations}-${explicitReviewInvocations}`,
          story: explicitStory,
        });
      },
    }),
    (error) => error?.code === "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED",
    `${label}: fade-to-black must be enforced on normal and hidden-review output`,
  );
  assert.equal(explicitGenerationInvocations, 1, `${label}: generation must dispatch exactly once`);
  assert.equal(explicitReviewInvocations, 1, `${label}: review must dispatch exactly once`);
}

{
  const thirdPartyFixture = cloneFixture();
  thirdPartyFixture.snapshot.characters.push({
    id: "character-adult-runtime-third-party",
    projectId: thirdPartyFixture.projectId,
    name: "葉聞雪",
    aliases: [],
    age: 603,
    ageVerified: true,
  });
  const unauthorizedStory = thirdPartyFixture.story.replace(
    "紙上沒有姓名，只有三次交貨的先後記號",
    "葉聞雪親吻林澄後退入暗處。紙上沒有姓名，只有三次交貨的先後記號",
  );
  let clock = 0;
  let generationInvocations = 0;
  let reviewInvocations = 0;
  await assert.rejects(
    () => generateRpgChatTurnCandidate({
      snapshot: thirdPartyFixture.snapshot,
      choice: thirdPartyFixture.choice,
      logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
      adultNarrativeRuntime: thirdPartyFixture.adultNarrativeRuntime,
      adultNarrativeRuntimeClock: () => new Date("2026-08-30T06:00:00.000Z"),
      generationDeadlineMs: 2,
      fallbackReviewDeadlineMs: 2,
      coordinationDependencies: {
        now: () => clock,
        wait: async (delayMs) => { clock += delayMs; },
        probeAvailability: async () => "ready",
        retryBackoffMs: 1,
      },
      closedAIInvoker: async (request) => {
        if (request.ephemeralPrompt) reviewInvocations += 1;
        else generationInvocations += 1;
        return createRpgAdultRuntimeClosedResult(request, thirdPartyFixture, {
          candidateId: `candidate-unauthorized-third-${generationInvocations}-${reviewInvocations}`,
          story: unauthorizedStory,
        });
      },
    }),
    (error) => error?.code === "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED",
    "an unconsented known third character must not enter an adult transition",
  );
  assert.equal(generationInvocations, 1, "unauthorized third-party generation must dispatch exactly once");
  assert.equal(reviewInvocations, 1, "unauthorized third-party review must dispatch exactly once");
}

const generalFixture = cloneFixture();
generalFixture.snapshot.project.adultMode = false;
generalFixture.snapshot.project.adultExperienceProfile = null;
generalFixture.snapshot.characters.forEach((character) => {
  character.age = null;
  character.ageVerified = false;
});
let generalRequest = null;
const generalCandidate = await generateRpgChatTurnCandidate({
  snapshot: generalFixture.snapshot,
  choice: generalFixture.choice,
  logicalTurnId: "logical-turn-general-rpg-production",
  generationDeadlineMs: 100,
  coordinationDependencies: INJECTED_READY_COORDINATION,
  closedAIInvoker: async (request) => {
    generalRequest = request;
    return createRpgAdultRuntimeClosedResult(request, generalFixture, {
      candidateId: "candidate-general-rpg-production",
    });
  },
});
assert.ok(generalRequest, "general RPG did not reach the normal closed generator");
assert.doesNotMatch(generalRequest.input, new RegExp(ADULT_PROMPT_VERSION, "u"));
assert.equal(
  Object.hasOwn(generalCandidate.executionReceipt, "adultNarrativeRuntime"),
  false,
  "general RPG receipt must remain unchanged",
);
assert.equal(generalCandidate.story, generalFixture.story);

console.log(JSON.stringify({
  status: "PASS",
  adultClosedPromptBound: true,
  fallbackReviewPromptBound: true,
  singleGenerationDispatch: true,
  singleFallbackReviewDispatch: true,
  failBeforeGeneration: true,
  externalExecutionRejected: true,
  externalAdultDispatchAttempted: false,
  authoritativeReceiptTamperRejected: true,
  explicitOutputRejectedBeforePersistence: true,
  promptAndReceiptEvidenceLeak: false,
  generalRpgUnchanged: true,
}, null, 2));
