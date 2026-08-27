import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { ConversationRepositoryService } from "../lib/novel-ai/conversation/repository.ts";
import {
  STORY_WORKSPACE_FORBIDDEN_CANONICAL_TARGET_STORES,
  assertStoryWorkspaceConversationApprovalTarget,
} from "../lib/novel-ai/conversation/approval-transaction.ts";
import { planConversationRequest } from "../lib/novel-ai/conversation/planner.ts";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const forbiddenTargets = [
  "characters",
  "worldRules",
  "storyBibles",
  "relationships",
  "lore",
  "timeline",
  "worlds",
];

assert.deepEqual(
  [...STORY_WORKSPACE_FORBIDDEN_CANONICAL_TARGET_STORES],
  forbiddenTargets,
  "the fail-closed target set must cover every setting Canon named by the story-surface contract",
);

for (const targetStore of forbiddenTargets) {
  assert.throws(
    () => assertStoryWorkspaceConversationApprovalTarget(targetStore),
    (error) => error?.code === "CONVERSATION_STORY_CANON_MUTATION_FORBIDDEN",
    `${targetStore} must be rejected by the shared boundary`,
  );

  const repository = new MemoryNovelRepository();
  const conversation = new ConversationRepositoryService(repository);
  const forged = {
    operationId: `forged:${targetStore}`,
    idempotencyKey: `forged:${targetStore}`,
    projectId: "project:forged",
    sessionId: "session:forged",
    artifactId: "artifact:forged",
    sourceMessageId: "message:forged",
    candidateDigest: "0".repeat(64),
    targetStore,
    targetRecordId: "target:forged",
    expectedSessionRevision: 1,
    expectedArtifactRevision: 1,
    expectedSourceMessageRevision: 1,
    expectedSourceRevision: 1,
    applicationMode: "record_replace",
    nextCanonicalRecord: {},
  };
  await assert.rejects(
    conversation.approveArtifact(forged),
    (error) => error?.code === "CONVERSATION_STORY_CANON_MUTATION_FORBIDDEN",
    `${targetStore} must fail before backup or Canon writes`,
  );
  await assert.rejects(
    conversation.markArtifactApprovedFromExternalCommit({
      ...forged,
      resultingRevision: 2,
      canonicalRecordDigest: "1".repeat(64),
      commitId: `external:${targetStore}`,
    }),
    (error) => error?.code === "CONVERSATION_STORY_CANON_MUTATION_FORBIDDEN",
    `${targetStore} must not be smuggled through the external-commit marker`,
  );
  await assert.rejects(
    repository.approveConversationArtifactTransaction(forged),
    (error) => error?.code === "CONVERSATION_STORY_CANON_MUTATION_FORBIDDEN",
    `${targetStore} must also fail when bypassing the conversation service`,
  );
}

for (const request of [
  "請修改角色明檀的背景，讓她曾在北境修行。",
  "請修改世界規則，讓靈石不可逆流。",
]) {
  const plan = await planConversationRequest({ content: request });
  assert.equal(plan.executionKind, "closed_agent", request);
  assert.equal(plan.approvalRequired, false, request);
  assert.equal(plan.targetStore, null, request);
}

const routeFiles = [
  "app/studio/project/[projectId]/characters/page.tsx",
  "app/studio/project/[projectId]/world/page.tsx",
  "app/studio/project/[projectId]/timeline/page.tsx",
  "app/studio/project/[projectId]/story-bible/page.tsx",
  "app/studio/project/[projectId]/people-world/page.tsx",
  "app/studio/project/[projectId]/story-context/page.tsx",
];
for (const routeFile of routeFiles) {
  const routeSource = source(routeFile);
  assert.match(routeSource, /StoryStageSelectionPage/u, `${routeFile} must use the selection-only page`);
  assert.doesNotMatch(routeSource, /project-section-client/u, `${routeFile} must not mount Canon CRUD`);
}

const selectorSource = source("app/studio/project/[projectId]/story-stage-selector.tsx");
for (const field of [
  "activeCharacterIds",
  "activeWorldId",
  "activeWorldRuleIds",
  "activeLoreIds",
  "activeTimelineEventIds",
]) {
  assert.match(selectorSource, new RegExp(`"${field}"`, "u"), `selector must whitelist ${field}`);
}
assert.match(selectorSource, /repository\.put<StoryState>\("storyStates"/u);
assert.doesNotMatch(selectorSource, /repository\.(?:put|remove)[\s\S]{0,80}\("(?:characters|worlds|worldRules|storyBibles|relationships|lore|timeline)"/u);
assert.match(selectorSource, /data-canon-edit-surface="story-selection-only"/u);

const professionalSource = source("app/professional/professional-client.tsx");
assert.match(professionalSource, /mode="home-edit"/u);
assert.match(professionalSource, /professional-canon-editor-link/u);
assert.match(professionalSource, /character-world-memory-editor/u);
const frontdoorSource = source("app/frontdoor-client.tsx");
assert.match(frontdoorSource, /frontdoor-canon-editor/u);
assert.match(frontdoorSource, /character-world-memory-editor/u);
assert.match(frontdoorSource, /novel_p2_active_project_id/u);
assert.match(frontdoorSource, /item\.id === activeProjectId/u);
const homeWorkbenchSource = source("app/studio/project/[projectId]/character-relationship-workbench.tsx");
assert.match(homeWorkbenchSource, /data-testid="home-canon-editor"/u);
assert.match(homeWorkbenchSource, /setCharacterEditorsOpen\(true\)/u);
assert.match(homeWorkbenchSource, /setCanonEditorsOpen\(true\)/u);
assert.match(homeWorkbenchSource, /scrollIntoView/u);
for (const editReturnFile of [
  "app/studio/project/[projectId]/story-stage-selection-page.tsx",
  "app/studio/project/[projectId]/story-stage-selector.tsx",
]) {
  assert.match(source(editReturnFile), /#character-world-memory-editor/u, `${editReturnFile} must return to the editor, not the stage picker`);
}
for (const label of [
  "故事內選擇上場人物（唯讀）",
  "故事內選擇上場世界與規則（唯讀）",
  "故事內選擇上場記憶（唯讀）",
  "故事內選擇上場時間線（唯讀）",
]) {
  assert.match(professionalSource, new RegExp(label, "u"));
}

const projectNavigationSource = source("app/studio/project/[projectId]/project-navigation.tsx");
assert.match(projectNavigationSource, /人物與世界、故事脈絡只提供唯讀查詢與上場選擇/u);
assert.match(projectNavigationSource, /正式設定管理（可編修）/u);
assert.match(projectNavigationSource, /href=\{projectHome\}/u);

const chatViewSource = source("app/studio/project/[projectId]/chat/components/conversation-workspace-view.tsx");
assert.match(chatViewSource, /conversation-story-stage-selector/u);
assert.match(chatViewSource, /<StoryStageSelector/u);

const approvalHookSource = source("app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts");
assert.match(approvalHookSource, /isStoryWorkspaceForbiddenCanonicalTarget/u);
assert.doesNotMatch(approvalHookSource, /buildConversationCanonicalReplacement/u);
assert.doesNotMatch(approvalHookSource, /freshArtifact\.targetStore === "characters"/u);

const artifactDrawerSource = source("app/studio/project/[projectId]/chat/components/artifact-drawer.tsx");
assert.match(artifactDrawerSource, /story-canon-candidate-blocked/u);
assert.match(artifactDrawerSource, /!canonMutationForbidden/u);

console.log(`PASS story selection boundary: ${forbiddenTargets.length} forbidden targets, ${routeFiles.length} selection-only routes, 5 StoryState fields.`);
