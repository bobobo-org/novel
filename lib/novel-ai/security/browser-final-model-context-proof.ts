import { sha256Hex, stableStringify } from "../closed-ai-cache";

export const BROWSER_FINAL_CONTEXT_MARKER_VERSION = "CTX3" as const;
export const BROWSER_FINAL_MODEL_CONTEXT_PROOF_VERSION =
  "browser-final-model-context-proof-v4" as const;
export const BROWSER_FINAL_MODEL_CONTEXT_ATTESTATION_VERSION =
  "browser-final-model-context-attestation-v4" as const;
export const BROWSER_CONTEXT_ATTESTATION_POLICY_VERSION =
  "browser-context-attestation-policy-v1" as const;

/**
 * Declared before Browser inference. It is never inferred from whether a proof
 * happened to be returned, because doing so would make proof removal a valid
 * downgrade from a T2 request to a proof-free receipt.
 */
export type BrowserContextAttestationRequirement =
  | "not_required"
  | "required";

export type BrowserFinalContextSourceKind =
  | "approved-story-bible"
  | "selected-local-attachment-summary";

export type BrowserFinalContextSourceAuthority =
  | "composer-repository-verified"
  | "user-selected-sanitized-untrusted-reference";

export type BrowserFinalContextSourceIdentity = {
  /** Ephemeral only. This value must never be copied into a receipt. */
  sourceId: string;
  sourceKind: BrowserFinalContextSourceKind;
  authority: BrowserFinalContextSourceAuthority;
  sourceArtifactDigest: string;
  sourceRevisionDigest: string;
  receiptRequired: true;
};

export type BrowserFinalContextExpectation = {
  ordinal: number;
  sourceIdDigest: string;
  sourceKind: BrowserFinalContextSourceKind;
  authority: BrowserFinalContextSourceAuthority;
  originalDigest: string;
  sourceArtifactDigest: string;
  sourceRevisionDigest: string;
  sourceMetadataDigest: string;
};

export type BrowserFinalModelContextInnerStage =
  | "initial"
  | "repair"
  | "extension"
  | "recovery"
  | "segment-1"
  | "segment-2"
  | "segment-3";

export type BrowserFinalModelContextPipelineKind =
  | "legacy-bounded-quality-v1"
  | "browser-prose-composer-v1";

export type BrowserFinalModelContextInnerIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type BrowserFinalContextOuterTaskType = string;

export type BrowserFinalModelMessageDescriptor = {
  index: 0 | 1;
  role: "system" | "user";
  digest: string;
  utf8Bytes: number;
  characters: number;
};

export type BrowserFinalModelContextBinding = BrowserFinalContextExpectation & {
  messageIndex: 1;
  segmentIndex: number;
  startUtf8Byte: number;
  endUtf8Byte: number;
  survivingFragmentDigest: string;
  survivingFragmentUtf8Bytes: number;
  survivingFragmentCharacters: number;
  coverage: "fragment";
};

export type BrowserFinalModelContextInvocationProof = {
  schemaVersion: typeof BROWSER_FINAL_MODEL_CONTEXT_PROOF_VERSION;
  digestSuite: "sha256-utf8-exact-v1";
  outerRequestIdDigest: string;
  invocationRequestIdDigest: string;
  outerTaskType: BrowserFinalContextOuterTaskType;
  outerQualityPhase: "draft" | "critic" | "revision";
  pipelineKind: BrowserFinalModelContextPipelineKind;
  innerStage: BrowserFinalModelContextInnerStage;
  innerIndex: BrowserFinalModelContextInnerIndex;
  modelId: string;
  modelDigest: string;
  callOptionsDigest: string;
  requiredManifestDigest: string;
  messageDescriptors: [
    BrowserFinalModelMessageDescriptor,
    BrowserFinalModelMessageDescriptor,
  ];
  contextBindings: BrowserFinalModelContextBinding[];
  omittedCharacters: number;
  rawTextStored: false;
  bindingDigest: string;
};

export type BrowserFinalModelContextAttestation = {
  schemaVersion: typeof BROWSER_FINAL_MODEL_CONTEXT_ATTESTATION_VERSION;
  pipelineKind: BrowserFinalModelContextPipelineKind;
  acceptedDisposition:
    | "standalone"
    | "composed-extension"
    | "composed-segments";
  acceptedStage: BrowserFinalModelContextInnerStage;
  extensionBaseStage: "initial" | "repair" | null;
  executedStages: BrowserFinalModelContextInnerStage[];
  outerQualityPhase: "draft" | "critic" | "revision";
  outerRequestIdDigest: string;
  outerTaskType: BrowserFinalContextOuterTaskType;
  requiredManifestDigest: string;
  contributingCalls: BrowserFinalModelContextInvocationProof[];
  rawTextStored: false;
  bindingDigest: string;
};

