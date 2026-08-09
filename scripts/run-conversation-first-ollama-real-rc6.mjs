import crypto from "node:crypto";
import { OllamaClient } from "../lib/novel-ai/providers/ollama/ollama-client.ts";

const MODEL = "qwen2.5:3b";
const PROMPT_PROFILE_VERSION = "conversation-first-ollama-real-rc6-v1";
const ACTUAL_EXECUTOR = "local-ollama";
const EMPTY_OUTPUT_DIGEST = sha256("");
const requestedCases = readRequestedCases(process.argv.slice(2));
const startedAt = performance.now();
const results = [];
const completedRuns = new Map();

class GateError extends Error {
  constructor(code) {
    super(code);
    this.name = "GateError";
    this.code = code;
  }
}

// This is deliberately a read-only sentinel. Model responses only become ephemeral
// candidates in this process; the gate never opens or writes a repository.
const canonicalState = deepFreeze({
  projectId: "project-rc6-real-gate",
  chapterRevision: 17,
  storyBibleRevision: 9,
  storyStateRevision: 7,
});
const initialCanonicalDigest = digestJson(canonicalState);
let canonicalMutationCount = 0;

const client = new OllamaClient({
  endpoint: "http://127.0.0.1:11434",
  timeoutMs: 600_000,
});

let modelDigest;
try {
  const tags = await client.tags();
  const installed = tags.models?.find((entry) =>
    [entry.model, entry.name].some((name) => name === MODEL));
  if (!installed || !isSha256(installed.digest)) {
    print({
      type: "gate-summary",
      suite: "P2.4B RC6 conversation-first real Ollama gate",
      status: "BLOCKED",
      reasonCode: installed ? "LOCAL_MODEL_DIGEST_UNAVAILABLE" : "LOCAL_MODEL_UNAVAILABLE",
      model: MODEL,
      actualExecutor: ACTUAL_EXECUTOR,
      externalRequest: false,
      dataLeftDevice: false,
      rawPromptStored: false,
      rawOutputStored: false,
      chainOfThoughtStored: false,
    });
    process.exit(2);
  }
  modelDigest = installed.digest;
} catch {
  print({
    type: "gate-summary",
    suite: "P2.4B RC6 conversation-first real Ollama gate",
    status: "BLOCKED",
    reasonCode: "LOCAL_OLLAMA_UNAVAILABLE",
    model: MODEL,
    actualExecutor: ACTUAL_EXECUTOR,
    externalRequest: false,
    dataLeftDevice: false,
    rawPromptStored: false,
    rawOutputStored: false,
    chainOfThoughtStored: false,
  });
  process.exit(2);
}

const chapterContinueContext = [
  "Current chapter: Mara reached the North Gate carrying the amber compass.",
  "The gate bell rang twice. No other character is present.",
  "Last line: The compass needle turned beneath her palm.",
].join("\n");

await runCase({
  caseId: "natural-language-continue",
  prompt: promptFor(`
The author says naturally: "Continue this scene. Reveal a sound behind the gate, keep Mara, the North Gate, and the amber compass consistent, and introduce no named character."

CONTEXT
${chapterContinueContext}

Return this schema:
{
  "caseId": "natural-language-continue",
  "operation": "continue",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "candidateParagraphs": [
    "35-55 words of story prose",
    "35-55 words of story prose",
    "35-55 words of story prose"
  ],
  "continuity": {"actor": "Mara", "object": "amber compass", "location": "North Gate"}
}
Write all three prose paragraphs; do not copy the placeholder wording.`),
  options: { num_predict: 420 },
  validate(value) {
    validateCandidateEnvelope(value, "natural-language-continue", "continue");
    expect(Array.isArray(value.candidateParagraphs) && value.candidateParagraphs.length === 3, "CONTINUE_PARAGRAPH_COUNT_INVALID");
    const continuation = value.candidateParagraphs.join("\n");
    expectText(continuation, 280);
    expect(value.candidateParagraphs.every((paragraph) => typeof paragraph === "string" && paragraph.length >= 70), "CONTINUE_PARAGRAPH_TOO_SHORT");
    expectEqual(value.continuity?.actor, "Mara", "CONTINUE_ACTOR_INVALID");
    expectEqual(value.continuity?.object, "amber compass", "CONTINUE_OBJECT_INVALID");
    expectEqual(value.continuity?.location, "North Gate", "CONTINUE_LOCATION_INVALID");
    expectIncludesAll(continuation, ["mara", "gate", "compass"], "CONTINUE_CONTENT_INVALID");
  },
});

const rewriteSource = "Ivo ran quickly across the glass bridge because he was afraid that the guards would see him.";
await runCase({
  caseId: "natural-language-rewrite",
  prompt: promptFor(`
The author says naturally: "Rewrite this in a restrained thriller voice. Keep Ivo and the glass bridge, preserve the reason for running, and use one or two sentences."

SOURCE
${rewriteSource}

Return this schema:
{
  "caseId": "natural-language-rewrite",
  "operation": "rewrite",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "candidateText": "rewritten prose",
  "style": "restrained-thriller",
  "retained": ["Ivo", "glass bridge", "guards"]
}`),
  options: { num_predict: 150 },
  validate(value) {
    validateCandidateEnvelope(value, "natural-language-rewrite", "rewrite");
    expectText(value.candidateText, 45);
    expect(value.candidateText !== rewriteSource, "REWRITE_UNCHANGED");
    expectEqual(value.style, "restrained-thriller", "REWRITE_STYLE_INVALID");
    expectIncludesAll(value.candidateText, ["ivo", "glass bridge", "guard"], "REWRITE_FACTS_INVALID");
  },
});

await runCase({
  caseId: "character-modify",
  prompt: promptFor(`
The author says: "Modify Selene so she distrusts institutions after the East Vault betrayal. Keep her role and goal unchanged."

CURRENT CHARACTER
{"characterId":"char-selene","name":"Selene","role":"archivist","goal":"protect the map","flaw":"trusts institutions too readily"}

Return this schema with the exact requested facts:
{
  "caseId": "character-modify",
  "operation": "modify-character",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "characterId": "char-selene",
  "patch": {"flaw": "distrusts institutions", "backstoryEvent": "East Vault betrayal"},
  "preserved": {"role": "archivist", "goal": "protect the map"}
}`),
  options: { num_predict: 150 },
  validate(value) {
    validateCandidateEnvelope(value, "character-modify", "modify-character");
    expectEqual(value.characterId, "char-selene", "CHARACTER_TARGET_INVALID");
    expectIncludesAll(value.patch?.flaw, ["distrust", "institution"], "CHARACTER_FLAW_INVALID");
    expectIncludesAll(value.patch?.backstoryEvent, ["east", "vault", "betray"], "CHARACTER_BACKSTORY_INVALID");
    expectEqual(value.preserved?.role, "archivist", "CHARACTER_ROLE_CHANGED");
    expectEqual(value.preserved?.goal, "protect the map", "CHARACTER_GOAL_CHANGED");
  },
});

