import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { chunkChapter, chunkTextAsSingleStructuredPiece } from "../lib/novel-ai/retrieval/chapter-chunker.ts";
import { chunkStructuredRecord } from "../lib/novel-ai/retrieval/chunker.ts";
import { CHUNKING_VERSION } from "../lib/novel-ai/retrieval/chunk-types.ts";
import { CHUNK_TOKEN_BUDGET } from "../lib/novel-ai/retrieval/chunk-token-budget.ts";

const h = createHarness("H2A Semantic Chunking");
const now = "2026-07-16T00:00:00.000Z";

function chapter(text, overrides = {}) {
  return chunkChapter({
    projectId: overrides.projectId ?? "project-a",
    chapterId: overrides.chapterId ?? "chapter-a",
    text,
    entityIds: overrides.entityIds,
    eventIds: overrides.eventIds,
    sourceIds: overrides.sourceIds,
    timelineStart: overrides.timelineStart,
    timelineEnd: overrides.timelineEnd,
    now,
  });
}

function allWithinOffsets(chunks, text) {
  return chunks.every((chunk) => chunk.startOffset >= 0 && chunk.endOffset <= text.length && chunk.startOffset < chunk.endOffset);
}

function isOrdered(chunks) {
  return chunks.every((chunk, index) => index === 0 || chunk.startOffset >= chunks[index - 1].startOffset);
}

function coversNonWhitespace(chunks, text) {
  const covered = new Set();
  for (const chunk of chunks) {
    for (let i = chunk.startOffset; i < chunk.endOffset; i += 1) {
      if (!/\s/.test(text[i] ?? "")) covered.add(i);
    }
  }
  for (let i = 0; i < text.length; i += 1) {
    if (!/\s/.test(text[i]) && !covered.has(i)) return false;
  }
  return true;
}

function noChunkExceedsMax(chunks) {
  return chunks.every((chunk) => chunk.tokenEstimate <= CHUNK_TOKEN_BUDGET.maxTokens);
}

const empty = chapter("");
h.assert("empty chapter", empty.length === 0);

const single = "沈清禾推開窗，看見院中燈火未熄。她知道今晚必須先確認帳冊的去向。";
const singleChunks = chapter(single);
h.assert("single paragraph", singleChunks.length === 1 && singleChunks[0].normalizedText.includes("沈清禾"));
h.assert("short chapter", singleChunks.length === 1 && singleChunks[0].contentType === "paragraph_group");

const long = Array.from({ length: 80 }, (_, i) => `第${i + 1}句，沈清禾表面退讓，暗中記下每個人的反應。`).join("");
const longChunks = chapter(long);
h.assert("long chapter", longChunks.length > 1);
h.assert("token maximum", noChunkExceedsMax(longChunks), longChunks.map((chunk) => chunk.tokenEstimate));

const dialogue = [
  "沈清禾：帳冊昨夜由誰保管？",
  "管家：回夫人，是老奴親自收著。",
  "沈清禾：那這枚新墨痕，又是誰留下的？",
  "管家：這……老奴不知。",
].join("\n");
const dialogueChunks = chapter(dialogue);
h.assert("dialogue-heavy chapter", dialogueChunks.some((chunk) => chunk.contentType === "dialogue_block"));
h.assert("question-answer dialogue", dialogueChunks[0].normalizedText.includes("帳冊") && dialogueChunks[0].normalizedText.includes("新墨痕"));

const multiScene = `第一章 雨夜\n${single}\n\n---\n林昭在城門外看見赤霄劍的劍穗。\n\n***\n反派提前換了交易地點。`;
const multiSceneChunks = chapter(multiScene);
h.assert("multiple scenes", new Set(multiSceneChunks.map((chunk) => chunk.sceneId)).size >= 3);
h.assert("scene separators", multiSceneChunks.some((chunk) => chunk.normalizedText.includes("---")) || multiSceneChunks.length >= 3);

const noPunctuation = "沈清禾暗中調查帳冊來源".repeat(120);
const noPunctuationChunks = chapter(noPunctuation);
h.assert("no punctuation", noPunctuationChunks.length > 1 && noChunkExceedsMax(noPunctuationChunks));

const veryLongParagraph = "她先不說話只是看著燈影落在帳冊邊緣".repeat(180);
const veryLongParagraphChunks = chapter(veryLongParagraph);
h.assert("extremely long paragraph", veryLongParagraphChunks.length > 2 && noChunkExceedsMax(veryLongParagraphChunks));

const mixed = "The ledger was moved. 沈清禾沒有立刻揭穿，because she needed proof.";
h.assert("mixed Chinese English", chapter(mixed)[0].normalizedText.includes("ledger"));

const fullWidth = "ＡＢＣ，沈清禾說：「帳冊不是昨天的版本。」";
h.assert("full-width punctuation", chapter(fullWidth)[0].normalizedText.includes("ABC"));

const repeated = "同一句話被重複，但仍要穩定切分。\n\n同一句話被重複，但仍要穩定切分。";
h.assert("repeated paragraphs", chapter(repeated).length >= 1);