const DIGEST = /^[a-f0-9]{64}$/u;
const RESERVED_MARKER = "[[CTX3:";
const MAX_REQUIRED_CONTEXT_SOURCES = 13;
const SOURCE_KINDS = new Set<BrowserFinalContextSourceKind>([
  "approved-story-bible",
  "selected-local-attachment-summary",
]);
const SOURCE_AUTHORITIES = new Set<BrowserFinalContextSourceAuthority>([
  "composer-repository-verified",
  "user-selected-sanitized-untrusted-reference",
]);
const INNER_STAGES = new Set<BrowserFinalModelContextInnerStage>([
  "initial",
  "repair",
  "extension",
  "recovery",
  "segment-1",
  "segment-2",
  "segment-3",
]);
const PIPELINE_KINDS = new Set<BrowserFinalModelContextPipelineKind>([
  "legacy-bounded-quality-v1",
  "browser-prose-composer-v1",
]);
const ACCEPTED_DISPOSITIONS = new Set<
  BrowserFinalModelContextAttestation["acceptedDisposition"]
>(["standalone", "composed-extension", "composed-segments"]);

function expectedLegacyInnerIndex(stage: BrowserFinalModelContextInnerStage) {
  return stage === "initial" ? 0 : stage === "repair" ? 1 : 2;
}

function invocationStageMatchesPipeline(input: {
  pipelineKind: BrowserFinalModelContextPipelineKind;
  innerStage: BrowserFinalModelContextInnerStage;
  innerIndex: BrowserFinalModelContextInnerIndex;
}) {
  if (input.pipelineKind === "legacy-bounded-quality-v1") {
    return new Set<BrowserFinalModelContextInnerStage>([
      "initial",
      "repair",
      "extension",
      "recovery",
    ]).has(input.innerStage)
      && input.innerIndex === expectedLegacyInnerIndex(input.innerStage);
  }
  return input.innerStage === "initial"
    ? input.innerIndex === 0
    : new Set<BrowserFinalModelContextInnerStage>([
      "segment-1",
      "segment-2",
      "segment-3",
    ]).has(input.innerStage) && input.innerIndex >= 1;
}

function sourceAuthorityMatchesKind(
  sourceKind: BrowserFinalContextSourceKind,
  authority: BrowserFinalContextSourceAuthority,
) {
  return sourceKind === "approved-story-bible"
    ? authority === "composer-repository-verified"
    : authority === "user-selected-sanitized-untrusted-reference";
}

function proofError(code: string) {
  return Object.assign(new Error(code), { code });
}

function exactUtf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isSafeInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function assertDigest(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw proofError(code);
}

function marker(
  boundary: "B" | "E",
  expectation: BrowserFinalContextExpectation,
) {
  const sourceKind = expectation.sourceKind === "approved-story-bible"
    ? "sb"
    : "att";
  return `[[${BROWSER_FINAL_CONTEXT_MARKER_VERSION}:${boundary}|o=${expectation.ordinal}|sid=${expectation.sourceIdDigest}|k=${sourceKind}|src=${expectation.originalDigest}|m=${expectation.sourceMetadataDigest}]]`;
}

export async function createBrowserFinalContextExpectation(input: {
  identity: BrowserFinalContextSourceIdentity;
  ordinal: number;
  serializedSource: string;
}): Promise<BrowserFinalContextExpectation> {
  if (
    !input.identity.sourceId.trim()
    || !SOURCE_KINDS.has(input.identity.sourceKind)
    || !SOURCE_AUTHORITIES.has(input.identity.authority)
    || !sourceAuthorityMatchesKind(
      input.identity.sourceKind,
      input.identity.authority,
    )
    || input.identity.receiptRequired !== true
    || !isSafeInteger(input.ordinal, 1, MAX_REQUIRED_CONTEXT_SOURCES)
  ) throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  assertDigest(
    input.identity.sourceArtifactDigest,
    "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
  );
  assertDigest(
    input.identity.sourceRevisionDigest,
    "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
  );
  const normalized = input.serializedSource.replace(/\r\n?/gu, "\n").trim();
  if (!normalized || normalized.includes(RESERVED_MARKER)) {
    throw proofError("BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID");
  }
  const sourceMetadataDigest = await sha256Hex(stableStringify({
    domain: "browser-final-context-source-metadata-v3",
    sourceKind: input.identity.sourceKind,
    authority: input.identity.authority,
    sourceArtifactDigest: input.identity.sourceArtifactDigest,
    sourceRevisionDigest: input.identity.sourceRevisionDigest,
  }));
  return {
    ordinal: input.ordinal,
    sourceIdDigest: await sha256Hex(stableStringify({
      domain: "browser-final-context-source-id-v3",
      sourceId: input.identity.sourceId,
      sourceKind: input.identity.sourceKind,
    })),
    sourceKind: input.identity.sourceKind,
    authority: input.identity.authority,
    originalDigest: await sha256Hex(normalized),
    sourceArtifactDigest: input.identity.sourceArtifactDigest,
    sourceRevisionDigest: input.identity.sourceRevisionDigest,
    sourceMetadataDigest,
  };
}

