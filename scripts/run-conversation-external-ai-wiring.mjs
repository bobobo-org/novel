import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  conversationSource,
  externalRunnerSource,
  externalControllerSource,
  composerSource,
  composerHookSource,
  composerViewSource,
  approvalCardSource,
  approvalSource,
  externalHelperSource,
  repositorySource,
  approvalTransactionSource,
  clientSource,
  routeSource,
  providersRouteSource,
  contractSource,
  rpgControllerSource,
  rpgSourceGateSource,
  rpgExternalCascadeSource,
  rpgExternalReceiptSource,
  rpgLogicalTurnSource,
  conversationCssSource,
] = await Promise.all([
  readFile("app/studio/project/[projectId]/chat/conversation-workspace.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/conversation-external-agent.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-external-ai.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/message-composer.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-composer.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/conversation-workspace-view.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/approval-card.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/external-ai.ts", "utf8"),
  readFile("lib/novel-ai/conversation/repository.ts", "utf8"),
  readFile("lib/novel-ai/conversation/approval-transaction.ts", "utf8"),
  readFile("lib/novel-ai/providers/external/external-provider-client.ts", "utf8"),
  readFile("app/api/ai/external/generate/route.ts", "utf8"),
  readFile("app/api/ai/external/providers/route.ts", "utf8"),
  readFile("lib/novel-ai/providers/external/external-provider-contract.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/rpg-execution-source-gate.ts", "utf8"),
  readFile("lib/novel-ai/web/rpg-external-cascade.ts", "utf8"),
  readFile("lib/novel-ai/web/rpg-external-receipt.ts", "utf8"),
  readFile("lib/novel-ai/conversation/rpg-logical-turn.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/conversation.module.css", "utf8"),
]);
const externalProviderStatusRequestSource = await readFile(
  "app/studio/project/[projectId]/chat/external-provider-status-request.ts",
  "utf8",
);

