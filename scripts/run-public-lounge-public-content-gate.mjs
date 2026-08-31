import assert from "node:assert/strict";
import {
  evaluatePublicLoungePublicContentGate,
  PUBLIC_LOUNGE_MINIMUM_LONG_FORM_CHARACTERS,
  PUBLIC_LOUNGE_MINIMUM_PUBLIC_CHAPTER_CHARACTERS,
  PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHARACTERS,
} from "../lib/novel-ai/public-lounge/public-content-hard-gate.ts";

const longBody = (label, length = PUBLIC_LOUNGE_MINIMUM_PUBLIC_CHAPTER_CHARACTERS) => {
  const seed = `${label}人物做出選擇並承擔可驗證的後果。`.replace(/\s/gu, "");
  return seed.repeat(length).slice(0, length);
};
const chapter = (chapterNumber, body = longBody(`第 ${chapterNumber} 章`)) => ({
  chapterNumber,
  title: `第 ${chapterNumber} 章`,
  body,
  official: true,
});

assert.deepEqual(evaluatePublicLoungePublicContentGate({
  chapterCount: 8,
  wordCount: PUBLIC_LOUNGE_MINIMUM_LONG_FORM_CHARACTERS,
  publicChapters: [chapter(1), chapter(2)],
  fullSynopsis: "一部有起點、轉折與結局的完整小說。",
}), { passed: true, reasons: [] });

assert.deepEqual(evaluatePublicLoungePublicContentGate({
  chapterCount: 1,
  wordCount: 799,
  publicChapters: [],
  fullSynopsis: "短稿。",
}).reasons, ["public_chapter_missing", "work_too_short"]);

{
  const bodies = [longBody("甲", 500), longBody("乙", 500), longBody("丙", 500)];
  assert.equal(bodies.reduce((total, body) => total + body.replace(/\s/gu, "").length, 0), PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHARACTERS);
  assert.deepEqual(evaluatePublicLoungePublicContentGate({
    chapterCount: 3,
    wordCount: PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHARACTERS,
    publicChapters: bodies.map((body, index) => chapter(index + 1, body)),
    fullSynopsis: "三章完結短篇，每章均有實際正文。",
  }), { passed: true, reasons: [] });
}

assert.deepEqual(evaluatePublicLoungePublicContentGate({
  chapterCount: 3,
  wordCount: 1,
  publicChapters: [chapter(1, "一")],
  fullSynopsis: "以三章名義提交一個字。",
}).reasons, ["public_chapter_too_short", "work_too_short"]);

assert.deepEqual(evaluatePublicLoungePublicContentGate({
  chapterCount: 3,
  wordCount: 3,
  publicChapters: [chapter(1, "甲"), chapter(2, "乙"), chapter(3, "丙")],
  fullSynopsis: "三章各只有一個字。",
}).reasons, ["public_chapter_too_short", "work_too_short"]);

{
  const bodies = [longBody("甲", 500), longBody("乙", 500), longBody("丙", 499)];
  assert.deepEqual(evaluatePublicLoungePublicContentGate({
    chapterCount: 3,
    wordCount: PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHARACTERS - 1,
    publicChapters: bodies.map((body, index) => chapter(index + 1, body)),
    fullSynopsis: "正文停在完整短篇最低門檻前一字。",
  }).reasons, ["work_too_short"]);
}

assert.deepEqual(evaluatePublicLoungePublicContentGate({
  chapterCount: 3,
  wordCount: 9_000,
  publicChapters: [chapter(1, "一")],
  fullSynopsis: "虛報長篇字數。",
}).reasons, ["public_chapter_too_short"]);

assert.deepEqual(evaluatePublicLoungePublicContentGate({
  chapterCount: 3,
  wordCount: PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHARACTERS + 1,
  publicChapters: [chapter(1, longBody("甲", 500)), chapter(2, longBody("乙", 500)), chapter(3, longBody("丙", 500))],
  fullSynopsis: "短篇申報字數與實際公開全文不符。",
}).reasons, ["public_word_count_mismatch", "work_too_short"]);

assert.deepEqual(evaluatePublicLoungePublicContentGate({
  chapterCount: 2,
  wordCount: 200,
  publicChapters: [chapter(1), chapter(2), chapter(3)],
  fullSynopsis: "公開章數超出全書章數。",
}).reasons, ["public_chapter_count_mismatch", "work_too_short"]);

assert.deepEqual(evaluatePublicLoungePublicContentGate({
  chapterCount: 4,
  wordCount: 12_000,
  publicChapters: [chapter(1, longBody("同一段正文")), chapter(2, longBody("同一段正文"))],
  fullSynopsis: "完整大綱。",
}).reasons, ["public_chapter_duplicate"]);

for (const [text, expected] of [
  [longBody("hidden_draft: do not publish ", 160), "hidden_draft_residue"],
  [longBody("model_receipt=secret ", 160), "private_payload_residue"],
  [longBody("system prompt: { hidden: true } ", 160), "private_payload_residue"],
  [longBody("Story Bible: [private canon] ", 160), "private_payload_residue"],
  [longBody("model digest: abcdef0123456789 ", 160), "private_payload_residue"],
  [longBody("Canon: {private rules} ", 160), "private_payload_residue"],
  [longBody("NEXT TURN：請選擇 A/B/C ", 160), "interactive_fragment_residue"],
]) {
  const result = evaluatePublicLoungePublicContentGate({
    chapterCount: 3,
    wordCount: 9_000,
    publicChapters: [chapter(1, text)],
    fullSynopsis: "完整大綱。",
  });
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes(expected));
}


for (const prose of [
  longBody("她拿起 Canon 相機，拍下雨後街景。"),
  longBody("這本小說對 canon 傳統提出質疑。"),
  longBody("Story Bible 是她書架上一部虛構作品的英文書名。"),
]) {
  assert.equal(evaluatePublicLoungePublicContentGate({
    chapterCount: 3,
    wordCount: 9_000,
    publicChapters: [chapter(1, prose)],
    fullSynopsis: "完整大綱。",
  }).passed, true);
}

console.log(JSON.stringify({ ok: true, gate: "public-lounge-public-content-v1" }, null, 2));
