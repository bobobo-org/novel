import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  conversationSource,
  composerSource,
  approvalCardSource,
  approvalSource,
  externalHelperSource,
  repositorySource,
  approvalTransactionSource,
  clientSource,
  routeSource,
  providersRouteSource,
  contractSource,
] = await Promise.all([
  readFile("app/studio/project/[projectId]/chat/conversation-workspace.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/message-composer.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/approval-card.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/external-ai.ts", "utf8"),
  readFile("lib/novel-ai/conversation/repository.ts", "utf8"),
  readFile("lib/novel-ai/conversation/approval-transaction.ts", "utf8"),
  readFile("lib/novel-ai/providers/external/external-provider-client.ts", "utf8"),
  readFile("app/api/ai/external/generate/route.ts", "utf8"),
  readFile("app/api/ai/external/providers/route.ts", "utf8"),
  readFile("lib/novel-ai/providers/external/external-provider-contract.ts", "utf8"),
]);

const externalRunStart = conversationSource.indexOf("  async function runExternalAgent(");
const externalRunEnd = conversationSource.indexOf("\n  async function sendRequest(", externalRunStart);
assert.ok(externalRunStart >= 0 && externalRunEnd > externalRunStart, "external chat run must be present");
const externalRunSource = conversationSource.slice(externalRunStart, externalRunEnd);