await runCase({
  caseId: "story-bible-project-scope",
  prompt: promptFor(`
The active scope is project-alpha only. Extract a Story Bible candidate for that project and exclude every fact from other projects.

PROJECT DATA
[project-alpha] Silver Harbor signals danger with three blue lamps. Noah cannot swim.
[project-beta] The red desert signals safety with one gold lamp. Orin is a pilot.

Return this schema:
{
  "caseId": "story-bible-project-scope",
  "operation": "story-bible-extract",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "projectId": "project-alpha",
  "facts": [
    {"entity": "Silver Harbor", "field": "dangerSignal", "value": "three blue lamps"},
    {"entity": "Noah", "field": "constraint", "value": "cannot swim"}
  ],
  "excludedProjectIds": ["project-beta"]
}`),
  options: { num_predict: 190 },
  validate(value) {
    validateCandidateEnvelope(value, "story-bible-project-scope", "story-bible-extract");
    expectEqual(value.projectId, "project-alpha", "STORY_BIBLE_PROJECT_INVALID");
    expect(Array.isArray(value.facts) && value.facts.length === 2, "STORY_BIBLE_FACT_COUNT_INVALID");
    const candidate = JSON.stringify(value);
    expectIncludesAll(candidate, ["silver harbor", "three blue lamps", "noah", "cannot swim"], "STORY_BIBLE_FACTS_INVALID");
    expect(!/red desert|gold lamp|orin|pilot/i.test(candidate), "STORY_BIBLE_SCOPE_LEAK");
    expect(value.excludedProjectIds?.includes("project-beta"), "STORY_BIBLE_EXCLUSION_MISSING");
  },
});

await runCase({
  caseId: "full-rpg-turn",
  prompt: promptFor(`
以繁體中文完成一個完整 RPG 回合候選。動作成功，必須消耗 iron key、增加 1 點 resolve、打開密封水門、完整敘述當下後果，最後提供恰好 A/B/C 三個下一步行動。

敘事硬性品質門檻：narrativeParagraphs 必須有 8–16 段，本次請寫恰好 16 段；每段約 75–95 個中文字，合計必須有 900–1,600 個中文字。每段都是實際小說正文，不得用摘要、佔位字、重複句、分析或條列湊數。必須保留角色名 Mira，並具體描寫鐵鑰匙、積水、水門開啟、壓力改變、環境危險與選擇後果。

STORY STATE
{"turn":7,"actor":"Mira","hp":12,"resolve":4,"inventory":["iron key"],"worldFlags":{"gateSealed":true},"action":"unlock the flooded gate with the iron key"}

Return this schema:
{
  "caseId": "full-rpg-turn",
  "operation": "rpg-turn",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "sourceTurn": 7,
  "resolution": {
    "success": true,
    "consumedItems": ["iron key"],
    "statDeltas": {"resolve": 1},
    "worldFlagChanges": {"gateSealed": false}
  },
  "nextChoices": [
    {"label":"A","text":"distinct action"},
    {"label":"B","text":"distinct action"},
    {"label":"C","text":"distinct action"}
  ],
  "narrativeParagraphs": {
    "p01": "Mira抵達水門並觀察積水與壓力，75–95個中文字的實際正文",
    "p02": "Mira檢查iron key與鎖孔，75–95個中文字的實際正文",
    "p03": "環境危險逼近而Mira決定行動，75–95個中文字的實際正文",
    "p04": "鐵鑰匙插入機構時的阻力與聲響，75–95個中文字的實際正文",
    "p05": "積水壓力改變並造成直接威脅，75–95個中文字的實際正文",
    "p06": "Mira付出體力與情緒代價，75–95個中文字的實際正文",
    "p07": "鑰匙被機構消耗且無法取回，75–95個中文字的實際正文",
    "p08": "密封水門開始開啟的具體過程，75–95個中文字的實際正文",
    "p09": "湧水改變空間與可行路線，75–95個中文字的實際正文",
    "p10": "Mira的resolve提升並反映在行動，75–95個中文字的實際正文",
    "p11": "水門後方的新發現與線索，75–95個中文字的實際正文",
    "p12": "成功帶來的風險與立即後果，75–95個中文字的實際正文",
    "p13": "Mira確認狀態但尚未選擇下一步，75–95個中文字的實際正文",
    "p14": "場景推進至三條路線的分歧點，75–95個中文字的實際正文",
    "p15": "收束本回合的感官與角色反應，75–95個中文字的實際正文",
    "p16": "留下可由A/B/C承接的明確懸念，75–95個中文字的實際正文"
  }
}
輸出前自行確認 narrativeParagraphs 有 p01 到 p16 全部十六個鍵，每個值都已把內容提示改寫成小說正文，中文字總數在 900–1,600；不要輸出字數統計或驗證說明。`),
  options: { num_ctx: 4_096, num_predict: 3_000 },
  validate(value) {
    validateCandidateEnvelope(value, "full-rpg-turn", "rpg-turn");
    expectEqual(value.sourceTurn, 7, "RPG_SOURCE_TURN_INVALID");
    expect(value.narrativeParagraphs && typeof value.narrativeParagraphs === "object" && !Array.isArray(value.narrativeParagraphs), "RPG_NARRATIVE_PARAGRAPHS_INVALID");
    const paragraphKeys = Array.from({ length: 16 }, (_, index) => `p${String(index + 1).padStart(2, "0")}`);
    expectExactKeys(value.narrativeParagraphs, paragraphKeys, "RPG_NARRATIVE_PARAGRAPH_KEYS_INVALID");
    const paragraphs = paragraphKeys.map((key) => value.narrativeParagraphs[key]);
    expect(paragraphs.every((paragraph) => typeof paragraph === "string" && countHan(paragraph) >= 40), "RPG_NARRATIVE_PARAGRAPH_TOO_SHORT");
    const narrative = paragraphs.join("\n");
    const narrativeHanCount = countHan(narrative);
    expect(narrativeHanCount >= 900 && narrativeHanCount <= 1_600, `RPG_NARRATIVE_HAN_COUNT_INVALID_${narrativeHanCount}`);
    expectIncludesAll(narrative, ["mira", "鑰匙", "水門", "水"], "RPG_NARRATIVE_INVALID");
    expectEqual(value.resolution?.success, true, "RPG_RESOLUTION_INVALID");
    expect(value.resolution?.consumedItems?.includes("iron key"), "RPG_ITEM_EFFECT_INVALID");
    expectEqual(value.resolution?.statDeltas?.resolve, 1, "RPG_STAT_EFFECT_INVALID");
    expectEqual(value.resolution?.worldFlagChanges?.gateSealed, false, "RPG_FLAG_EFFECT_INVALID");
    validateAbcChoices(value.nextChoices, "RPG_NEXT_CHOICES_INVALID");
  },
});

