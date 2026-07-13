import crypto from "crypto";
import { requireAdmin } from "@/lib/novel-ai/admin";
import {
  cleanupStoryBibleProject,
  conflictFixtureSnapshot,
  persistStoryBibleExtraction,
  seedStoryBibleConflictFixtures,
  StoryBibleExtractionOutputSchema,
} from "@/lib/novel-ai/story-bible";

export const runtime = "nodejs";

function hashText(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function source(projectId: string, chapterId: string, extractionRunId: string, excerpt: string, sourceValid = true) {
  return {
    projectId,
    chapterId,
    paragraphIndex: 0,
    textStart: sourceValid ? 0 : 9999,
    textEnd: sourceValid ? excerpt.length : 9999 + excerpt.length,
    excerptHash: hashText(excerpt),
    extractionRunId,
    excerpt,
    evidenceType: "direct_statement" as const,
    sourceValid,
  };
}

function candidate(args: {
  entityType: "character" | "event" | "item" | "world_rule" | "foreshadowing" | "open_thread";
  entityId?: string;
  temporaryEntityId: string;
  fieldPath: string;
  proposedValue: unknown;
  evidence: string;
  trust?: "cloud-validated" | "cloud-repaired" | "cloud-reduced" | "local-rule" | "invalid";
  sourceValid?: boolean;
  reason: string;
}, projectId: string, chapterId: string, extractionRunId: string) {
  const ref = source(projectId, chapterId, extractionRunId, args.sourceValid === false ? "不存在於正文的摘錄" : args.evidence, args.sourceValid !== false);
  return {
    entityType: args.entityType,
    entityId: args.entityId,
    temporaryEntityId: args.temporaryEntityId,
    operation: "update" as const,
    fieldPath: args.fieldPath,
    previousValue: undefined,
    proposedValue: args.proposedValue,
    confidence: args.trust === "local-rule" ? 0.35 : 0.92,
    evidence: args.evidence,
    evidenceType: "direct_statement" as const,
    sourceRefs: [ref],
    reason: args.reason,
    conflictRisk: args.sourceValid === false ? "needs-review" as const : "low" as const,
    candidateTrust: args.trust || "cloud-validated" as const,
    sourceValid: args.sourceValid !== false,
  };
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId || `p0c2a-conflict-${Date.now()}`);
  const action = String(body.action || "run");
  if (action === "cleanup") {
    return Response.json(await cleanupStoryBibleProject(projectId));
  }

  const snapshot = await seedStoryBibleConflictFixtures(projectId);
  const chapterId = "p0c2a-conflict-chapter";
  const extractionRunId = `story_extract_${crypto.randomUUID()}`;
  const chapterText = [
    "林昭年齡被改成三十五歲。",
    "林昭被宣告死亡，但沒有死亡事件依據。",
    "林昭同一時間出現在邊境。",
    "赤霄劍被交給另一名角色。",
    "死者不可復生的規則被改成死者可以復生。",
    "赤霄劍真主伏筆被重新標記為 planted。",
    "這是一筆本地規則降級候選。",
    "這是一筆雲端修復候選。",
    "林昭仍為二十八歲。",
    "新的事件沒有與既有 canonical 衝突。",
  ].join("\n");
  const input = {
    projectId,
    chapterId,
    chapterNumber: 1,
    chapterTitle: "P0-C2A Conflict Fixture",
    chapterText,
    previousChapterSummary: "",
    currentCanonicalSnapshot: snapshot,
    extractionMode: "chapter-new" as const,
  };
  const candidateFacts = [
    candidate({ entityType: "event", temporaryEntityId: "evt_local_rule", fieldPath: "events[].title", proposedValue: "本地規則降級候選", evidence: "這是一筆本地規則降級候選。", trust: "local-rule", reason: "local-rule候選需人工確認。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "event", temporaryEntityId: "evt_cloud_repaired", fieldPath: "events[].title", proposedValue: "雲端修復候選", evidence: "這是一筆雲端修復候選。", trust: "cloud-repaired", reason: "cloud-repaired候選需顯示修復痕跡。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "event", temporaryEntityId: "evt_invalid_source", fieldPath: "events[].title", proposedValue: "無效來源候選", evidence: "source invalid", sourceValid: false, reason: "source excerpt不存在於chapterText。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "world_rule", entityId: "rule_test_001", temporaryEntityId: "rule_test_001", fieldPath: "worldRules[].description", proposedValue: "死者可以復生", evidence: "死者不可復生的規則被改成死者可以復生。", reason: "immutable world rule change。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "character", entityId: "char_test_001", temporaryEntityId: "char_test_001", fieldPath: "characters[].age", proposedValue: 35, evidence: "林昭年齡被改成三十五歲。", reason: "character age mismatch。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "character", entityId: "char_test_001", temporaryEntityId: "char_test_001", fieldPath: "characters[].lifeStatus", proposedValue: "dead", evidence: "林昭被宣告死亡，但沒有死亡事件依據。", reason: "lifeStatus mismatch。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "character", entityId: "char_test_001", temporaryEntityId: "char_test_001", fieldPath: "characters[].currentLocationId", proposedValue: "loc_border", evidence: "林昭同一時間出現在邊境。", reason: "timeline location conflict。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "item", entityId: "item_test_001", temporaryEntityId: "item_test_001", fieldPath: "items[].currentOwnerCharacterId", proposedValue: "char_test_002", evidence: "赤霄劍被交給另一名角色。", reason: "item double owner。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "foreshadowing", entityId: "fs_test_001", temporaryEntityId: "fs_test_001", fieldPath: "foreshadowing[].status", proposedValue: "planted", evidence: "赤霄劍真主伏筆被重新標記為 planted。", reason: "paid foreshadowing reopened。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "character", entityId: "char_test_001", temporaryEntityId: "char_test_001", fieldPath: "characters[].age", proposedValue: 28, evidence: "林昭仍為二十八歲。", reason: "canonical exact match。" }, projectId, chapterId, extractionRunId),
    candidate({ entityType: "event", temporaryEntityId: "evt_no_conflict", fieldPath: "events[].title", proposedValue: "新的事件", evidence: "新的事件沒有與既有 canonical 衝突。", reason: "cloud-validated無衝突候選。" }, projectId, chapterId, extractionRunId),
  ];
  const output = StoryBibleExtractionOutputSchema.parse({
    candidateFacts,
    candidateUpdates: [],
    candidateDeletions: [],
    candidateConflicts: [],
    chapterSummaryCandidate: {
      chapterId,
      chapterNumber: 1,
      title: "P0-C2A Conflict Fixture",
      summary: "P0-C2A conflict fixture.",
      characterChanges: [],
      worldChanges: [],
      newFacts: [],
      resolvedThreads: [],
      newThreads: [],
      plantedForeshadowing: [],
      paidForeshadowing: [],
      endingState: "fixture completed",
      sourceHash: hashText(chapterText),
    },
    extractionWarnings: [],
    confidence: 0.9,
  });
  const persisted = await persistStoryBibleExtraction({
    input,
    output,
    extractionRunId,
    traceId: crypto.randomUUID(),
    modelId: "p0c2a-fixture",
    fallbackLevel: "cloud-validated",
    elapsedMs: 0,
  });
  return Response.json({ projectId, extractionRunId, persisted });
}