export function sealBrowserFinalContextFragment(input: {
  expectation: BrowserFinalContextExpectation;
  fragment: string;
}) {
  assertBrowserFinalContextExpectation(input.expectation);
  const rawFragment = input.fragment.replace(/\r\n?/gu, "\n").trim();
  const fragment = rawFragment
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
  if (!fragment || fragment.includes(RESERVED_MARKER)) {
    throw proofError("BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID");
  }
  return [
    marker("B", input.expectation),
    fragment,
    marker("E", input.expectation),
  ].join("\n");
}

export function compactBrowserFinalContextSealedFragment(input: {
  expectation: BrowserFinalContextExpectation;
  sealedFragment: string;
  maximumFragmentCharacters: number;
}) {
  assertBrowserFinalContextExpectation(input.expectation);
  if (!isSafeInteger(input.maximumFragmentCharacters, 1, 10_000_000)) {
    throw proofError("BROWSER_FINAL_CONTEXT_BUDGET_EXCEEDED");
  }
  const begin = marker("B", input.expectation);
  const end = marker("E", input.expectation);
  const expectedPrefix = `${begin}\n`;
  const expectedSuffix = `\n${end}`;
  const value = input.sealedFragment.replace(/\r\n?/gu, "\n").trim();
  if (
    !value.startsWith(expectedPrefix)
    || !value.endsWith(expectedSuffix)
    || value.split(RESERVED_MARKER).length - 1 !== 2
  ) throw proofError("BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID");
  const fragment = value.slice(expectedPrefix.length, -expectedSuffix.length);
  if (!fragment || fragment.includes(RESERVED_MARKER)) {
    throw proofError("BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID");
  }
  const compacted = Array.from(fragment)
    .slice(0, input.maximumFragmentCharacters)
    .join("");
  if (!compacted) throw proofError("BROWSER_FINAL_CONTEXT_BUDGET_EXCEEDED");
  return `${begin}\n${compacted}\n${end}`;
}

function sealedFragmentCharacters(input: {
  expectation: BrowserFinalContextExpectation;
  sealedFragment: string;
}) {
  const full = compactBrowserFinalContextSealedFragment({
    ...input,
    maximumFragmentCharacters: 10_000_000,
  });
  const begin = `${marker("B", input.expectation)}\n`;
  const end = `\n${marker("E", input.expectation)}`;
  return Array.from(full.slice(begin.length, -end.length));
}

export function fitBrowserFinalContextProtectedBlock(input: {
  expectations: BrowserFinalContextExpectation[];
  sealedFragments: string[];
  maximumCharacters: number;
}) {
  assertExpectationSequence(input.expectations);
  if (
    input.expectations.length !== input.sealedFragments.length
    || !isSafeInteger(input.maximumCharacters, 1, 10_000_000)
  ) throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  if (!input.expectations.length) {
    return { block: "", omittedCharacters: 0, includedSourceCount: 0 };
  }
  const payloads = input.sealedFragments.map((sealedFragment, index) => (
    sealedFragmentCharacters({
      expectation: input.expectations[index],
      sealedFragment,
    })
  ));
  const build = (counts: number[]) => [
    "<approved-model-context>",
    ...counts.map((count, index) => compactBrowserFinalContextSealedFragment({
      expectation: input.expectations[index],
      sealedFragment: input.sealedFragments[index],
      maximumFragmentCharacters: count,
    })),
    "</approved-model-context>",
  ].join("\n\n");
  const minimumCounts = payloads.map(() => 1);
  const minimum = build(minimumCounts);
  if (minimum.length > input.maximumCharacters) {
    throw proofError("BROWSER_FINAL_CONTEXT_BUDGET_EXCEEDED");
  }
  let low = 0;
  let high = 1;
  let bestCounts = minimumCounts;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const ratio = (low + high) / 2;
    const counts = payloads.map((payload) => (
      1 + Math.floor((payload.length - 1) * ratio)
    ));
    if (build(counts).length <= input.maximumCharacters) {
      low = ratio;
      bestCounts = counts;
    } else {
      high = ratio;
    }
  }
  for (let index = 0; index < bestCounts.length; index += 1) {
    while (bestCounts[index] < payloads[index].length) {
      const candidate = [...bestCounts];
      candidate[index] += 1;
      if (build(candidate).length > input.maximumCharacters) break;
      bestCounts = candidate;
    }
  }
  const block = build(bestCounts);
  return {
    block,
    omittedCharacters: payloads.reduce(
      (sum, payload, index) => sum + payload.length - bestCounts[index],
      0,
    ),
    includedSourceCount: input.expectations.length,
  };
}