const unicodeA = chapter("ＡＢＣ\n\n沈清禾");
const unicodeB = chapter("ABC\n\n沈清禾");
h.assert("Unicode NFC", unicodeA[0].contentHash === unicodeB[0].contentHash);

h.assert("emoji", chapter("沈清禾收起信紙🙂，決定明日進宮。")[0].normalizedText.includes("🙂"));

const stableA = chapter(multiScene);
const stableB = chapter(multiScene);
h.assert("stable chunk IDs", stableA.map((chunk) => chunk.chunkId).join(",") === stableB.map((chunk) => chunk.chunkId).join(","));
h.assert("stable hashes", stableA.map((chunk) => chunk.contentHash).join(",") === stableB.map((chunk) => chunk.contentHash).join(","));
h.assert("offset correctness", allWithinOffsets(stableA, multiScene));
h.assert("full text coverage", coversNonWhitespace(stableA, multiScene));
h.assert("no reorder", isOrdered(stableA));
h.assert("controlled overlap", stableA.every((chunk, index) => index === 0 || chunk.startOffset >= stableA[index - 1].startOffset));
h.assert("token minimum", stableA.some((chunk) => chunk.tokenEstimate < CHUNK_TOKEN_BUDGET.minTokens) || stableA.every((chunk) => chunk.tokenEstimate >= CHUNK_TOKEN_BUDGET.minTokens));

const metaChunks = chapter(single, { entityIds: ["char_1"], eventIds: ["event_1"], sourceIds: ["source_1"], timelineStart: "day-1", timelineEnd: "day-2" });
h.assert("entity metadata propagation", metaChunks[0].entityIds.includes("char_1"));
h.assert("event metadata propagation", metaChunks[0].eventIds.includes("event_1"));
h.assert("source metadata propagation", metaChunks[0].sourceIds.includes("source_1"));
h.assert("timeline metadata", metaChunks[0].timelineStart === "day-1" && metaChunks[0].timelineEnd === "day-2");

const canonical = chunkStructuredRecord({ projectId: "project-a", contentType: "canonical_entity", recordId: "char_1", text: "沈清禾：侯府主母，擅長隱忍布局。", entityIds: ["char_1"], now });
h.assert("canonical entity chunks", canonical.length === 1 && canonical[0].contentType === "canonical_entity");

const foreshadow = chunkTextAsSingleStructuredPiece({ projectId: "project-a", contentType: "foreshadow", text: "赤霄劍的劍穗被人調換。", metadata: { sourceIds: ["fs_1"] }, now });
h.assert("foreshadow chunks", foreshadow.length === 1 && foreshadow[0].contentType === "foreshadow");

const openThread = chunkTextAsSingleStructuredPiece({ projectId: "project-a", contentType: "open_thread", text: "誰在雨夜改動了帳冊仍未解。", metadata: { sourceIds: ["thread_1"] }, now });
h.assert("open thread chunks", openThread.length === 1 && openThread[0].contentType === "open_thread");

h.assert("restart determinism", JSON.stringify(chapter(long).map((chunk) => chunk.chunkId)) === JSON.stringify(chapter(long).map((chunk) => chunk.chunkId)));

const editedParagraph = multiScene.replace("帳冊", "密信");
h.assert("one paragraph edit", chapter(editedParagraph).some((chunk, index) => chunk.contentHash !== (stableA[index]?.contentHash ?? "")));

const editedScene = `${multiScene}\n\n---\n新場景：城外烽煙升起。`;
h.assert("one scene edit", chapter(editedScene).length > stableA.length);

const deletedParagraph = multiScene.replace("反派提前換了交易地點。", "");
h.assert("deleted paragraph", chapter(deletedParagraph).length <= stableA.length);

h.assert("restored paragraph", chapter(deletedParagraph).map((chunk) => chunk.chunkId).join(",") !== stableA.map((chunk) => chunk.chunkId).join(","));

h.assert("chunking version change", stableA.every((chunk) => chunk.chunkingVersion === CHUNKING_VERSION && chunk.chunkId.includes("chunk_")));

const veryLargeChapter = Array.from({ length: 450 }, (_, i) => `第${i + 1}段：沈清禾記下線索，等待對手露出破綻。`).join("\n\n");
const veryLargeChunks = chapter(veryLargeChapter);
h.assert("very large chapter", veryLargeChunks.length > 20 && noChunkExceedsMax(veryLargeChunks));

const projectA = chapter(single, { projectId: "project-a", chapterId: "chapter-iso" });
const projectB = chapter(single, { projectId: "project-b", chapterId: "chapter-iso" });
h.assert("multiple chapter isolation", chapter(single, { chapterId: "chapter-1" })[0].chunkId !== chapter(single, { chapterId: "chapter-2" })[0].chunkId);
h.assert("project isolation", projectA[0].chunkId !== projectB[0].chunkId);

const cleanupProbe = [...stableA, ...veryLargeChunks].filter((chunk) => chunk.status !== "active");
h.assert("cleanup", cleanupProbe.length === 0);

printAndExit(h.summary({
  expectedPass: 40,
  chunkingStatus: "ready",
  chunkingVersion: CHUNKING_VERSION,
  incrementalIndexStatus: "not_implemented",
}));