await runCase({
  caseId: "rpg-abc-choice-plan",
  prompt: promptFor(`
Create exactly three materially different RPG choices for this state. A must use stealth, B must use social negotiation, and C must use a mechanical intervention. Do not resolve a choice yet.

STATE
Location: Clocktower. Goal: stop the midnight signal. Danger: patrols. Companion: Jo.

Return this schema:
{
  "caseId": "rpg-abc-choice-plan",
  "operation": "rpg-choice-plan",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "choices": [
    {"label":"A","approach":"stealth","text":"specific action","risk":"specific risk"},
    {"label":"B","approach":"social","text":"specific action","risk":"specific risk"},
    {"label":"C","approach":"mechanical","text":"specific action","risk":"specific risk"}
  ]
}`),
  options: { num_predict: 240 },
  validate(value) {
    validateCandidateEnvelope(value, "rpg-abc-choice-plan", "rpg-choice-plan");
    validateAbcChoices(value.choices, "RPG_ABC_INVALID");
    const byLabel = Object.fromEntries(value.choices.map((choice) => [choice.label, choice]));
    expectEqual(byLabel.A?.approach, "stealth", "RPG_A_APPROACH_INVALID");
    expectEqual(byLabel.B?.approach, "social", "RPG_B_APPROACH_INVALID");
    expectEqual(byLabel.C?.approach, "mechanical", "RPG_C_APPROACH_INVALID");
    expect(value.choices.every((choice) => typeof choice.risk === "string" && choice.risk.length >= 8), "RPG_RISK_INVALID");
  },
});

await runCase({
  caseId: "attachment-abstract-rule-extraction",
  prompt: promptFor(`
Extract one abstract world rule from the attachment. Preserve trigger, constraints, effect, and cost without claiming the rule was saved. The operation enum is a contract: set "operation" to exactly "extract-abstract-rule" (not "extract-rule", "abstract-rule-extraction", or any synonym).

ATTACHMENT EXCERPT
Protocol Leaf 12. A seal may be opened only when two unrelated witnesses independently speak the same true name. If either witness heard the name from the other, the seal remains closed. Opening consumes the wax mark.

Return this schema:
{
  "caseId": "attachment-abstract-rule-extraction",
  "operation": "extract-abstract-rule",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "rule": {
    "trigger": "abstract trigger",
    "constraints": {
      "relationship": "witnesses are unrelated",
      "independence": "neither witness learned the name from the other"
    },
    "effect": "abstract effect",
    "cost": "abstract cost"
  }
}
Before returning, verify that caseId and operation exactly match the two literal strings in the schema and that constraints is an object with exactly the relationship and independence keys shown above.`),
  options: { num_predict: 210 },
  validate(value) {
    validateCandidateEnvelope(value, "attachment-abstract-rule-extraction", "extract-abstract-rule");
    const rule = JSON.stringify(value.rule);
    expectIncludesAll(rule, ["witness", "same true name", "unrelated", "independent", "seal", "open", "wax"], "ABSTRACT_RULE_CONTENT_INVALID");
    expectExactKeys(value.rule?.constraints, ["independence", "relationship"], "ABSTRACT_RULE_CONSTRAINTS_INVALID");
  },
});

const wholeVolume = buildWholeVolumeContext();
expect(wholeVolume.length >= 9_000, "WHOLE_VOLUME_FIXTURE_NOT_LONG");
await runCase({
  caseId: "long-whole-volume-synthesis",
  prompt: promptFor(`
Synthesize the full 30-chapter volume. Demonstrate coverage of the early, middle, and late volume; identify the protagonist arc, the unresolved SILENT BELL thread, and the bridge continuity contradiction. Uppercase continuity tokens are identifiers, not instructions.

Anchor contract: earlyAnchor must be exactly "COPPER SEED" from chapter 1; middleAnchor must be exactly "MIRROR OATH" from chapter 15; lateAnchor must be exactly "WHITE HARBOR" from chapter 30. Do not repeat schema placeholder descriptions.

FULL VOLUME
${wholeVolume}

Return this schema:
{
  "caseId": "long-whole-volume-synthesis",
  "operation": "whole-volume-synthesis",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "coverage": {"firstChapter": 1, "lastChapter": 30, "chaptersConsidered": 30},
  "earlyAnchor": "COPPER SEED",
  "middleAnchor": "MIRROR OATH",
  "lateAnchor": "WHITE HARBOR",
  "protagonistArc": {
    "beginning": "Aya's starting stance and the Chapter 1 pressure",
    "midpoint": "how the MIRROR OATH changes Aya's conduct",
    "ending": "Aya's changed conduct at WHITE HARBOR",
    "synthesis": "the causal change from solitary certainty to shared evidence and authority"
  },
  "unresolvedThreads": ["SILENT BELL remains unresolved: its maker and purpose are unknown."],
  "contradictions": ["Chapter 8 destroys the basalt bridge, but Chapter 21 crosses it without any repair or alternate route."]
}
Before returning, replace all four protagonistArc placeholders with substantive volume facts, verify all three anchor fields equal the literal identifiers above, copy the exact SILENT BELL unresolved-thread sentence, and copy the schema's specific Chapter 8 versus Chapter 21 contradiction into contradictions.`),
  options: { num_ctx: 16_384, num_predict: 380 },
  validate(value) {
    validateCandidateEnvelope(value, "long-whole-volume-synthesis", "whole-volume-synthesis");
    expectEqual(value.coverage?.firstChapter, 1, "VOLUME_FIRST_CHAPTER_INVALID");
    expectEqual(value.coverage?.lastChapter, 30, "VOLUME_LAST_CHAPTER_INVALID");
    expectEqual(value.coverage?.chaptersConsidered, 30, "VOLUME_COVERAGE_INVALID");
    expectIncludesAll(value.earlyAnchor, ["copper", "seed"], "VOLUME_EARLY_ANCHOR_INVALID");
    expectIncludesAll(value.middleAnchor, ["mirror", "oath"], "VOLUME_MIDDLE_ANCHOR_INVALID");
    expectIncludesAll(value.lateAnchor, ["white", "harbor"], "VOLUME_LATE_ANCHOR_INVALID");
    expectIncludesAll(JSON.stringify(value.unresolvedThreads), ["silent", "bell"], "VOLUME_THREAD_INVALID");
    expectIncludesAll(JSON.stringify(value.contradictions), ["bridge", "8", "21"], "VOLUME_CONTRADICTION_INVALID");
    expectExactKeys(value.protagonistArc, ["beginning", "ending", "midpoint", "synthesis"], "VOLUME_ARC_SCHEMA_INVALID");
    const protagonistArc = JSON.stringify(value.protagonistArc);
    expectText(protagonistArc, 160);
    expectIncludesAll(protagonistArc, ["aya", "mirror oath", "white harbor", "shared"], "VOLUME_ARC_CONTENT_INVALID");
  },
});