export function assertBrowserFinalContextExpectation(
  value: BrowserFinalContextExpectation,
) {
  if (
    !value
    || typeof value !== "object"
    || Object.keys(value).sort().join(",") !== [
      "authority",
      "ordinal",
      "originalDigest",
      "sourceArtifactDigest",
      "sourceIdDigest",
      "sourceKind",
      "sourceMetadataDigest",
      "sourceRevisionDigest",
    ].sort().join(",")
    || !isSafeInteger(value.ordinal, 1, MAX_REQUIRED_CONTEXT_SOURCES)
    || !SOURCE_KINDS.has(value.sourceKind)
    || !SOURCE_AUTHORITIES.has(value.authority)
    || !sourceAuthorityMatchesKind(value.sourceKind, value.authority)
  ) throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  for (const digest of [
    value.sourceIdDigest,
    value.originalDigest,
    value.sourceArtifactDigest,
    value.sourceMetadataDigest,
    value.sourceRevisionDigest,
  ]) assertDigest(digest, "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
}

export async function browserFinalContextManifestDigest(input: {
  outerRequestIdDigest: string;
  outerTaskType: BrowserFinalContextOuterTaskType;
  outerQualityPhase: "draft" | "critic" | "revision";
  expectations: BrowserFinalContextExpectation[];
}) {
  assertDigest(input.outerRequestIdDigest, "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  if (
    !/^[A-Za-z][A-Za-z0-9.-]{1,80}$/u.test(input.outerTaskType)
    || !new Set(["draft", "critic", "revision"]).has(input.outerQualityPhase)
  ) {
    throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  }
  assertExpectationSequence(input.expectations);
  return sha256Hex(stableStringify({
    domain: "browser-final-context-required-manifest-v3",
    outerRequestIdDigest: input.outerRequestIdDigest,
    outerTaskType: input.outerTaskType,
    outerQualityPhase: input.outerQualityPhase,
    expectations: input.expectations,
  }));
}

function assertExpectationSequence(expectations: BrowserFinalContextExpectation[]) {
  if (
    !Array.isArray(expectations)
    || expectations.length > MAX_REQUIRED_CONTEXT_SOURCES
  ) {
    throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  }
  expectations.forEach((expectation, index) => {
    assertBrowserFinalContextExpectation(expectation);
    if (expectation.ordinal !== index + 1) {
      throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
    }
  });
  if (new Set(expectations.map((item) => item.sourceIdDigest)).size !== expectations.length) {
    throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  }
}

function assertMarkerInventory(
  userMessage: string,
  expectations: BrowserFinalContextExpectation[],
) {
  const observed = userMessage.match(/\[\[CTX3:[^\]\r\n]{1,512}\]\]/gu) ?? [];
  const expected = expectations.flatMap((expectation) => [
    marker("B", expectation),
    marker("E", expectation),
  ]);
  if (
    userMessage.split(RESERVED_MARKER).length - 1 !== expected.length
    || observed.length !== expected.length
    || observed.some((value, index) => value !== expected[index])
  ) throw proofError("BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID");
}

async function createContextBindings(
  userMessage: string,
  expectations: BrowserFinalContextExpectation[],
): Promise<BrowserFinalModelContextBinding[]> {
  assertExpectationSequence(expectations);
  assertMarkerInventory(userMessage, expectations);
  const output: BrowserFinalModelContextBinding[] = [];
  let previousEnd = -1;
  for (const [index, expectation] of expectations.entries()) {
    const begin = marker("B", expectation);
    const end = marker("E", expectation);
    const beginOffset = userMessage.indexOf(begin);
    const duplicateBegin = userMessage.indexOf(begin, beginOffset + begin.length);
    const endOffset = userMessage.indexOf(end, beginOffset + begin.length);
    const duplicateEnd = userMessage.indexOf(end, endOffset + end.length);
    if (
      beginOffset < 0
      || endOffset < 0
      || duplicateBegin >= 0
      || duplicateEnd >= 0
      || beginOffset <= previousEnd
      || userMessage[beginOffset + begin.length] !== "\n"
      || userMessage[endOffset - 1] !== "\n"
    ) throw proofError("BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID");
    const fragmentStart = beginOffset + begin.length + 1;
    const fragmentEnd = endOffset - 1;
    const fragment = userMessage.slice(fragmentStart, fragmentEnd);
    if (!fragment || Array.from(fragment).length < 1 || fragment.includes(RESERVED_MARKER)) {
      throw proofError("BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID");
    }
    const startUtf8Byte = exactUtf8Bytes(userMessage.slice(0, fragmentStart));
    const endUtf8Byte = startUtf8Byte + exactUtf8Bytes(fragment);
    output.push({
      ...expectation,
      messageIndex: 1,
      segmentIndex: index,
      startUtf8Byte,
      endUtf8Byte,
      survivingFragmentDigest: await sha256Hex(fragment),
      survivingFragmentUtf8Bytes: exactUtf8Bytes(fragment),
      survivingFragmentCharacters: Array.from(fragment).length,
      coverage: "fragment",
    });
    previousEnd = endOffset + end.length;
  }
  return output;
}

