import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY,
  BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
  BROWSER_PROSE_CANDIDATE_V2_MATERIAL_DIFFERENCE,
  BROWSER_PROSE_CANDIDATE_V2_SAFE_METRIC_SCHEMA,
  BROWSER_PROSE_RC65_CANDIDATE_REGISTRY,
  RC6_4_BLOCKED_CANDIDATE_SAFE_DIGESTS,
  assertBrowserProseCandidateV2SafeOutput,
  assertBrowserProseCandidateV2FixtureIsolation,
  assertBrowserProseCandidateV2Identity,
  assertBrowserProseCandidateV2Qualification,
  assertBrowserProseCandidateV2CompositionMetric,
  assertBrowserProseCandidateV2SafeMetric,
  assertBrowserProseRc65CandidateLimit,
  browserProseCandidateV2IdentityDigest,
  browserProseCandidateV2Sha256,
  buildBrowserProseCandidateV2SegmentRequests,
  composeBrowserProseCandidateV2,
  createBrowserProseCandidateV2SafeFixtures,
} from "../lib/novel-ai/providers/browser-ai/browser-prose-candidate-v2.ts";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function safeMetric(fixture, executionMode) {
  const cancelSegment = executionMode === "cancel-retry"
    ? ["action", "reaction", "consequence"][Number(fixture.fixtureId.slice(-2)) - 1]
    : null;
  return {
    schemaVersion: BROWSER_PROSE_CANDIDATE_V2_SAFE_METRIC_SCHEMA,
    candidateIdentityDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
    modelId: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId,
    modelDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest,
    composerMode: BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.composerMode,
    fixtureId: fixture.fixtureId,
    partition: fixture.partition,
    executionMode,
    actualExecutor: "browser-ai",
    underlyingExecutor: "webllm-worker",
    candidateOnly: true,
    modelResponseCount: 3,
    finishReasons: ["stop", "stop", "stop"],
    observedHanCharacters: 278,
    selectedHanCharacters: 264,
    sentenceBoundaryCount: 6,
    selectedBoundaryIndex: 5,
    selectedPrefixDigest: await browserProseCandidateV2Sha256(
      `rc65-safe-selected-prefix\n${fixture.fixtureId}\n${executionMode}`,
    ),
    runtimeReceiptDigest: await browserProseCandidateV2Sha256(
      `rc65-synthetic-runtime-receipt\n${fixture.fixtureId}\n${executionMode}`,
    ),
    finalAttestationDigest: await browserProseCandidateV2Sha256(
      `rc65-synthetic-attestation\n${fixture.fixtureId}\n${executionMode}`,
    ),
    qualityScore: 1,
    qualityReasonCodes: [],
    contextAnchorVerified: true,
    characterAnchorVerified: true,
    narrativeProgressVerified: true,
    repetitionDisposition: "acceptable",
    externalRequest: false,
    dataLeftDevice: false,
    externalNetworkRequestCount: 0,
    dataEgressEventCount: 0,
    networkObservationComplete: true,
    canonicalMutationCount: 0,
    formalApprovalMutationCount: 0,
    modelResponseBudgetExceeded: false,
    profileDisposed: true,
    edgeResidueCount: 0,
    workerResidueCount: 0,
    rawOutputStored: false,
    rawPromptStored: false,
    rawStoryBibleStored: false,
    rawChapterStored: false,
    chainOfThoughtStored: false,
    cancelledSegment: cancelSegment,
    cancelledPartialPersisted: false,
    retryReusedCancelledOutput: false,
    syntheticObservedReceipt: true,
    productionPassClaimed: false,
    pass: true,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectRejected(fn, pattern) {
  assert.throws(fn, pattern);
}

test("candidate identity has all eleven required fields and verifies both digests", async () => {
  assert.deepEqual(Object.keys(BROWSER_PROSE_CANDIDATE_V2_IDENTITY).sort(), [
    "candidateIdentityDigest",
    "composerVersion",
    "contextPackVersion",
    "generationPolicyDigest",
    "modelDigest",
    "modelId",
    "modelLibDigest",
    "modelRevision",
    "promptProfileVersion",
    "qualityGateVersion",
    "schemaVersion",
  ]);
  await assertBrowserProseCandidateV2Identity();
  assert.match(BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest, /^[a-f0-9]{64}$/u);
  assert.ok(!RC6_4_BLOCKED_CANDIDATE_SAFE_DIGESTS.includes(
    BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
  ));
});

test("every identity field mutation changes candidateIdentityDigest", async () => {
  const { candidateIdentityDigest: ignored, ...body } = BROWSER_PROSE_CANDIDATE_V2_IDENTITY;
  assert.equal(await browserProseCandidateV2IdentityDigest(body), ignored);
  for (const field of Object.keys(body)) {
    const mutated = { ...body, [field]: `${body[field]}-mutation` };
    assert.notEqual(
      await browserProseCandidateV2IdentityDigest(mutated),
      ignored,
      `${field} must bind candidate identity`,
    );
  }
});

test("V2 is a material architecture change rather than a sampling-only change", () => {
  assert.equal(BROWSER_PROSE_CANDIDATE_V2_MATERIAL_DIFFERENCE.parameterOnlyChange, false);
  assert.equal(
    BROWSER_PROSE_CANDIDATE_V2_MATERIAL_DIFFERENCE.architectureBefore,
    "monolithic-full-prose-generation",
  );
  assert.equal(
    BROWSER_PROSE_CANDIDATE_V2_MATERIAL_DIFFERENCE.architectureAfter,
    "deterministic-three-segment-complete-sentence-compose",
  );
  assert.ok(BROWSER_PROSE_CANDIDATE_V2_MATERIAL_DIFFERENCE.materialDimensions.length >= 3);
  assert.ok(!Object.keys(BROWSER_PROSE_CANDIDATE_V2_IDENTITY).some((key) => (
    ["seed", "temperature", "topP", "retryCount"].includes(key)
  )));
});

test("V2 source cannot import or invoke the blocked RC6.4 candidate pipeline", async () => {
  const source = await readFile(fileURLToPath(new URL(
    "../lib/novel-ai/providers/browser-ai/browser-prose-candidate-v2.ts",
    import.meta.url,
  )), "utf8");
  for (const forbidden of [
    /from\s+["'][^"']*browser-prose-composer["']/u,
    /from\s+["'][^"']*browser-prose-product-pipeline["']/u,
    /from\s+["'][^"']*browser-prose-runtime-authority["']/u,
    /from\s+["'][^"']*rc6-4-large-edge["']/u,
    /runBrowserProseProductPipeline\s*\(/u,
    /composeBrowserProse(?!CandidateV2)\s*\(/u,
    /BROWSER_PROSE_COMPOSER_VERSION/u,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /modelResponseBudget:\s*3/u);
  assert.match(source, /modelRetryBudget:\s*0/u);
  assert.match(source, /requestFullProse:\s*false/u);
});

test("RC6.5 registry contains one candidate and can never exceed two", () => {
  assert.equal(BROWSER_PROSE_RC65_CANDIDATE_REGISTRY.length, 1);
  assertBrowserProseRc65CandidateLimit();
});

test("development and holdout fixture descriptors are isolated 5 by 5", async () => {
  const fixtures = await createBrowserProseCandidateV2SafeFixtures();
  assertBrowserProseCandidateV2FixtureIsolation(fixtures);
  assert.deepEqual(fixtures.development.map((row) => row.genre), [
    "modern", "xianxia", "mystery", "emotion", "adventure",
  ]);
  assert.deepEqual(fixtures.holdout.map((row) => row.genre), [
    "modern", "xianxia", "mystery", "emotion", "adventure",
  ]);
  assert.ok(fixtures.development.every((row) => row.tuningAllowed));
  assert.ok(fixtures.holdout.every((row) => !row.tuningAllowed));
  assert.ok([...fixtures.development, ...fixtures.holdout].every((row) => (
    row.rawContextStored === false
    && !Object.keys(row).some((key) => /(?:storyBible|chapter|anchor|rules|goal)$/u.test(key))
  )));
});

test("holdout fixture overlap and tuning mutations fail closed", async () => {
  const fixtures = await createBrowserProseCandidateV2SafeFixtures();
  const overlap = clone(fixtures);
  overlap.holdout[0].storyBibleDigest = overlap.development[0].storyBibleDigest;
  expectRejected(
    () => assertBrowserProseCandidateV2FixtureIsolation(overlap),
    /PARTITION_DIGEST_OVERLAP/u,
  );
  const tuning = clone(fixtures);
  tuning.holdout[0].tuningAllowed = true;
  expectRejected(
    () => assertBrowserProseCandidateV2FixtureIsolation(tuning),
    /HOLDOUT_TUNING_BOUNDARY_BROKEN/u,
  );
});

test("segment requests are three bounded role-specific calls, never full-prose retries", () => {
  const requests = buildBrowserProseCandidateV2SegmentRequests({
    storyBible: "合成測試聖經",
    currentChapter: "合成測試章節",
    characterAnchors: ["林岑", "周芷"],
    contextAnchors: ["銅鑰", "舊港倉庫"],
    worldRules: ["鐘聲停止前不可開門"],
    nextActionGoal: "找出地窖內的證人",
    genre: "mystery",
  });
  assert.deepEqual(requests.map((row) => row.segmentId), ["action", "reaction", "consequence"]);
  assert.ok(requests.every((row) => (
    row.requestFullProse === false
    && row.temperature === 0
    && row.topP === 1
    && row.maxOutputTokens <= 208
  )));
  assert.equal(BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.modelResponseBudget, 3);
  assert.equal(BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.modelRetryBudget, 0);
});

test("deterministic composer emits composition metrics without observed runtime truth", async () => {
  const context = {
    storyBible: "林岑追查母親失蹤真相；周芷是她唯一信任的同伴。",
    currentChapter: "舊港的鐘聲停了。她們躲過巡兵，抵達封鎖多年的倉庫外。",
    characterAnchors: ["林岑", "周芷"],
    contextAnchors: ["銅鑰", "舊港倉庫"],
    worldRules: ["鐘聲停止後，封印只維持一刻鐘"],
    nextActionGoal: "進入地窖並找到證人",
    genre: "mystery",
  };
  const result = await composeBrowserProseCandidateV2({
    fixtureId: "rc65-development-03",
    partition: "development",
    executionMode: "cold",
    context,
    responses: [
      {
        segmentId: "action",
        finishReason: "stop",
        content: "雨夜裡，林岑握緊銅鑰，沿著舊港倉庫的裂牆向前走，趁巡燈轉開時推門進入暗室。她記得母親只在鐘聲停歇後行動的告誡，便抬手示意同行的周芷保持安靜，自己先踏過積水。",
      },
      {
        segmentId: "reaction",
        finishReason: "stop",
        content: "門後的鐵鏈忽然震響，周芷立刻擋在林岑側後，低聲指出貨架底下新鮮的泥痕正通往封死的地窖。遠處巡燈提早折返，窗縫的白光掃過暗室，迫使兩人伏低身子，連呼吸也壓進潮濕木板的氣味裡。",
      },
      {
        segmentId: "consequence",
        finishReason: "stop",
        content: "林岑掀開地窖蓋時，銅鑰竟與鎖孔一同發熱，因此牆內傳來三聲敲擊，原先沉寂的鐘樓隨即亮起紅燈。她終於明白母親留下的不是逃亡路線，而是喚醒證人的信號；巡兵也當場改變方向，朝倉庫包圍而來。",
      },
    ],
  });
  assert.ok(result.compositionMetric.selectedHanCharacters >= 220);
  assert.ok(result.compositionMetric.selectedHanCharacters <= 320);
  assert.equal(result.compositionMetric.pass, true);
  assertBrowserProseCandidateV2CompositionMetric(result.compositionMetric);
  for (const forbidden of [
    "actualExecutor", "underlyingExecutor", "externalRequest", "dataLeftDevice",
    "canonicalMutationCount", "profileDisposed", "edgeResidueCount", "workerResidueCount",
  ]) assert.equal(Object.hasOwn(result.compositionMetric, forbidden), false);
  assert.ok(/[。！？…」』）】]$/u.test(result.content));
});

test("composer enforces every segment Han window and role before final composition", async () => {
  const context = {
    storyBible: "林岑追查母親失蹤真相；周芷是她唯一信任的同伴。",
    currentChapter: "舊港的鐘聲停了。她們躲過巡兵，抵達封鎖多年的倉庫外。",
    characterAnchors: ["林岑", "周芷"],
    contextAnchors: ["銅鑰", "舊港倉庫"],
    worldRules: ["鐘聲停止後，封印只維持一刻鐘"],
    nextActionGoal: "進入地窖並找到證人",
    genre: "mystery",
  };
  const validResponses = [
    {
      segmentId: "action",
      finishReason: "stop",
      content: "雨夜裡，林岑握緊銅鑰，沿著舊港倉庫的裂牆向前走，趁巡燈轉開時推門進入暗室。她記得母親只在鐘聲停歇後行動的告誡，便抬手示意同行的周芷保持安靜，自己先踏過積水。",
    },
    {
      segmentId: "reaction",
      finishReason: "stop",
      content: "門後的鐵鏈忽然震響，周芷立刻擋在林岑側後，低聲指出貨架底下新鮮的泥痕正通往封死的地窖。遠處巡燈提早折返，窗縫的白光掃過暗室，迫使兩人伏低身子，連呼吸也壓進潮濕木板的氣味裡。",
    },
    {
      segmentId: "consequence",
      finishReason: "stop",
      content: "林岑掀開地窖蓋時，銅鑰竟與鎖孔一同發熱，因此牆內傳來三聲敲擊，原先沉寂的鐘樓隨即亮起紅燈。她終於明白母親留下的不是逃亡路線，而是喚醒證人的信號；巡兵也當場改變方向，朝倉庫包圍而來。",
    },
  ];
  const shortAction = structuredClone(validResponses);
  shortAction[0].content = "林岑推門進去。";
  shortAction[1].content += "周芷察覺屋樑落下灰屑，指出樓上另有腳步，眾人只得貼牆屏息。她又發現門縫外的影子停住，低聲提醒林岑不要回頭。";
  shortAction[2].content += "因此暗門另一側傳出急促喘息，整座倉庫的退路同時被鐵柵截斷。於是兩人只能帶著線索深入地底，身後的火光逐層逼近。";
  await assert.rejects(
    () => composeBrowserProseCandidateV2({
      fixtureId: "rc65-development-03-short-action",
      partition: "development",
      executionMode: "cold",
      context,
      responses: shortAction,
    }),
    /LENGTH_WINDOW_UNSATISFIED/u,
  );

  const wrongConsequenceRole = structuredClone(validResponses);
  wrongConsequenceRole[2].content = wrongConsequenceRole[2].content
    .replaceAll("因此", "接著")
    .replaceAll("隨即", "接著")
    .replaceAll("終於", "此刻")
    .replaceAll("當場", "同時");
  await assert.rejects(
    () => composeBrowserProseCandidateV2({
      fixtureId: "rc65-development-03-wrong-role",
      partition: "development",
      executionMode: "cold",
      context,
      responses: wrongConsequenceRole,
    }),
    /LENGTH_WINDOW_UNSATISFIED/u,
  );
});

test("segment and final safety reject Unicode paragraph separators", () => {
  for (const separator of ["\u2028", "\u2029"]) {
    for (const boundary of ["segment-action", "final-composition"]) {
      assert.throws(
        () => assertBrowserProseCandidateV2SafeOutput(
          `林岑握住銅鑰${separator}繼續前進。`,
          boundary,
        ),
        (error) => (
          error?.code === "BROWSER_PROSE_CANDIDATE_V2_OUTPUT_SAFETY_REJECTED"
          && error?.safetyCode === "control-token"
          && error?.boundary === boundary
        ),
      );
    }
  }
});

test("safe metric rejects every release-critical mutation", async () => {
  const fixtures = await createBrowserProseCandidateV2SafeFixtures();
  const base = await safeMetric(fixtures.development[0], "cold");
  assert.equal(base.syntheticObservedReceipt, true);
  assert.equal(base.productionPassClaimed, false);
  assertBrowserProseCandidateV2SafeMetric(base, { allowSyntheticObservedReceipt: true });
  expectRejected(
    () => assertBrowserProseCandidateV2SafeMetric(base),
    /SAFE_METRIC_REJECTED/u,
  );
  const mutations = [
    ["actualExecutor", "local-ollama"],
    ["modelResponseCount", 4],
    ["selectedHanCharacters", 219],
    ["selectedHanCharacters", 321],
    ["contextAnchorVerified", false],
    ["characterAnchorVerified", false],
    ["narrativeProgressVerified", false],
    ["repetitionDisposition", "excessive"],
    ["externalRequest", true],
    ["dataLeftDevice", true],
    ["externalNetworkRequestCount", 1],
    ["dataEgressEventCount", 1],
    ["networkObservationComplete", false],
    ["canonicalMutationCount", 1],
    ["formalApprovalMutationCount", 1],
    ["modelResponseBudgetExceeded", true],
    ["profileDisposed", false],
    ["edgeResidueCount", 1],
    ["workerResidueCount", 1],
    ["rawOutputStored", true],
    ["rawPromptStored", true],
    ["rawStoryBibleStored", true],
    ["rawChapterStored", true],
    ["chainOfThoughtStored", true],
    ["pass", false],
  ];
  for (const [field, value] of mutations) {
    expectRejected(
      () => assertBrowserProseCandidateV2SafeMetric(
        { ...base, [field]: value },
        { allowSyntheticObservedReceipt: true },
      ),
      /SAFE_METRIC_REJECTED/u,
    );
  }
  expectRejected(
    () => assertBrowserProseCandidateV2SafeMetric(
      { ...base, rawOutput: "forbidden" },
      { allowSyntheticObservedReceipt: true },
    ),
    /RAW_EVIDENCE_KEY_FORBIDDEN/u,
  );
});

test("synthetic contract mode validates only development 5, holdout 5, warm 5 and cancel-retry 3", async () => {
  const fixtures = await createBrowserProseCandidateV2SafeFixtures();
  const qualification = {
    development: await Promise.all(fixtures.development.map((row) => safeMetric(row, "cold"))),
    holdout: await Promise.all(fixtures.holdout.map((row) => safeMetric(row, "cold"))),
    warm: await Promise.all(fixtures.holdout.map((row) => safeMetric(row, "warm"))),
    cancelRetry: await Promise.all(fixtures.holdout.slice(0, 3).map((row) => (
      safeMetric(row, "cancel-retry")
    ))),
  };
  assertBrowserProseCandidateV2Qualification(qualification, {
    allowSyntheticObservedReceipt: true,
  });
  expectRejected(
    () => assertBrowserProseCandidateV2Qualification(qualification),
    /SAFE_METRIC_REJECTED/u,
  );
  expectRejected(
    () => assertBrowserProseCandidateV2Qualification({
      ...qualification,
      development: qualification.development.slice(0, 4),
    }, { allowSyntheticObservedReceipt: true }),
    /DEVELOPMENT_COUNT_INVALID/u,
  );
  expectRejected(
    () => assertBrowserProseCandidateV2Qualification({
      ...qualification,
      holdout: qualification.holdout.slice(0, 4),
    }, { allowSyntheticObservedReceipt: true }),
    /HOLDOUT_COUNT_INVALID/u,
  );
  expectRejected(
    () => assertBrowserProseCandidateV2Qualification({
      ...qualification,
      warm: qualification.warm.slice(0, 4),
    }, { allowSyntheticObservedReceipt: true }),
    /WARM_COUNT_INVALID/u,
  );
  expectRejected(
    () => assertBrowserProseCandidateV2Qualification({
      ...qualification,
      cancelRetry: qualification.cancelRetry.slice(0, 2),
    }, { allowSyntheticObservedReceipt: true }),
    /CANCELRETRY_COUNT_INVALID/u,
  );
});

let passed = 0;
for (const row of tests) {
  await row.fn();
  passed += 1;
  console.log(`PASS ${row.name}`);
}

console.log(JSON.stringify({
  schemaVersion: "p2.4b-rc6.5-browser-prose-candidate-v2-contract-result-v1",
  candidateIdentityDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
  composerMode: BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.composerMode,
  candidateCount: BROWSER_PROSE_RC65_CANDIDATE_REGISTRY.length,
  passed,
  failed: 0,
  syntheticObservedReceipt: true,
  productionPassClaimed: false,
  rawOutputStored: false,
  rawPromptStored: false,
  rawStoryBibleStored: false,
  rawChapterStored: false,
  chainOfThoughtStored: false,
}, null, 2));