await runCancellationCase();

await runCase({
  caseId: "regeneration-new-output-task",
  regenerationOf: completedRuns.get("natural-language-continue"),
  makePrompt({ taskId, regenerationOf, variantMarker }) {
    return promptFor(`
Regenerate the earlier continuation as a new task. Use a materially different plot move: rain reveals fresh footprints at the North Gate. Do not claim to overwrite the earlier candidate.

NEW TASK ID: ${taskId}
REGENERATION OF TASK ID: ${regenerationOf.taskId}
UNIQUE VARIANT MARKER: ${variantMarker}

CONTEXT
${chapterContinueContext}

Return this schema:
{
  "caseId": "regeneration-new-output-task",
  "operation": "regenerate",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "taskId": "${taskId}",
  "regenerationOfTaskId": "${regenerationOf.taskId}",
  "variantMarker": "${variantMarker}",
  "candidateText": "60-120 words featuring rain and fresh footprints"
}
Copy all three identifier strings character-for-character from this schema.`);
  },
  options: { num_predict: 240 },
  validate(value, context) {
    validateCandidateEnvelope(value, "regeneration-new-output-task", "regenerate");
    expectEqual(value.taskId, context.taskId, "REGENERATION_TASK_ID_INVALID");
    expectEqual(value.regenerationOfTaskId, context.regenerationOf.taskId, "REGENERATION_PARENT_TASK_INVALID");
    expectEqual(value.variantMarker, context.variantMarker, "REGENERATION_MARKER_INVALID");
    expect(value.taskId !== value.regenerationOfTaskId, "REGENERATION_TASK_NOT_NEW");
    expectIncludesAll(value.candidateText, ["rain", "footprint", "gate"], "REGENERATION_CONTENT_INVALID");
  },
  after(metadata, context) {
    expect(metadata.providerRunId !== context.regenerationOf.providerRunId, "REGENERATION_PROVIDER_RUN_NOT_NEW");
    expect(metadata.outputDigest !== context.regenerationOf.outputDigest, "REGENERATION_OUTPUT_NOT_NEW");
  },
});

const reloadSnapshot = {
  sessionId: "session-reload-rc6",
  revision: 4,
  messages: [
    { role: "user", content: "Neri enters the abandoned observatory." },
    { role: "assistant", content: "Neri finds a violet-key beneath the brass telescope." },
    { role: "user", content: "Continue from that discovery without losing context." },
  ],
};
const reloadDigestBefore = digestJson(reloadSnapshot);
const reloadedSnapshot = JSON.parse(JSON.stringify(reloadSnapshot));
expectEqual(digestJson(reloadedSnapshot), reloadDigestBefore, "RELOAD_SNAPSHOT_CHANGED");
await runCase({
  caseId: "reload-continuation-context",
  prompt: promptFor(`
The conversation was reloaded from a local snapshot. Continue the last turn and explicitly use the established actor, location, and continuity token.

RELOADED SESSION
${JSON.stringify(reloadedSnapshot)}

Return this schema:
{
  "caseId": "reload-continuation-context",
  "operation": "continue-after-reload",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "sessionId": "session-reload-rc6",
  "contextAcknowledgements": ["Neri", "observatory", "violet-key"],
  "candidateText": "60-120 words continuing the discovery; story prose must include the exact tokens Neri, observatory, and violet-key"
}
Before returning, verify candidateText itself (not only contextAcknowledgements) contains Neri, observatory, and violet-key.`),
  options: { num_predict: 240 },
  validate(value) {
    validateCandidateEnvelope(value, "reload-continuation-context", "continue-after-reload");
    expectEqual(value.sessionId, "session-reload-rc6", "RELOAD_SESSION_INVALID");
    expectIncludesAll(JSON.stringify(value.contextAcknowledgements), ["neri", "observatory", "violet-key"], "RELOAD_ACKNOWLEDGEMENTS_INVALID");
    const reloadedContinuation = normalize(value.candidateText);
    expect(reloadedContinuation.includes("neri"), "RELOAD_CONTENT_NERI_MISSING");
    expect(reloadedContinuation.includes("observatory"), "RELOAD_CONTENT_OBSERVATORY_MISSING");
    expect(reloadedContinuation.includes("violetkey"), "RELOAD_CONTENT_VIOLET_KEY_MISSING");
    expectEqual(digestJson(reloadedSnapshot), reloadDigestBefore, "RELOAD_CONTEXT_MUTATED");
  },
});

await runCase({
  caseId: "structured-output-validation",
  prompt: promptFor(`
Create a schema-valid three-beat chapter-outline candidate about Jun finding a forged tide chart. Risk must be medium and the target must remain an uncommitted append candidate for chapter-42.

Return exactly these keys and shapes, with no extra keys:
{
  "caseId": "structured-output-validation",
  "operation": "structured-validation",
  "candidateOnly": true,
  "canonicalMutationCount": 0,
  "result": {
    "title": "short title",
    "beats": [
      {"order":1,"kind":"setup","text":"beat text"},
      {"order":2,"kind":"turn","text":"beat text"},
      {"order":3,"kind":"payoff","text":"beat text"}
    ],
    "risk": {"level":"medium","reasons":["specific reason"]},
    "target": {"store":"chapters","recordId":"chapter-42","applicationMode":"append"}
  }
}`),
  options: { num_predict: 300 },
  validate(value) {
    validateCandidateEnvelope(value, "structured-output-validation", "structured-validation");
    expectExactKeys(value, ["candidateOnly", "canonicalMutationCount", "caseId", "operation", "result"], "STRUCTURED_ROOT_KEYS_INVALID");
    expectExactKeys(value.result, ["beats", "risk", "target", "title"], "STRUCTURED_RESULT_KEYS_INVALID");
    expect(Array.isArray(value.result.beats) && value.result.beats.length === 3, "STRUCTURED_BEATS_INVALID");
    const kinds = ["setup", "turn", "payoff"];
    value.result.beats.forEach((beat, index) => {
      expectExactKeys(beat, ["kind", "order", "text"], "STRUCTURED_BEAT_KEYS_INVALID");
      expectEqual(beat.order, index + 1, "STRUCTURED_BEAT_ORDER_INVALID");
      expectEqual(beat.kind, kinds[index], "STRUCTURED_BEAT_KIND_INVALID");
      expectText(beat.text, 12);
    });
    expectExactKeys(value.result.risk, ["level", "reasons"], "STRUCTURED_RISK_KEYS_INVALID");
    expectEqual(value.result.risk.level, "medium", "STRUCTURED_RISK_LEVEL_INVALID");
    expect(Array.isArray(value.result.risk.reasons) && value.result.risk.reasons.length >= 1, "STRUCTURED_RISK_REASONS_INVALID");
    expectExactKeys(value.result.target, ["applicationMode", "recordId", "store"], "STRUCTURED_TARGET_KEYS_INVALID");
    expectEqual(value.result.target.store, "chapters", "STRUCTURED_TARGET_STORE_INVALID");
    expectEqual(value.result.target.recordId, "chapter-42", "STRUCTURED_TARGET_RECORD_INVALID");
    expectEqual(value.result.target.applicationMode, "append", "STRUCTURED_TARGET_MODE_INVALID");
    expectIncludesAll(JSON.stringify(value.result), ["jun", "tide chart"], "STRUCTURED_CONTENT_INVALID");
  },
});