export async function createBrowserFinalModelContextInvocationProof(input: {
  outerRequestId: string;
  invocationRequestId: string;
  outerTaskType: BrowserFinalContextOuterTaskType;
  outerQualityPhase: "draft" | "critic" | "revision";
  pipelineKind?: BrowserFinalModelContextPipelineKind;
  innerStage: BrowserFinalModelContextInnerStage;
  innerIndex: BrowserFinalModelContextInnerIndex;
  modelId: string;
  modelDigest: string;
  callOptionsDigest: string;
  systemMessage: string;
  userMessage: string;
  expectations: BrowserFinalContextExpectation[];
  omittedCharacters: number;
}): Promise<BrowserFinalModelContextInvocationProof> {
  const pipelineKind = input.pipelineKind ?? "legacy-bounded-quality-v1";
  if (
    !input.outerRequestId.trim()
    || !input.invocationRequestId.trim()
    || !/^[A-Za-z][A-Za-z0-9.-]{1,80}$/u.test(input.outerTaskType)
    || !input.modelId.trim()
    || input.modelId.length > 192
    || !new Set(["draft", "critic", "revision"]).has(input.outerQualityPhase)
    || !PIPELINE_KINDS.has(pipelineKind)
    || !INNER_STAGES.has(input.innerStage)
    || !isSafeInteger(input.innerIndex, 0, 5)
    || !invocationStageMatchesPipeline({
      pipelineKind,
      innerStage: input.innerStage,
      innerIndex: input.innerIndex,
    })
    || !isSafeInteger(input.omittedCharacters, 0, 10_000_000)
  ) throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  assertDigest(input.modelDigest, "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  assertDigest(input.callOptionsDigest, "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  const outerRequestIdDigest = await sha256Hex(input.outerRequestId);
  const requiredManifestDigest = await browserFinalContextManifestDigest({
    outerRequestIdDigest,
    outerTaskType: input.outerTaskType,
    outerQualityPhase: input.outerQualityPhase,
    expectations: input.expectations,
  });
  const contextBindings = await createContextBindings(
    input.userMessage,
    input.expectations,
  );
  const messageDescriptors = [
    {
      index: 0 as const,
      role: "system" as const,
      digest: await sha256Hex(input.systemMessage),
      utf8Bytes: exactUtf8Bytes(input.systemMessage),
      characters: Array.from(input.systemMessage).length,
    },
    {
      index: 1 as const,
      role: "user" as const,
      digest: await sha256Hex(input.userMessage),
      utf8Bytes: exactUtf8Bytes(input.userMessage),
      characters: Array.from(input.userMessage).length,
    },
  ] satisfies BrowserFinalModelContextInvocationProof["messageDescriptors"];
  const body = {
    schemaVersion: BROWSER_FINAL_MODEL_CONTEXT_PROOF_VERSION,
    digestSuite: "sha256-utf8-exact-v1" as const,
    outerRequestIdDigest,
    invocationRequestIdDigest: await sha256Hex(input.invocationRequestId),
    outerTaskType: input.outerTaskType,
    outerQualityPhase: input.outerQualityPhase,
    pipelineKind,
    innerStage: input.innerStage,
    innerIndex: input.innerIndex,
    modelId: input.modelId,
    modelDigest: input.modelDigest,
    callOptionsDigest: input.callOptionsDigest,
    requiredManifestDigest,
    messageDescriptors,
    contextBindings,
    omittedCharacters: input.omittedCharacters,
    rawTextStored: false as const,
  };
  return {
    ...body,
    bindingDigest: await sha256Hex(stableStringify({
      domain: "browser-final-model-context-invocation-proof-v4",
      body,
    })),
  };
}

export async function verifyBrowserFinalModelContextInvocationProof(
  value: BrowserFinalModelContextInvocationProof,
) {
  try {
    if (
      !value
      || typeof value !== "object"
      || Object.keys(value).sort().join(",") !== [
        "bindingDigest",
        "callOptionsDigest",
        "contextBindings",
        "digestSuite",
        "innerIndex",
        "innerStage",
        "messageDescriptors",
        "modelDigest",
        "modelId",
        "omittedCharacters",
        "outerRequestIdDigest",
        "outerTaskType",
        "outerQualityPhase",
        "pipelineKind",
        "rawTextStored",
        "invocationRequestIdDigest",
        "requiredManifestDigest",
        "schemaVersion",
      ].sort().join(",")
      || value.schemaVersion !== BROWSER_FINAL_MODEL_CONTEXT_PROOF_VERSION
      || value.digestSuite !== "sha256-utf8-exact-v1"
      || value.rawTextStored !== false
      || !value.modelId.trim()
      || value.modelId.length > 192
      || !/^[A-Za-z][A-Za-z0-9.-]{1,80}$/u.test(value.outerTaskType)
      || !new Set(["draft", "critic", "revision"]).has(value.outerQualityPhase)
      || !PIPELINE_KINDS.has(value.pipelineKind)
      || !INNER_STAGES.has(value.innerStage)
      || !isSafeInteger(value.innerIndex, 0, 5)
      || !invocationStageMatchesPipeline(value)
      || !isSafeInteger(value.omittedCharacters, 0, 10_000_000)
      || !Array.isArray(value.messageDescriptors)
      || value.messageDescriptors.length !== 2
      || !Array.isArray(value.contextBindings)
      || value.contextBindings.length > MAX_REQUIRED_CONTEXT_SOURCES
    ) return false;
    for (const digest of [
      value.outerRequestIdDigest,
      value.invocationRequestIdDigest,
      value.modelDigest,
      value.callOptionsDigest,
      value.requiredManifestDigest,
      value.bindingDigest,
    ]) assertDigest(digest, "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
    const descriptorKeys = ["characters", "digest", "index", "role", "utf8Bytes"]
      .sort().join(",");
    for (const [index, descriptor] of value.messageDescriptors.entries()) {
      if (
        Object.keys(descriptor).sort().join(",") !== descriptorKeys
        || descriptor.index !== index
        || descriptor.role !== (index === 0 ? "system" : "user")
        || !isSafeInteger(descriptor.utf8Bytes, 0, 100_000_000)
        || !isSafeInteger(descriptor.characters, 0, 100_000_000)
        || descriptor.utf8Bytes < descriptor.characters
        || descriptor.utf8Bytes > descriptor.characters * 4
      ) return false;
      assertDigest(descriptor.digest, "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
    }
    const expectationKeys = [
      "authority",
      "ordinal",
      "originalDigest",
      "sourceArtifactDigest",
      "sourceIdDigest",
      "sourceKind",
      "sourceMetadataDigest",
      "sourceRevisionDigest",
    ];
    const bindingKeys = [
      ...expectationKeys,
      "coverage",
      "endUtf8Byte",
      "messageIndex",
      "segmentIndex",
      "startUtf8Byte",
      "survivingFragmentCharacters",
      "survivingFragmentDigest",
      "survivingFragmentUtf8Bytes",
    ].sort().join(",");
    const expectations: BrowserFinalContextExpectation[] = [];
    const userDescriptor = value.messageDescriptors[1];
    for (const [index, binding] of value.contextBindings.entries()) {
      if (
        Object.keys(binding).sort().join(",") !== bindingKeys
        || binding.messageIndex !== 1
        || binding.segmentIndex !== index
        || binding.coverage !== "fragment"
        || !isSafeInteger(binding.startUtf8Byte, 0, 100_000_000)
        || !isSafeInteger(binding.endUtf8Byte, 1, 100_000_000)
        || binding.endUtf8Byte <= binding.startUtf8Byte
        || binding.startUtf8Byte < (value.contextBindings[index - 1]?.endUtf8Byte ?? 0)
        || !isSafeInteger(binding.survivingFragmentUtf8Bytes, 1, 100_000_000)
        || !isSafeInteger(binding.survivingFragmentCharacters, 1, 100_000_000)
        || binding.endUtf8Byte - binding.startUtf8Byte
          !== binding.survivingFragmentUtf8Bytes
        || binding.endUtf8Byte > userDescriptor.utf8Bytes
        || binding.survivingFragmentCharacters > userDescriptor.characters
        || binding.survivingFragmentUtf8Bytes
          < binding.survivingFragmentCharacters
        || binding.survivingFragmentUtf8Bytes
          > binding.survivingFragmentCharacters * 4
      ) return false;
      assertDigest(
        binding.survivingFragmentDigest,
        "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
      );
      const expectation = Object.fromEntries(expectationKeys.map((key) => [
        key,
        binding[key as keyof BrowserFinalModelContextBinding],
      ])) as BrowserFinalContextExpectation;
      assertBrowserFinalContextExpectation(expectation);
      if (expectation.sourceMetadataDigest !== await sha256Hex(stableStringify({
        domain: "browser-final-context-source-metadata-v3",
        sourceKind: expectation.sourceKind,
        authority: expectation.authority,
        sourceArtifactDigest: expectation.sourceArtifactDigest,
        sourceRevisionDigest: expectation.sourceRevisionDigest,
      }))) return false;
      expectations.push(expectation);
    }
    assertExpectationSequence(expectations);
    if (await browserFinalContextManifestDigest({
      outerRequestIdDigest: value.outerRequestIdDigest,
      outerTaskType: value.outerTaskType,
      outerQualityPhase: value.outerQualityPhase,
      expectations,
    })
      !== value.requiredManifestDigest) return false;
    const { bindingDigest, ...body } = value;
    return bindingDigest === await sha256Hex(stableStringify({
      domain: "browser-final-model-context-invocation-proof-v4",
      body,
    }));
  } catch {
    return false;
  }
}

/**
 * Fail-closed assertion for a caller that already knows the exact composer or
 * legacy invocation position. Unlike the legacy orchestrator-local assertion,
 * this contract accepts the complete attested index range and requires an
 * explicit pipeline kind, so a proof cannot be accepted through a defaulted
 * pipeline or a stage-only comparison.
 */
export async function assertBrowserFinalModelContextInvocationProof(input: {
  proof: BrowserFinalModelContextInvocationProof | null | undefined;
  pipelineKind: BrowserFinalModelContextPipelineKind;
  innerStage: BrowserFinalModelContextInnerStage;
  innerIndex: BrowserFinalModelContextInnerIndex;
}) {
  if (
    !input.proof
    || !PIPELINE_KINDS.has(input.pipelineKind)
    || !INNER_STAGES.has(input.innerStage)
    || !isSafeInteger(input.innerIndex, 0, 5)
    || !invocationStageMatchesPipeline({
      pipelineKind: input.pipelineKind,
      innerStage: input.innerStage,
      innerIndex: input.innerIndex,
    })
    || input.proof.pipelineKind !== input.pipelineKind
    || input.proof.innerStage !== input.innerStage
    || input.proof.innerIndex !== input.innerIndex
    || !await verifyBrowserFinalModelContextInvocationProof(input.proof)
  ) throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  return input.proof;
}

function validExecutedStages(
  pipelineKind: BrowserFinalModelContextPipelineKind,
  stages: BrowserFinalModelContextInnerStage[],
) {
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 6) {
    return false;
  }
  if (pipelineKind === "legacy-bounded-quality-v1") {
    return stages.length <= 3
      && stages[0] === "initial"
      && (stages[1] === undefined || stages[1] === "repair")
      && (stages[2] === undefined
        || stages[2] === "extension"
        || stages[2] === "recovery")
      && new Set(stages).size === stages.length;
  }
  if (stages[0] !== "initial") return false;
  const segmentStages = stages.slice(1);
  if (segmentStages.some((stage) => (
    stage !== "segment-1"
    && stage !== "segment-2"
    && stage !== "segment-3"
  ))) return false;
  const ranks = segmentStages.map((stage) => (
    stage === "segment-1" ? 1 : stage === "segment-2" ? 2 : 3
  ));
  if (ranks.some((rank, index) => index > 0 && rank < ranks[index - 1])) {
    return false;
  }
  const count = (stage: BrowserFinalModelContextInnerStage) => (
    segmentStages.filter((candidate) => candidate === stage).length
  );
  return count("segment-1") <= 2
    && count("segment-2") <= 2
    && count("segment-3") <= 1;
}

export async function createBrowserFinalModelContextAttestation(input: {
  pipelineKind?: BrowserFinalModelContextPipelineKind;
  acceptedDisposition: BrowserFinalModelContextAttestation["acceptedDisposition"];
  acceptedStage: BrowserFinalModelContextInnerStage;
  extensionBaseStage?: "initial" | "repair" | null;
  executedStages: BrowserFinalModelContextInnerStage[];
  contributingCalls: BrowserFinalModelContextInvocationProof[];
}): Promise<BrowserFinalModelContextAttestation> {
  const pipelineKind = input.pipelineKind
    ?? input.contributingCalls[0]?.pipelineKind
    ?? "legacy-bounded-quality-v1";
  if (
    !PIPELINE_KINDS.has(pipelineKind)
    || !ACCEPTED_DISPOSITIONS.has(input.acceptedDisposition)
    || !INNER_STAGES.has(input.acceptedStage)
    || !validExecutedStages(pipelineKind, input.executedStages)
  ) {
    throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  }
  const callsValid = await Promise.all(
    input.contributingCalls.map(verifyBrowserFinalModelContextInvocationProof),
  );
  if (callsValid.some((valid) => !valid) || !input.contributingCalls.length) {
    throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  }
  const first = input.contributingCalls[0];
  const sameBoundary = input.contributingCalls.every((call) => (
    call.outerQualityPhase === first.outerQualityPhase
    && call.outerRequestIdDigest === first.outerRequestIdDigest
    && call.outerTaskType === first.outerTaskType
    && call.modelId === first.modelId
    && call.modelDigest === first.modelDigest
    && call.requiredManifestDigest === first.requiredManifestDigest
    && call.pipelineKind === pipelineKind
  ));
  const uniqueCalls = new Set(
    input.contributingCalls.map((call) => call.invocationRequestIdDigest),
  ).size === input.contributingCalls.length;
  const contributingStagesMatchExecution = input.contributingCalls.every(
    (call) => (
      invocationStageMatchesPipeline(call)
      && input.executedStages[call.innerIndex] === call.innerStage
    ),
  );
  const contributingIndexesStrictlyIncrease = input.contributingCalls.every(
    (call, index) => index === 0
      || call.innerIndex > input.contributingCalls[index - 1].innerIndex,
  );
  const extensionBaseStage = input.extensionBaseStage ?? null;
  const legacyStandalone = pipelineKind === "legacy-bounded-quality-v1"
    && input.acceptedDisposition === "standalone"
    ? input.contributingCalls.length === 1
      && input.contributingCalls[0].innerStage === input.acceptedStage
      && input.contributingCalls[0].innerIndex
        === expectedLegacyInnerIndex(input.acceptedStage)
      && input.executedStages[expectedLegacyInnerIndex(input.acceptedStage)]
        === input.acceptedStage
      && input.acceptedStage !== "extension"
      && extensionBaseStage === null
    : false;
  const legacyExtension = pipelineKind === "legacy-bounded-quality-v1"
    && input.acceptedDisposition === "composed-extension"
    ? input.acceptedStage === "extension"
      && (extensionBaseStage === "initial" || extensionBaseStage === "repair")
      && input.contributingCalls.length === 2
      && input.contributingCalls[0].innerStage === extensionBaseStage
      && input.contributingCalls[0].innerIndex
        === expectedLegacyInnerIndex(extensionBaseStage)
      && input.contributingCalls[1].innerStage === "extension"
      && input.contributingCalls[1].innerIndex
        === expectedLegacyInnerIndex("extension")
      && input.executedStages[expectedLegacyInnerIndex(extensionBaseStage)]
        === extensionBaseStage
      && input.executedStages[expectedLegacyInnerIndex("extension")]
        === "extension"
    : false;
  const composerStandalone = pipelineKind === "browser-prose-composer-v1"
    && input.acceptedDisposition === "standalone"
    ? input.acceptedStage === "initial"
      && input.executedStages.length === 1
      && input.contributingCalls.length === 1
      && input.contributingCalls[0].innerStage === "initial"
      && input.contributingCalls[0].innerIndex === 0
      && extensionBaseStage === null
    : false;
  const expectedComposedStages = input.acceptedStage === "segment-3"
    ? ["segment-1", "segment-2", "segment-3"] as const
    : ["segment-1", "segment-2"] as const;
  const composerSegments = pipelineKind === "browser-prose-composer-v1"
    && input.acceptedDisposition === "composed-segments"
    && (input.acceptedStage === "segment-2" || input.acceptedStage === "segment-3")
    ? extensionBaseStage === null
      && input.contributingCalls.length === expectedComposedStages.length
      && input.contributingCalls.every((call, index) => (
        call.innerStage === expectedComposedStages[index]
      ))
      && input.contributingCalls.at(-1)?.innerStage === input.acceptedStage
    : false;
  const lineageValid = legacyStandalone
    || legacyExtension
    || composerStandalone
    || composerSegments;
  if (
    !sameBoundary
    || !uniqueCalls
    || !contributingStagesMatchExecution
    || !contributingIndexesStrictlyIncrease
    || !lineageValid
  ) {
    throw proofError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH");
  }
  const body = {
    schemaVersion: BROWSER_FINAL_MODEL_CONTEXT_ATTESTATION_VERSION,
    pipelineKind,
    acceptedDisposition: input.acceptedDisposition,
    acceptedStage: input.acceptedStage,
    extensionBaseStage,
    executedStages: [...input.executedStages],
    outerQualityPhase: first.outerQualityPhase,
    outerRequestIdDigest: first.outerRequestIdDigest,
    outerTaskType: first.outerTaskType,
    requiredManifestDigest: first.requiredManifestDigest,
    contributingCalls: structuredClone(input.contributingCalls),
    rawTextStored: false as const,
  };
  return {
    ...body,
    bindingDigest: await sha256Hex(stableStringify({
      domain: "browser-final-model-context-attestation-v4",
      body,
    })),
  };
}

export async function verifyBrowserFinalModelContextAttestation(
  value: BrowserFinalModelContextAttestation,
) {
  try {
    if (
      !value
      || typeof value !== "object"
      || Object.keys(value).sort().join(",") !== [
        "acceptedDisposition",
        "acceptedStage",
        "bindingDigest",
        "contributingCalls",
        "executedStages",
        "extensionBaseStage",
        "outerQualityPhase",
        "outerRequestIdDigest",
        "outerTaskType",
        "pipelineKind",
        "rawTextStored",
        "requiredManifestDigest",
        "schemaVersion",
      ].sort().join(",")
      || value.schemaVersion !== BROWSER_FINAL_MODEL_CONTEXT_ATTESTATION_VERSION
      || !PIPELINE_KINDS.has(value.pipelineKind)
      || !ACCEPTED_DISPOSITIONS.has(value.acceptedDisposition)
      || !INNER_STAGES.has(value.acceptedStage)
      || value.rawTextStored !== false
      || !DIGEST.test(value.bindingDigest)
      || !DIGEST.test(value.requiredManifestDigest)
      || !Array.isArray(value.contributingCalls)
      || !Array.isArray(value.executedStages)
      || !validExecutedStages(value.pipelineKind, value.executedStages)
    ) return false;
    const rebuilt = await createBrowserFinalModelContextAttestation({
      pipelineKind: value.pipelineKind,
      acceptedDisposition: value.acceptedDisposition,
      acceptedStage: value.acceptedStage,
      extensionBaseStage: value.extensionBaseStage,
      executedStages: value.executedStages,
      contributingCalls: value.contributingCalls,
    });
    return stableStringify(rebuilt) === stableStringify(value);
  } catch {
    return false;
  }
}

export function browserFinalContextMarkerPrefix() {
  return RESERVED_MARKER;
}