const externalRunSource = externalRunnerSource;
assert.match(conversationSource, /runConversationExternalAgent\(\{/u);

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
assert.match(externalControllerSource, /useState<NovelAIExecutionMode>\("closed-only"\)/u);
assert.match(externalControllerSource, /requestConversationExternalProviderSnapshot\(\)/u);
assert.match(externalProviderStatusRequestSource, /fetchImpl\("\/api\/ai\/external\/providers"/u);
assert.match(externalProviderStatusRequestSource, /EXTERNAL_PROVIDER_STATUS_TIMEOUT_MS = 10_000/u);
assert.match(externalProviderStatusRequestSource, /controller\.abort\("EXTERNAL_PROVIDER_STATUS_TIMEOUT"\)/u);
assert.match(externalProviderStatusRequestSource, /Promise\.race\(\[remote, timeout\]\)\.finally/u);
assert.match(externalControllerSource, /setExternalExecutionEnabled\(snapshot\.executionEnabled === true\)/u);
assert.match(externalControllerSource, /window\.addEventListener\("focus", refresh\)/u);
assert.match(externalControllerSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/u);
assert.match(providersRouteSource, /executionEnabled/u);
assert.match(composerSource, /閉端 AI（預設）/u);
assert.match(composerSource, /公開外來 AI 執行尚未開放/u);

// External execution requires an explicit mode, selected configured provider,
// current-run consent, and a plain composer message. Attachments and specialized
// local workflows fail closed before generation starts.
assert.match(composerSource, /conversation-ai-source-controls/u);
assert.match(composerSource, /externalRunConsent/u);
assert.match(composerSource, /最近章節尾 3,600 字/u);
assert.match(composerSource, /privateSecrets、隱藏動機與完整作品永不外送/u);
assert.match(externalControllerSource, /ConversationExternalRunConsentIntent/u);
assert.match(externalControllerSource, /intentId:\s*`conversation-external-consent:\$\{crypto\.randomUUID\(\)\}`/u);
assert.match(externalControllerSource, /consumeExternalRunConsentIntent/u);
assert.match(composerSource, /<details[\s\S]{0,300}conversation-ai-source-controls/u);
assert.match(composerSource, /<summary[\s\S]{0,160}className=\{styles\.aiSourceSummary\}/u);
assert.match(composerSource, /重新設定/u);
assert.match(composerSource, /const \[sourceControlsOpen, setSourceControlsOpen\] = useState\(false\)/u);
assert.match(composerSource, /const sourceControlsRef = useRef<HTMLDetailsElement>\(null\)/u);
assert.match(
  composerSource,
  /<details[\s\S]{0,300}ref=\{sourceControlsRef\}[\s\S]{0,500}onToggle=\{\(event\) => setSourceControlsOpen\(event\.currentTarget\.open\)\}/u,
);
assert.doesNotMatch(composerSource, /open=\{sourceControlsOpen\}/u);
assert.match(
  composerSource,
  /<summary[\s\S]{0,500}onClick=\{\(event\) => \{[\s\S]{0,500}event\.preventDefault\(\);[\s\S]{0,300}details\.open = !details\.open;[\s\S]{0,200}setSourceControlsOpen\(details\.open\)/u,
);
assert.match(composerSource, /sourceControlsRef\.current\.open = false;[\s\S]{0,100}setSourceControlsOpen\(false\)/u);
assert.match(
  composerSource,
  /const submitRequest = \(\) => \{[\s\S]{0,300}onSend\(collapseSourceControls\);\s*\}/u,
);
assert.match(composerSource, /onSend:\s*submitRequest/u);
assert.doesNotMatch(
  composerSource,
  /onAiExecutionModeChange\(event\.target\.value as NovelAIExecutionMode\);\s*collapseSourceControls\(\)/u,
);
assert.doesNotMatch(
  composerSource,
  /onHybridAiSourceChange\(event\.target\.value as "closed" \| "external"\);\s*collapseSourceControls\(\)/u,
);
assert.doesNotMatch(
  composerSource,
  /onExternalProviderChange\(event\.target\.value as ExternalAIProviderId\);\s*collapseSourceControls\(\)/u,
);
assert.doesNotMatch(
  composerSource,
  /onExternalRunConsentChange\(event\.target\.checked\);\s*(?:if \(event\.target\.checked\) )?collapseSourceControls\(\)/u,
);
assert.match(
  composerHookSource,
  /const canSend = active && !busy && !blocked && Boolean\(draft\.trim\(\) \|\| attachmentCount\)/u,
);
assert.match(
  composerViewSource,
  /onSend=\{\(onAccepted\) => \{ void props\.sendRequest\(undefined, onAccepted\); \}\}/u,
);
assert.match(
  composerViewSource,
  /key=\{`conversation-message-composer:\$\{props\.sourceControlsCollapseSignal\}`\}/u,
);
assert.match(conversationSource, /onAccepted\?\.\(\)/u);
assert.match(
  conversationSource,
  /const \[sourceControlsCollapseSignal, setSourceControlsCollapseSignal\] = useState\(0\)/u,
);
assert.match(
  conversationSource,
  /onRpgGenerationStarted:\s*collapseSourceControlsAfterRpgStart/u,
);
assert.match(
  conversationCssSource,
  /\.aiSourceSummary\s*\{[\s\S]{0,180}min-height:\s*44px/u,
);
assert.match(
  conversationCssSource,
  /\.aiSourceBody\s*\{[\s\S]{0,240}max-height:\s*min\(44dvh, 360px\)[\s\S]{0,240}overflow-y:\s*auto/u,
);
assert.match(conversationSource, /CONVERSATION_EXTERNAL_ATTACHMENTS_FORBIDDEN/u);
assert.match(conversationSource, /CONVERSATION_EXTERNAL_SPECIALIZED_FLOW_FORBIDDEN/u);
assert.match(conversationSource, /CONVERSATION_EXTERNAL_PROVIDER_NOT_CONFIGURED/u);
assert.match(conversationSource, /CONVERSATION_EXTERNAL_SINGLE_RUN_CONSENT_REQUIRED/u);
assert.match(conversationSource, /clearExternalRunConsent\(\);[\s\S]{0,500}runConversationExternalAgent/u);

// Source selection is a repair surface, so selecting a mode/provider/consent
// never closes it. Preflight failures occur before a user message is accepted;
// only a persisted ordinary message invokes the one-shot collapse callback.
const ordinarySendSource = conversationSource.slice(
  conversationSource.indexOf("async function sendRequest("),
  conversationSource.indexOf("useEffect(() => {", conversationSource.indexOf("async function sendRequest(")),
);
const providerPreflightAt = ordinarySendSource.indexOf(
  "if (externalProviderStatusError || !externalProviderConfigured)",
);
const consentPreflightAt = ordinarySendSource.indexOf(
  "if (!externalRunConsent || !externalExecutionModeForRequest)",
);
const acceptedUserMessageAt = ordinarySendSource.indexOf(
  "let userMessage = existingUserMessage ?? existingRpgUser ?? await conversation.appendMessage({",
);
const acceptedCallbackAt = ordinarySendSource.indexOf("onAccepted?.();", acceptedUserMessageAt);
assert.ok(providerPreflightAt >= 0 && consentPreflightAt > providerPreflightAt);
assert.ok(consentPreflightAt < acceptedUserMessageAt && acceptedCallbackAt > acceptedUserMessageAt);
const providerPreflightBranch = ordinarySendSource.slice(providerPreflightAt, consentPreflightAt);
const consentPreflightBranch = ordinarySendSource.slice(
  consentPreflightAt,
  ordinarySendSource.indexOf('if (plan.executionKind !== "closed_agent")', consentPreflightAt),
);
for (const branch of [providerPreflightBranch, consentPreflightBranch]) {
  assert.match(branch, /operationLockRef\.current = false;\s*return;/u);
  assert.doesNotMatch(branch, /onAccepted\?\.\(\)|sourceControlsCollapseSignal/u);
}

// Mobile source controls stay within the viewport instead of covering the
// story: the expanded body scrolls internally, controls become one column,
// and focusing the composer hides the setup surface.
assert.match(
  conversationCssSource,
  /@media \(max-width: 900px\)[\s\S]{0,3600}\.shell\s*\{[\s\S]{0,260}width:\s*100%;[\s\S]{0,240}overflow:\s*hidden;[\s\S]{0,80}overflow:\s*clip;/u,
);
assert.match(conversationCssSource, /\.thread\s*\{[\s\S]{0,120}min-width:\s*0;[\s\S]{0,80}overflow-x:\s*hidden/u);
assert.match(conversationCssSource, /\.threadInner\s*\{[\s\S]{0,140}width:\s*min\(100%, 1560px\);[\s\S]{0,80}min-width:\s*0/u);
assert.match(conversationCssSource, /@media \(max-width: 1040px\)\s*\{[\s\S]{0,100}\.choices\s*\{\s*grid-template-columns:\s*1fr;/u);
assert.match(conversationCssSource, /\.choiceCard\s*\{[\s\S]{0,100}width:\s*100%;/u);
assert.match(
  conversationCssSource,
  /@media \(max-width: 900px\)[\s\S]{0,5200}\.aiSourceCard select\s*\{\s*width:\s*100%;\s*min-width:\s*0;\s*min-height:\s*44px;\s*\}[\s\S]{0,120}\.externalAiControls\s*\{\s*grid-template-columns:\s*1fr;\s*\}/u,
);
assert.match(
  conversationCssSource,
  /\.composerWrap:has\(\.composer textarea:focus\) \.aiSourceCard:not\(\[open\]\),[\s\S]{0,120}display:\s*none;/u,
);
assert.doesNotMatch(
  conversationCssSource,
  /\.composerWrap:has\(\.composer textarea:focus\) \.aiSourceCard,\s*[\s\S]{0,120}display:\s*none;/u,
  "an explicitly opened source panel must remain operable even while the composer retains focus",
);
assert.match(
  conversationCssSource,
  /@media \(max-width: 900px\)[\s\S]{0,5600}\.composer textarea\s*\{[\s\S]{0,120}min-height:\s*46px;[\s\S]{0,140}font-size:\s*16px;/u,
);
assert.match(
  conversationCssSource,
  /\.sendButton,[\s\S]{0,500}\.exportSummary\s*\{\s*min-height:\s*44px;\s*touch-action:\s*manipulation;/u,
);

// RPG entry points consume the same external-source snapshot. Missing
// per-run consent still fails closed before a new user turn, while a consented
// request now runs the bounded external-first cascade instead of a fake
// "context not supported" stop. Provider preflight/call/result failures are
// truthfully recorded and only then start a fresh closed 180-second stage.
assert.match(
  conversationSource,
  /const rpgExecutionSourceSnapshot = \{[\s\S]{0,500}externalExecutionModeSelected/u,
);
assert.match(
  conversationSource,
  /useConversationRpgController\(\{[\s\S]{0,500}executionSourceSnapshot: rpgExecutionSourceSnapshot/u,
);
assert.match(
  conversationSource,
  /useConversationRpgController\(\{[\s\S]{0,800}externalProviderId[\s\S]{0,300}externalExecutionMode[\s\S]{0,300}consumeExternalRunConsentIntent/u,
);
assert.match(rpgSourceGateSource, /CONVERSATION_EXTERNAL_SINGLE_RUN_CONSENT_REQUIRED/u);
assert.doesNotMatch(rpgSourceGateSource, /CONVERSATION_EXTERNAL_RPG_CONTEXT_NOT_SUPPORTED/u);
assert.doesNotMatch(
  rpgSourceGateSource,
  /CONVERSATION_EXTERNAL_PROVIDER_NOT_CONFIGURED|CONVERSATION_EXTERNAL_PROVIDER_STATUS_UNAVAILABLE/u,
);
const executeRpgSource = rpgControllerSource.slice(
  rpgControllerSource.indexOf("async function executeRpgChoice"),
  rpgControllerSource.indexOf("async function chooseRpgOption"),
);
const executeRpgGateAt = executeRpgSource.indexOf("assertRpgExecutionSourceCanGenerate(executionSourceSnapshot)");
const executeRpgLockAt = executeRpgSource.indexOf("return withRpgTurnLock(");
const executeRpgCascadeAt = executeRpgSource.indexOf("generateRpgChatTurnCandidateWithExternalCascade({");
assert.ok(executeRpgLockAt >= 0 && executeRpgGateAt > executeRpgLockAt);
assert.ok(executeRpgGateAt < executeRpgCascadeAt);
// A/B/C collapses only after the source gate and execution attempt have been
// established, immediately before real candidate generation begins.
const rpgCandidateStartAt = executeRpgSource.indexOf("if (!candidate) {");
const rpgCollapseAt = executeRpgSource.indexOf("onRpgGenerationStarted();", rpgCandidateStartAt);
const rpgExternalCandidateAt = executeRpgSource.indexOf(
  "generateRpgChatTurnCandidateWithExternalCascade({",
  rpgCollapseAt,
);
const rpgClosedCandidateAt = executeRpgSource.indexOf(
  "generateRpgChatTurnCandidate({",
  rpgCollapseAt,
);
assert.ok(rpgCandidateStartAt >= 0 && rpgCollapseAt > rpgCandidateStartAt);
assert.ok(rpgExternalCandidateAt > rpgCollapseAt && rpgClosedCandidateAt > rpgCollapseAt);
const chooseRpgSource = rpgControllerSource.slice(
  rpgControllerSource.indexOf("async function chooseRpgOption"),
  rpgControllerSource.indexOf("async function recoverRpgChoices"),
);
assert.match(
  chooseRpgSource,
  /const hasDurableCandidate =[\s\S]{0,500}if \(!hasDurableCandidate && blockUnsupportedExecutionSource\(\)\) return;[\s\S]{0,500}executeRpgChoice\(/u,
);
const externalRequestGateAt = conversationSource.indexOf("if (externalSelectedForRequest) {");
const externalUserMessageAt = conversationSource.indexOf("let userMessage =", externalRequestGateAt);
const externalRpgGateAt = conversationSource.indexOf(
  "resolveRpgExecutionSourceBlock(rpgExecutionSourceSnapshot)",
  externalRequestGateAt,
);
assert.ok(externalRequestGateAt >= 0 && externalRpgGateAt > externalRequestGateAt);
assert.ok(externalRpgGateAt < externalUserMessageAt);

assert.match(rpgControllerSource, /generateRpgChatTurnCandidateWithExternalCascade\(\{/u);
assert.match(rpgControllerSource, /consentIntent:\s*consumeExternalRunConsentIntent\(\)/u);
assert.match(rpgControllerSource, /externalRequest:\s*candidate\.externalRequest/u);
assert.match(rpgControllerSource, /dataLeftDevice:\s*candidate\.dataLeftDevice/u);
assert.match(rpgExternalCascadeSource, /const intent = assertLiveIntent\(/u);
assert.match(rpgExternalCascadeSource, /generateExternalAICandidateClient/u);
assert.match(rpgExternalCascadeSource, /if \(input\.snapshot\.project\.adultMode\)[\s\S]{0,900}EXTERNAL_RPG_ADULT_CONTENT_LOCAL_ONLY/u);
assert.match(
  rpgExternalCascadeSource,
  /if \(!input\.publicExecutionEnabled \|\| !input\.providerConfigured \|\| input\.providerStatusError\)[\s\S]{0,1600}return invokeClosed/u,
);
assert.match(
  rpgExternalCascadeSource,
  /catch \(error\)[\s\S]{0,300}EXTERNAL_AI_CANCELLED[\s\S]{0,100}throw error;[\s\S]{0,900}return invokeClosed/u,
);
assert.match(rpgExternalCascadeSource, /provider-result-invalid/u);
assert.match(rpgExternalCascadeSource, /dataLeftDevice:\s*dispatched/u);
assert.match(rpgExternalReceiptSource, /verifyExternalRpgExecutionReceipt/u);
assert.match(rpgExternalReceiptSource, /verifyExternalRpgFailureLineage/u);
assert.match(rpgLogicalTurnSource, /rpgLogicalTurnExternalGenerationTaskId/u);
assert.match(rpgLogicalTurnSource, /external-generation/u);

// A verified external candidate is persisted locally before the visible
// message and completed invocation. Recovery consumes that durable artifact,
// verifies it, and skips both a second consent and a second provider call.
const rpgCandidateFlow = executeRpgSource.slice(
  executeRpgSource.indexOf("let candidate = durableCandidate"),
  executeRpgSource.indexOf("} catch (error)", executeRpgSource.indexOf("let candidate = durableCandidate")),
);
const rpgArtifactAt = rpgCandidateFlow.indexOf("conversation.saveArtifact({");
const rpgMessageAt = rpgCandidateFlow.indexOf("conversation.updateMessageStatus({", rpgArtifactAt);
const rpgInvocationAt = rpgCandidateFlow.indexOf("conversation.updateToolInvocationStatus({", rpgMessageAt);
assert.ok(
  rpgArtifactAt >= 0 && rpgMessageAt > rpgArtifactAt && rpgInvocationAt > rpgMessageAt,
  "RPG candidate recovery requires artifact first, visible message second, completed invocation last",
);
assert.match(executeRpgSource, /const durableArtifact = turnState\.artifacts\.find/u);
assert.match(executeRpgSource, /verifyExternalRpgExecutionReceipt\(parsed\)/u);
assert.match(executeRpgSource, /verifyExternalRpgFailureLineage\(parsed\)/u);
assert.match(executeRpgSource, /durableCandidate = parsed/u);
assert.match(executeRpgSource, /resume_durable_candidate/u);
assert.match(
  rpgCandidateFlow,
  /if \(!candidate\) \{[\s\S]{0,1800}generateRpgChatTurnCandidateWithExternalCascade\(\{/u,
);
assert.doesNotMatch(
  rpgCandidateFlow.slice(0, rpgCandidateFlow.indexOf("if (!candidate) {")),
  /consumeExternalRunConsentIntent\(|generateRpgChatTurnCandidateWithExternalCascade\(/u,
);

// The prompt contains only the exact current user message plus local task type;
// no chapter, character/world state, history, or attachment summaries are sent.
assert.match(externalHelperSource, /作者本次明確送出的文字/u);
assert.match(externalRunnerSource, /objective:\s*input\.userMessage\.content/u);
assert.doesNotMatch(externalHelperSource, /currentChapter|characters|worlds|recentMessage|attachment/iu);
assert.match(externalRunnerSource, /generateExternalAIStream\(\{/u);
assert.match(externalRunnerSource, /externalConsent:\s*true/u);
assert.match(externalRunnerSource, /onDelta:\s*\(delta, generatedTokenEvents\)/u);
assert.match(externalRunnerSource, /streamedText \+= delta/u);
assert.match(externalRunnerSource, /input\.onProjectMessage\(visibleMessage\)/u);

// Every external result is persisted as a candidate artifact and completed
// external invocation/receipt with zero Canon mutations. Failure never falls
// through to closed or deterministic generation.
assert.match(externalRunnerSource, /toolId:\s*CONVERSATION_EXTERNAL_AI_TOOL_ID/u);
assert.match(externalRunnerSource, /actualExecutor:\s*`external-api:\$\{input\.providerId\}`/u);
assert.match(externalRunnerSource, /artifact\s*=\s*await input\.conversation\.saveArtifact\(/u);
assert.match(externalRunnerSource, /const outputDigest = artifact\.candidateDigest/u);
assert.match(externalRunnerSource, /providerRunId:\s*result\.requestId/u);
assert.match(externalRunnerSource, /externalRequest:\s*true/u);
assert.match(externalRunnerSource, /dataLeftDevice:\s*true/u);
assert.match(externalRunnerSource, /canonicalMutationCount:\s*0/u);
assert.match(externalRunnerSource, /沒有完成；未改用閉端 AI、其他供應商或規則後備/u);
assert.match(externalRunSource, /assertExternalRunActive\(\);[\s\S]{0,240}input\.conversation\.saveArtifact\(/u);
const artifactCommitAt = externalRunSource.indexOf("artifact = await input.conversation.saveArtifact(");
const messageCommitAt = externalRunSource.indexOf(
  "const message = await input.conversation.updateMessageStatus(",
  artifactCommitAt,
);
const receiptCommitAt = externalRunSource.indexOf(
  "invocation = await input.conversation.updateToolInvocationStatus(",
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
assert.match(externalRunnerSource, /currentArtifact\?\.status === "candidate"[\s\S]{0,300}input\.conversation\.rejectArtifact\(/u);
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
  compactSourceControls: true,
  sourceControlsDefaultCollapsed: true,
  sourceControlsSelectionKeepsOpen: true,
  sourceControlsPreflightErrorKeepsOpen: true,
  sourceControlsCollapseAfterAcceptedMessage: true,
  rpgSourceControlsCollapseOnGenerationStart: true,
  mobileConversationCssContract: true,
  publicExecutionKillSwitchRespected: true,
  automaticPrivateContextExcluded: true,
  attachmentsFailClosed: true,
  noSilentFallback: true,
  rpgExternalFirstCascadeWired: true,
  rpgMissingConsentFailsClosed: true,
  rpgProviderFailureStartsClosed: true,
  rpgAdultModeLocalOnly: true,
  rpgCandidateFlagsTruthful: true,
  rpgDurableRecoveryNoResend: true,
  rpgArtifactBeforeCompletedReceipt: true,
  candidateReceiptPersisted: true,
  completedReceiptIsFinalCommitPoint: true,
  lateAbortCannotRejectCompletedCandidate: true,
  approvalLineageVerified: true,
  preApprovalCanonicalMutationCount: 0,
}, null, 2));