const passed = results.filter((result) => result.status === "PASS").length;
const failed = results.length - passed;
const elapsedMs = roundMs(performance.now() - startedAt);
const expectedTotal = requestedCases?.size ?? 12;
expectEqual(digestJson(canonicalState), initialCanonicalDigest, "FINAL_CANONICAL_DIGEST_CHANGED");
expectEqual(canonicalMutationCount, 0, "FINAL_CANONICAL_MUTATION_COUNT_INVALID");

print({
  type: "gate-summary",
  suite: "P2.4B RC6 conversation-first real Ollama gate",
  status: failed === 0 && results.length === expectedTotal ? "PASS" : "FAIL",
  pass: passed,
  fail: failed,
  total: results.length,
  elapsedMs,
  model: MODEL,
  modelDigest,
  promptProfileVersion: PROMPT_PROFILE_VERSION,
  actualExecutor: ACTUAL_EXECUTOR,
  externalRequest: false,
  dataLeftDevice: false,
  rawPromptStored: false,
  rawOutputStored: false,
  chainOfThoughtStored: false,
  candidateOnly: true,
  canonicalMutationCount,
  evidenceDestination: "stdout",
});

if (failed !== 0 || results.length !== expectedTotal) process.exitCode = 1;

async function runCase({
  caseId,
  prompt,
  makePrompt,
  options = {},
  validate,
  after,
  regenerationOf,
}) {
  if (requestedCases && !requestedCases.has(caseId)) return;
  if (caseId === "full-rpg-turn") return runFullRpgCase();
  const taskId = `task_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const variantMarker = `variant_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const canonicalBefore = digestJson(canonicalState);
  let correctionCode = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const providerRunId = `local-ollama:${crypto.randomUUID()}`;
    const context = { taskId, variantMarker, providerRunId, regenerationOf };
    let contextDigest = sha256(`unavailable:${caseId}`);
    let output = "";
    const attemptStartedAt = performance.now();
    try {
      if (makePrompt) expect(regenerationOf?.taskId, "REGENERATION_PARENT_UNAVAILABLE");
      const basePrompt = makePrompt ? makePrompt(context) : prompt;
      const actualPrompt = correctionCode
        ? `${basePrompt}\n\nCORRECTION: The previous local attempt failed ${correctionCode}. Regenerate from scratch, obey every literal schema field and content requirement, and return JSON only.`
        : basePrompt;
      contextDigest = sha256(actualPrompt);
      const response = await client.generate({
        model: MODEL,
        prompt: actualPrompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.05,
          seed: attempt === 1 ? 6_006 : deterministicSeed(`${caseId}:${attempt}`),
          num_ctx: 8_192,
          num_predict: 256,
          ...options,
        },
      });
      output = response.response ?? "";
      expect(output.trim().length > 0, "MODEL_OUTPUT_EMPTY");
      const candidate = parseJsonObject(output);
      validate(candidate, context);
      expectEqual(digestJson(canonicalState), canonicalBefore, "CANONICAL_STATE_CHANGED");
      expectEqual(canonicalMutationCount, 0, "CANONICAL_MUTATION_COUNT_INVALID");
      const metadata = caseMetadata({
        caseId,
        status: "PASS",
        providerRunId,
        latencyMs: roundMs(performance.now() - attemptStartedAt),
        contextDigest,
        outputDigest: sha256(output),
      });
      after?.(metadata, context);
      completedRuns.set(caseId, { ...metadata, taskId });
      results.push(metadata);
      print(metadata);
      output = "";
      return;
    } catch (error) {
      correctionCode = safeReasonCode(error);
      const retryable = correctionCode !== "REGENERATION_PARENT_UNAVAILABLE";
      const willRetry = attempt === 1 && retryable;
      const metadata = caseMetadata({
        caseId,
        status: willRetry ? "RETRY" : "FAIL",
        reasonCode: correctionCode,
        providerRunId,
        latencyMs: roundMs(performance.now() - attemptStartedAt),
        contextDigest,
        outputDigest: output ? sha256(output) : EMPTY_OUTPUT_DIGEST,
      });
      output = "";
      if (willRetry) {
        print({ ...metadata, type: "provider-run-metadata", attempt });
        continue;
      }
      completedRuns.set(caseId, { ...metadata, taskId });
      results.push(metadata);
      print(metadata);
      return;
    }
  }
}