// Shared endpoint remains guarded, streamed and candidate-only.
assert.match(clientSource, /fetch\("\/api\/ai\/external\/generate"/u);
assert.match(clientSource, /isExternalAIGenerationResult\(payload\)/u);
assert.match(routeSource, /assertExternalAIRequestOrigin\(request\)/u);
assert.match(routeSource, /readExternalAIJsonBody\(request\)/u);
assert.match(routeSource, /reserveExternalAIRequest\(/u);
assert.match(routeSource, /streamExternalAICandidate\(streamingRequest/u);
assert.match(routeSource, /signal:\s*providerAbort\.signal/u);
assert.match(contractSource, /candidateOnly:\s*true/u);
assert.match(contractSource, /serverStoredByApplication:\s*false/u);
assert.match(contractSource, /dataLeavesDevice:\s*true/u);

// Current chat defaults to closed AI and reads only the public provider/status
// snapshot. Public execution can be disabled independently from configuration.
assert.match(conversationSource, /useState<NovelAIExecutionMode>\("closed-only"\)/u);
assert.match(conversationSource, /fetch\("\/api\/ai\/external\/providers"/u);
assert.match(conversationSource, /setExternalExecutionEnabled\(snapshot\.executionEnabled === true\)/u);
assert.match(conversationSource, /window\.addEventListener\("focus", refresh\)/u);
assert.match(conversationSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/u);
assert.match(providersRouteSource, /executionEnabled/u);
assert.match(composerSource, /閉端 AI（預設）/u);
assert.match(composerSource, /公開外來 AI 執行尚未開放/u);

// External execution requires an explicit mode, selected configured provider,
// current-run consent, and a plain composer message. Attachments and specialized
// local workflows fail closed before generation starts.
assert.match(composerSource, /conversation-ai-source-controls/u);
assert.match(composerSource, /externalRunConsent/u);
assert.match(composerSource, /不自動包含正式章節、角色、世界、歷史對話或附件/u);
assert.match(conversationSource, /CONVERSATION_EXTERNAL_ATTACHMENTS_FORBIDDEN/u);
assert.match(conversationSource, /CONVERSATION_EXTERNAL_SPECIALIZED_FLOW_FORBIDDEN/u);
assert.match(conversationSource, /CONVERSATION_EXTERNAL_PROVIDER_NOT_CONFIGURED/u);
assert.match(conversationSource, /CONVERSATION_EXTERNAL_SINGLE_RUN_CONSENT_REQUIRED/u);
assert.match(conversationSource, /setExternalRunConsent\(false\);[\s\S]{0,500}runExternalAgent/u);

// The prompt contains only the exact current user message plus local task type;
// no chapter, character/world state, history, or attachment summaries are sent.
assert.match(externalHelperSource, /作者本次明確送出的文字/u);
assert.match(conversationSource, /objective:\s*input\.userMessage\.content/u);
assert.doesNotMatch(externalHelperSource, /currentChapter|characters|worlds|recentMessage|attachment/iu);
assert.match(conversationSource, /generateExternalAIStream\(\{/u);
assert.match(conversationSource, /externalConsent:\s*true/u);
assert.match(conversationSource, /onDelta:\s*\(delta, generatedTokenEvents\)/u);
assert.match(conversationSource, /streamedText \+= delta/u);
assert.match(conversationSource, /projectMessageIntoActiveSession\(input\.sessionId, visibleMessage\)/u);

// Every external result is persisted as a candidate artifact and completed
// external invocation/receipt with zero Canon mutations. Failure never falls
// through to closed or deterministic generation.
assert.match(conversationSource, /toolId:\s*CONVERSATION_EXTERNAL_AI_TOOL_ID/u);
assert.match(conversationSource, /actualExecutor:\s*`external-api:\$\{input\.providerId\}`/u);
assert.match(conversationSource, /artifact\s*=\s*await conversation\.saveArtifact\(/u);
assert.match(conversationSource, /const outputDigest = artifact\.candidateDigest/u);
assert.match(conversationSource, /providerRunId:\s*result\.requestId/u);
assert.match(conversationSource, /externalRequest:\s*true/u);
assert.match(conversationSource, /dataLeftDevice:\s*true/u);
assert.match(conversationSource, /canonicalMutationCount:\s*0/u);
assert.match(conversationSource, /沒有完成；未改用閉端 AI、其他供應商或規則後備/u);
assert.match(externalRunSource, /assertExternalRunActive\(\);[\s\S]{0,240}conversation\.saveArtifact\(/u);
const artifactCommitAt = externalRunSource.indexOf("artifact = await conversation.saveArtifact(");
const messageCommitAt = externalRunSource.indexOf(
  "const message = await conversation.updateMessageStatus(",
  artifactCommitAt,
);
const receiptCommitAt = externalRunSource.indexOf(
  "invocation = await conversation.updateToolInvocationStatus(",
  messageCommitAt,
);
const successReturnAt = externalRunSource.indexOf("return { result, artifact, invocation, message };", receiptCommitAt);
assert.ok(
  artifactCommitAt >= 0
  && messageCommitAt > artifactCommitAt
  && receiptCommitAt > messageCommitAt
  && successReturnAt > receiptCommitAt,
  "external finalization must persist artifact/message lineage before the completed receipt",
);
assert.match(
  externalRunSource.slice(receiptCommitAt, successReturnAt),
  /status:\s*"completed"[\s\S]*executionReceipt:/u,
);
assert.doesNotMatch(
  externalRunSource.slice(messageCommitAt, successReturnAt),
  /assertExternalRunActive\(\)|input\.signal\.aborted/u,
  "the final persistence sequence must not reinterpret a late abort as cancellation",
);
assert.match(externalRunSource, /This is the final cancellation boundary/u);
assert.match(conversationSource, /currentArtifact\?\.status === "candidate"[\s\S]{0,300}conversation\.rejectArtifact\(/u);
assert.match(repositorySource, /actualExecutor\.startsWith\("external-api:"\)/u);
assert.match(approvalTransactionSource, /invocation\.actualExecutor\.startsWith\("external-api:"\)/u);

// Approval re-checks the exact message/artifact/invocation receipt binding.
// Advice candidates remain reference-only with no misleading approve action;
// chapter candidates continue through the existing atomic approval transaction.
assert.match(externalHelperSource, /assertConversationExternalCandidateLineage/u);
assert.match(externalHelperSource, /receipt\.outputDigest !== input\.artifact\.candidateDigest/u);
assert.match(approvalSource, /assertConversationExternalCandidateLineage\(\{/u);
assert.match(approvalSource, /freshArtifact\.targetStore === "none"[\s\S]{0,300}CONVERSATION_NON_CANONICAL_CANDIDATE_REFERENCE_ONLY/u);
assert.match(approvalCardSource, /artifact\.targetStore === "none"/u);
assert.match(approvalCardSource, /conversation-reference-candidate-actions/u);
assert.match(approvalCardSource, /已保存為參考候選，不寫入 Canon/u);
const referenceCandidateBranch = approvalCardSource.match(
  /if \(artifact\.targetStore === "none"\) \{([\s\S]*?)\n  \}/u,
)?.[1] ?? "";
assert.ok(referenceCandidateBranch, "reference-only candidate branch must exist");
assert.doesNotMatch(referenceCandidateBranch, /onApprove|conversation-approve-candidate/u);
assert.match(approvalSource, /freshArtifact\.targetStore === "chapters"/u);
assert.match(approvalSource, /conversation\.approveChapterArtifact\(/u);

console.log(JSON.stringify({
  status: "PASS",
  sharedExternalEndpointImplemented: true,
  serverSideGuardsPresent: true,
  currentConversationExternalWired: true,
  closedDefault: true,
  explicitProviderAndSingleUseConsent: true,
  publicExecutionKillSwitchRespected: true,
  automaticPrivateContextExcluded: true,
  attachmentsFailClosed: true,
  noSilentFallback: true,
  candidateReceiptPersisted: true,
  completedReceiptIsFinalCommitPoint: true,
  lateAbortCannotRejectCompletedCandidate: true,
  approvalLineageVerified: true,
  preApprovalCanonicalMutationCount: 0,
}, null, 2));