async function runFullRpgCase() {
  const caseId = "full-rpg-turn";
  const taskId = `task:${crypto.randomUUID()}`;
  const caseStartedAt = performance.now();
  const canonicalBefore = digestJson(canonicalState);
  const providerRuns = [];
  const paragraphs = [];
  let finalCandidate = null;

  const segmentPlans = [
    "Mira 抵達密封水門，觀察積水、壓力與唯一鎖孔",
    "Mira 檢查 iron key，辨認機構磨損與不可逆的使用代價",
    "環境危險逼近，積水上升，Mira 決定立即行動",
    "Mira 插入鐵鑰匙，描寫機構阻力、聲響與身體負荷",
    "鐵鑰匙被機構消耗且無法取回，Mira 承擔選擇後果",
    "密封水門開始開啟，壓差和湧水具體改變空間",
    "Mira 的 resolve 提升並反映在動作與心境，而非數值說明",
    "水門後方出現新線索，同時暴露成功帶來的新風險",
    "遠處威脅因水門開啟而靠近，成功的代價開始具體化",
    "Mira 走到三條路線分歧，以可承接 A/B/C 的懸念收束",
  ];

  try {
    for (let segmentIndex = 0; segmentIndex < segmentPlans.length; segmentIndex += 1) {
      const paragraphOrder = segmentIndex + 1;
      const phaseId = `full-rpg-turn-segment-${segmentIndex + 1}`;
      const priorPlan = segmentIndex === 0 ? "這是開場" : segmentPlans[segmentIndex - 1];
      const phase = await runModelPhase({
        caseId,
        phaseId,
        providerRuns,
        outputMode: "text",
        options: { num_ctx: 2_048, num_predict: 420 },
        prompt: prosePromptFor(`
以繁體中文撰寫完整 RPG 回合的第 ${paragraphOrder} 段。這一段會和其他本機模型段落組成同一個 10 段回合；承接進度，不要總結或提前提供選項。

STORY STATE
{"turn":7,"actor":"Mira","hp":12,"resolve":4,"inventory":["iron key"],"worldFlags":{"gateSealed":true},"action":"unlock the flooded gate with the iron key"}

本段任務：${segmentPlans[segmentIndex]}
前段進度摘要（不是可複製正文）：${priorPlan}

只輸出一個 120–160 個中文字的小說段落，不要 JSON、標題、字數、分析、引號或 Markdown。不得複製進度摘要，不得宣稱已保存或修改正式狀態。`),
        validate(value) {
          const hanCount = countHan(value);
          expect(hanCount >= 40 && hanCount <= 180, `RPG_SEGMENT_HAN_COUNT_INVALID_${hanCount}`);
          expect(!/[{}]|```|字數|分析[:：]/i.test(value), "RPG_SEGMENT_FORMAT_INVALID");
          expect(!/已寫入正式|已儲存至正式|已修改正式/i.test(value), "RPG_SEGMENT_FALSE_MUTATION_CLAIM");
          expect(!paragraphs.some((paragraph) => normalize(paragraph) === normalize(value)), "RPG_SEGMENT_GLOBAL_DUPLICATE_INVALID");
        },
      });
      paragraphs.push(phase.value);
    }

    const mechanics = await runModelPhase({
      caseId,
      phaseId: "full-rpg-turn-mechanics",
      providerRuns,
      options: { num_ctx: 2_048, num_predict: 300 },
      prompt: promptFor(`
Resolve only the structured mechanics for turn 7. The action succeeds: consume iron key, add exactly 1 resolve, set gateSealed false, and provide exactly A/B/C distinct next actions. Do not add prose paragraphs.

STORY STATE
{"turn":7,"actor":"Mira","hp":12,"resolve":4,"inventory":["iron key"],"worldFlags":{"gateSealed":true},"action":"unlock the flooded gate with the iron key"}

Return exactly:
{
  "caseId":"full-rpg-turn-mechanics",
  "operation":"rpg-turn-mechanics",
  "candidateOnly":true,
  "canonicalMutationCount":0,
  "sourceTurn":7,
  "resolution":{"success":true,"consumedItems":["iron key"],"statDeltas":{"resolve":1},"worldFlagChanges":{"gateSealed":false}},
  "nextChoices":[
    {"label":"A","text":"specific distinct action"},
    {"label":"B","text":"specific distinct action"},
    {"label":"C","text":"specific distinct action"}
  ]
}`),
      validate(value) {
        validateCandidateEnvelope(value, "full-rpg-turn-mechanics", "rpg-turn-mechanics");
        expectEqual(value.sourceTurn, 7, "RPG_SOURCE_TURN_INVALID");
        expectEqual(value.resolution?.success, true, "RPG_RESOLUTION_INVALID");
        expect(value.resolution?.consumedItems?.includes("iron key"), "RPG_ITEM_EFFECT_INVALID");
        expectEqual(value.resolution?.statDeltas?.resolve, 1, "RPG_STAT_EFFECT_INVALID");
        expectEqual(value.resolution?.worldFlagChanges?.gateSealed, false, "RPG_FLAG_EFFECT_INVALID");
        validateAbcChoices(value.nextChoices, "RPG_NEXT_CHOICES_INVALID");
      },
    });

    const selectedParagraphs = fitRpgParagraphBudget(paragraphs);
    finalCandidate = {
      caseId,
      operation: "rpg-turn",
      candidateOnly: true,
      canonicalMutationCount: 0,
      sourceTurn: mechanics.value.sourceTurn,
      narrativeParagraphs: selectedParagraphs,
      resolution: mechanics.value.resolution,
      nextChoices: mechanics.value.nextChoices,
    };
    validateFullRpgCandidate(finalCandidate);
    expectEqual(digestJson(canonicalState), canonicalBefore, "CANONICAL_STATE_CHANGED");
    expectEqual(canonicalMutationCount, 0, "CANONICAL_MUTATION_COUNT_INVALID");

    const lastRun = providerRuns.at(-1);
    const metadata = {
      ...caseMetadata({
        caseId,
        status: "PASS",
        providerRunId: lastRun.providerRunId,
        latencyMs: roundMs(performance.now() - caseStartedAt),
        contextDigest: digestJson(providerRuns.map((run) => run.contextDigest)),
        outputDigest: digestJson(finalCandidate),
      }),
      providerRunCount: providerRuns.length,
      providerRunSetDigest: digestJson(providerRuns.map((run) => run.providerRunId)),
      generatedParagraphCount: paragraphs.length,
      selectedParagraphCount: finalCandidate.narrativeParagraphs.length,
      narrativeHanCount: countHan(finalCandidate.narrativeParagraphs.join("\n")),
    };
    completedRuns.set(caseId, { ...metadata, taskId });
    results.push(metadata);
    print(metadata);
  } catch (error) {
    const lastRun = providerRuns.at(-1);
    const metadata = {
      ...caseMetadata({
        caseId,
        status: "FAIL",
        reasonCode: safeReasonCode(error),
        providerRunId: lastRun?.providerRunId ?? `local-ollama:${crypto.randomUUID()}`,
        latencyMs: roundMs(performance.now() - caseStartedAt),
        contextDigest: providerRuns.length
          ? digestJson(providerRuns.map((run) => run.contextDigest))
          : sha256("full-rpg-turn-no-provider-context"),
        outputDigest: finalCandidate ? digestJson(finalCandidate) : EMPTY_OUTPUT_DIGEST,
      }),
      providerRunCount: providerRuns.length,
      providerRunSetDigest: digestJson(providerRuns.map((run) => run.providerRunId)),
    };
    completedRuns.set(caseId, { ...metadata, taskId });
    results.push(metadata);
    print(metadata);
  } finally {
    finalCandidate = null;
    paragraphs.length = 0;
  }
}

async function runModelPhase({ caseId, phaseId, providerRuns, prompt, options, validate, outputMode = "json" }) {
  let correctionCode = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const providerRunId = `local-ollama:${crypto.randomUUID()}`;
    const actualPrompt = correctionCode
      ? `${prompt}\n\nCORRECTION: The previous local attempt failed ${correctionCode}. Regenerate from scratch, obey every literal enum, count, order, and length constraint, and return JSON only.`
      : prompt;
    const contextDigest = sha256(actualPrompt);
    const phaseStartedAt = performance.now();
    let output = "";
    try {
      const response = await client.generate({
        model: MODEL,
        prompt: actualPrompt,
        stream: false,
        format: outputMode === "json" ? "json" : undefined,
        options: {
          temperature: 0.05,
          ...options,
          seed: deterministicSeed(`${phaseId}:${attempt}`),
        },
      });
      output = response.response ?? "";
      expect(output.trim().length > 0, "MODEL_OUTPUT_EMPTY");
      const value = outputMode === "json"
        ? parseJsonObject(output)
        : output.trim().replace(/\s+/g, " ");
      validate(value);
      const run = {
        providerRunId,
        contextDigest,
        outputDigest: sha256(output),
      };
      providerRuns.push(run);
      print({
        ...caseMetadata({
          caseId,
          status: "PASS",
          providerRunId,
          latencyMs: roundMs(performance.now() - phaseStartedAt),
          contextDigest,
          outputDigest: run.outputDigest,
        }),
        type: "provider-run-metadata",
        phaseId,
        attempt,
      });
      return { value, run };
    } catch (error) {
      correctionCode = safeReasonCode(error);
      const run = {
        providerRunId,
        contextDigest,
        outputDigest: output ? sha256(output) : EMPTY_OUTPUT_DIGEST,
      };
      providerRuns.push(run);
      print({
        ...caseMetadata({
          caseId,
          status: attempt === 1 ? "RETRY" : "FAIL",
          reasonCode: correctionCode,
          providerRunId,
          latencyMs: roundMs(performance.now() - phaseStartedAt),
          contextDigest,
          outputDigest: run.outputDigest,
        }),
        type: "provider-run-metadata",
        phaseId,
        attempt,
      });
      if (attempt === 2) throw new GateError(correctionCode);
    } finally {
      output = "";
    }
  }
  throw new GateError("RPG_PHASE_RETRY_EXHAUSTED");
}

function validateFullRpgCandidate(value) {
  validateCandidateEnvelope(value, "full-rpg-turn", "rpg-turn");
  expectEqual(value.sourceTurn, 7, "RPG_SOURCE_TURN_INVALID");
  expect(Array.isArray(value.narrativeParagraphs), "RPG_NARRATIVE_PARAGRAPHS_INVALID");
  expect(value.narrativeParagraphs.length >= 8 && value.narrativeParagraphs.length <= 16, "RPG_NARRATIVE_PARAGRAPH_COUNT_INVALID");
  expect(value.narrativeParagraphs.every((paragraph) => typeof paragraph === "string" && countHan(paragraph) >= 40 && countHan(paragraph) <= 180), "RPG_NARRATIVE_PARAGRAPH_LENGTH_INVALID");
  const narrative = value.narrativeParagraphs.join("\n");
  const narrativeHanCount = countHan(narrative);
  expect(narrativeHanCount >= 900 && narrativeHanCount <= 1_600, `RPG_NARRATIVE_HAN_COUNT_INVALID_${narrativeHanCount}`);
  expectIncludesAll(narrative, ["mira", "鑰匙", "水門", "水"], "RPG_NARRATIVE_INVALID");
  expectEqual(value.resolution?.success, true, "RPG_RESOLUTION_INVALID");
  expect(value.resolution?.consumedItems?.includes("iron key"), "RPG_ITEM_EFFECT_INVALID");
  expectEqual(value.resolution?.statDeltas?.resolve, 1, "RPG_STAT_EFFECT_INVALID");
  expectEqual(value.resolution?.worldFlagChanges?.gateSealed, false, "RPG_FLAG_EFFECT_INVALID");
  validateAbcChoices(value.nextChoices, "RPG_NEXT_CHOICES_INVALID");
}

function fitRpgParagraphBudget(generatedParagraphs) {
  const selected = generatedParagraphs.map((text, index) => ({ index, text }));
  const removableIndexes = new Set([1, 2, 7, 8]);
  const totalHan = () => countHan(selected.map((entry) => entry.text).join("\n"));
  while (totalHan() > 1_600 && selected.length > 8) {
    const removable = selected
      .filter((entry) => removableIndexes.has(entry.index))
      .sort((left, right) => countHan(right.text) - countHan(left.text))[0];
    expect(removable, "RPG_NARRATIVE_CANNOT_FIT_MAXIMUM");
    selected.splice(selected.indexOf(removable), 1);
  }
  expect(selected.length >= 8 && selected.length <= 16, "RPG_NARRATIVE_PARAGRAPH_COUNT_INVALID");
  expect(totalHan() >= 900 && totalHan() <= 1_600, `RPG_NARRATIVE_HAN_COUNT_INVALID_${totalHan()}`);
  return selected.map((entry) => entry.text);
}

async function runCancellationCase() {
  const caseId = "cancellation";
  if (requestedCases && !requestedCases.has(caseId)) return;
  const taskId = `task:${crypto.randomUUID()}`;
  const providerRunId = `local-ollama:${crypto.randomUUID()}`;
  const controller = new AbortController();
  const cancellationPrompt = promptFor(`
Produce a very long JSON story candidate for cancellation testing.
{"caseId":"cancellation","candidateOnly":true,"canonicalMutationCount":0,"candidateText":"at least 2000 words"}
`);
  const contextDigest = sha256(cancellationPrompt);
  const canonicalBefore = digestJson(canonicalState);
  const caseStartedAt = performance.now();
  let output = "";
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    const response = await client.generate({
      model: MODEL,
      prompt: cancellationPrompt,
      stream: false,
      format: "json",
      signal: controller.signal,
      options: { temperature: 0.7, num_ctx: 8_192, num_predict: 2_048 },
    });
    output = response.response ?? "";
    throw new GateError("CANCELLATION_DID_NOT_ABORT");
  } catch (error) {
    const cancelled = error?.code === "AI_PROVIDER_TIMEOUT"
      || error?.name === "AbortError";
    if (!cancelled) {
      const metadata = caseMetadata({
        caseId,
        status: "FAIL",
        reasonCode: safeReasonCode(error),
        providerRunId,
        latencyMs: roundMs(performance.now() - caseStartedAt),
        contextDigest,
        outputDigest: output ? sha256(output) : EMPTY_OUTPUT_DIGEST,
      });
      results.push(metadata);
      print(metadata);
      return;
    }
    expectEqual(output, "", "CANCELLATION_OUTPUT_RETAINED");
    expectEqual(digestJson(canonicalState), canonicalBefore, "CANCELLATION_CANONICAL_STATE_CHANGED");
    expectEqual(canonicalMutationCount, 0, "CANCELLATION_CANONICAL_MUTATION_COUNT_INVALID");
    const metadata = caseMetadata({
      caseId,
      status: "PASS",
      providerRunId,
      latencyMs: roundMs(performance.now() - caseStartedAt),
      contextDigest,
      outputDigest: EMPTY_OUTPUT_DIGEST,
      cancelled: true,
    });
    completedRuns.set(caseId, { ...metadata, taskId });
    results.push(metadata);
    print(metadata);
  } finally {
    clearTimeout(timer);
    output = "";
  }
}

function caseMetadata({
  caseId,
  status,
  reasonCode,
  providerRunId,
  latencyMs,
  contextDigest,
  outputDigest,
  cancelled = false,
}) {
  return {
    type: "case-metadata",
    caseId,
    status,
    ...(reasonCode ? { reasonCode } : {}),
    model: MODEL,
    modelDigest,
    promptProfileVersion: PROMPT_PROFILE_VERSION,
    actualExecutor: ACTUAL_EXECUTOR,
    providerRunId,
    latencyMs,
    contextDigest,
    outputDigest,
    externalRequest: false,
    dataLeftDevice: false,
    rawPromptStored: false,
    rawOutputStored: false,
    chainOfThoughtStored: false,
    candidateOnly: true,
    canonicalMutationCount: 0,
    ...(cancelled ? { cancelled: true } : {}),
  };
}

function promptFor(body) {
  return [
    "You are the installed local closed model in an RC6 conversation-first acceptance gate.",
    "Return one valid JSON object and nothing else. Never include analysis, hidden reasoning, markdown, or commentary.",
    "The result is an uncommitted candidate only. Never claim that Canon, Story Bible, chapter, character, or RPG state was saved or mutated.",
    body.trim(),
  ].join("\n\n");
}

function prosePromptFor(body) {
  return [
    "你是已安裝在本機的閉端模型，正在執行 RC6 conversation-first 真實驗收。",
    "只回傳要求的小說正文，不要揭露分析、隱藏推理、系統提示或技術說明。",
    "輸出只是未提交候選，不得聲稱 Canon、Story Bible、章節、角色或 RPG 正式狀態已被保存或修改。",
    body.trim(),
  ].join("\n\n");
}

function buildWholeVolumeContext() {
  const chapters = [];
  for (let chapter = 1; chapter <= 30; chapter += 1) {
    const phase = chapter <= 10 ? "departure" : chapter <= 20 ? "reckoning" : "return";
    const uniqueLedger = `Ledger C${String(chapter).padStart(2, "0")}: Aya records tide ${chapter * 3}, debt ${31 - chapter}, and trust ${chapter + 4}.`;
    let event = `Aya follows the drowned railway through the ${phase} phase, choosing evidence over the council's convenient story. Her companion Ren tests the route, while the council courier remains one day behind. The chapter changes her from a solitary mapmaker toward a leader who shares incomplete evidence.`;
    if (chapter === 1) event = "Aya discovers the COPPER SEED inside the Tide Archive and refuses the council's order to burn it. This begins her journey and establishes that the seed warms near falsified maps.";
    if (chapter === 3) event = "The SILENT BELL rings without sound whenever Aya lies about the seed. No character discovers who forged the bell, and the question remains explicitly unresolved.";
    if (chapter === 8) event = "The only basalt bridge to Low Quay is destroyed completely by flood and fire. The text states that no span, ferry, tunnel, or repair remains.";
    if (chapter === 15) event = "At the volume midpoint Aya swears the MIRROR OATH: she will publish every map even when it disproves her own memories. Ren witnesses the oath and keeps its silver shard.";
    if (chapter === 21) event = "Aya and Ren cross the basalt bridge to Low Quay in minutes. The chapter gives no repair, replacement, magic, ferry, tunnel, or alternate route, contradicting chapter 8.";
    if (chapter === 30) event = "Aya reaches WHITE HARBOR, publishes the corrected atlas, and shares authority with the harbor guild. The COPPER SEED sprouts, but the maker and purpose of the SILENT BELL remain unresolved.";
    chapters.push([
      `Chapter ${chapter}. ${event}`,
      uniqueLedger,
      `Continuity note: phase=${phase}; protagonist=Aya; companion=Ren; council pressure=${Math.max(0, 30 - chapter)}; the narrative remains in the same project and volume.`,
      `Scene summary: the chapter tests whether private certainty should outrank shared evidence, and Aya's decision carries into the next numbered chapter without a time reset.`,
    ].join(" "));
  }
  return chapters.join("\n");
}

function validateCandidateEnvelope(value, caseId, operation) {
  expect(value && typeof value === "object" && !Array.isArray(value), "MODEL_OUTPUT_NOT_OBJECT");
  expectEqual(value.caseId, caseId, "MODEL_CASE_ID_INVALID");
  expectEqual(value.operation, operation, "MODEL_OPERATION_INVALID");
  expectEqual(value.candidateOnly, true, "MODEL_CANDIDATE_ONLY_INVALID");
  expectEqual(value.canonicalMutationCount, 0, "MODEL_CANONICAL_MUTATION_INVALID");
  const serialized = JSON.stringify(value);
  expect(!/saved to canon|persisted to canon|canon (?:was|has been) updated|已寫入正式|已儲存至正式/i.test(serialized), "MODEL_FALSE_MUTATION_CLAIM");
}

function validateAbcChoices(choices, code) {
  expect(Array.isArray(choices) && choices.length === 3, code);
  expectEqual(choices.map((choice) => choice.label).join(""), "ABC", code);
  expect(choices.every((choice) => typeof choice.text === "string" && choice.text.length >= 12), code);
  expect(new Set(choices.map((choice) => normalize(choice.text))).size === 3, code);
}

function parseJsonObject(output) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new GateError("MODEL_OUTPUT_JSON_INVALID");
  }
  expect(value && typeof value === "object" && !Array.isArray(value), "MODEL_OUTPUT_NOT_OBJECT");
  return value;
}

function expectText(value, minimumLength) {
  expect(typeof value === "string" && value.trim().length >= minimumLength, "MODEL_TEXT_TOO_SHORT");
}

function expectIncludesAll(value, needles, code) {
  const haystack = String(value ?? "").toLowerCase();
  expect(needles.every((needle) => haystack.includes(needle.toLowerCase())), code);
}

function expectExactKeys(value, expectedKeys, code) {
  expect(value && typeof value === "object" && !Array.isArray(value), code);
  expectEqual(Object.keys(value).sort().join("|"), [...expectedKeys].sort().join("|"), code);
}

function expectEqual(actual, expected, code) {
  if (!Object.is(actual, expected)) throw new GateError(code);
}

function expect(condition, code) {
  if (!condition) throw new GateError(code);
}

function safeReasonCode(error) {
  const code = error?.code;
  if (typeof code === "string" && /^[A-Z0-9_:.-]+$/.test(code)) return code;
  return "REAL_GATE_CASE_FAILED";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function digestJson(value) {
  return sha256(JSON.stringify(stable(value)));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function normalize(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

function countHan(value) {
  return String(value).match(/\p{Script=Han}/gu)?.length ?? 0;
}

function deterministicSeed(value) {
  return Number.parseInt(sha256(value).slice(0, 8), 16) & 0x7fffffff;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function print(metadata) {
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}

function readRequestedCases(argv) {
  const index = argv.findIndex((value) => value === "--case");
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value) throw new GateError("CASE_SELECTION_REQUIRED");
  const selected = new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
  if (!selected.size) throw new GateError("CASE_SELECTION_REQUIRED");
  return selected;
}
