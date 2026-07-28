import {
  ClosedAICache,
  assertClosedAINamespace,
  createClosedAICacheRepository,
  sha256Hex,
  stableStringify,
} from "../closed-ai-cache";
import {
  ControlledLearningOS,
  createControlledLearningRepository,
  type ControlledKnowledgeRule,
  type ControlledLearningOutcome,
  type ControlledLearningVersion,
} from "../controlled-learning-os";
import {
  VerifiableLedger,
  createVerifiableLedgerRepository,
} from "../verifiable-ledger";
import { createDefaultClosedAIBackends } from "./backends";
import { evaluateClosedAgentCandidate } from "./evaluator";
import { createClosedAgentPlan } from "./planner";
import {
  createClosedAgentStateRepository,
  type ClosedAgentStateRepository,
} from "./repository";
import { selectClosedAIBackend } from "./router";
import {
  assertClosedAgentPermission,
  ClosedAgentToolRegistry,
} from "./tool-registry";
import {
  CLOSED_AGENT_OS_SCHEMA_VERSION,
  type ClosedAIBackendAdapter,
  type ClosedAgentApprovalRecord,
  type ClosedAgentCandidate,
  type ClosedAgentExecutionResult,
  type ClosedAgentMemoryRecord,
  type ClosedAgentPlan,
  type ClosedAgentTaskRecord,
  type ClosedAgentTaskRequest,
} from "./types";

type ClosedAgentOSOptions = {
  backends?: ClosedAIBackendAdapter[];
  cache?: ClosedAICache;
  learning?: ControlledLearningOS;
  ledger?: VerifiableLedger;
  state?: ClosedAgentStateRepository;
  tools?: ClosedAgentToolRegistry;
  now?: () => Date;
};

type ApprovalInput = {
  candidateId: string;
  approvedBy: string;
  humanApproved: boolean;
  canonicalCommit?: (input: {
    candidate: ClosedAgentCandidate;
    approvalId: string;
  }) => Promise<{ commitId: string; storyBibleRevision?: string }>;
};

function osError(code: string, message = code, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

export class ClosedAgentOS {
  readonly cache: ClosedAICache;
  readonly learning: ControlledLearningOS;
  readonly ledger: VerifiableLedger;
  readonly state: ClosedAgentStateRepository;
  readonly tools: ClosedAgentToolRegistry;
  private readonly backends: Map<ClosedAIBackendAdapter["id"], ClosedAIBackendAdapter>;
  private readonly now: () => Date;
  private readonly projectQueues = new Map<string, Promise<unknown>>();

  constructor(options: ClosedAgentOSOptions = {}) {
    this.cache = options.cache ?? new ClosedAICache({
      repository: createClosedAICacheRepository(),
    });
    this.learning = options.learning ?? new ControlledLearningOS({
      repository: createControlledLearningRepository(),
    });
    this.ledger = options.ledger ?? new VerifiableLedger({
      repository: createVerifiableLedgerRepository(),
    });
    this.state = options.state ?? createClosedAgentStateRepository();
    this.tools = options.tools ?? new ClosedAgentToolRegistry();
    this.backends = new Map(
      (options.backends ?? createDefaultClosedAIBackends()).map((backend) => [backend.id, backend]),
    );
    this.now = options.now ?? (() => new Date());
  }

  async backendSnapshots(signal?: AbortSignal) {
    return Promise.all([...this.backends.values()].map((backend) => backend.snapshot(signal)));
  }

  execute(request: ClosedAgentTaskRequest): Promise<ClosedAgentExecutionResult> {
    const projectId = request.namespace.projectId;
    const previous = this.projectQueues.get(projectId) ?? Promise.resolve();
    const operation = previous.then(() => this.executeInternal(request));
    this.projectQueues.set(projectId, operation.catch(() => undefined));
    return operation;
  }

  private async executeInternal(
    requestInput: ClosedAgentTaskRequest,
  ): Promise<ClosedAgentExecutionResult> {
    let request = requestInput;
    assertClosedAINamespace(request.namespace);
    if (!request.taskId || !request.objective.trim()) {
      throw osError("CLOSED_AGENT_TASK_INVALID");
    }
    if (request.signal?.aborted) throw osError("CLOSED_AGENT_TASK_CANCELLED");
    const existing = await this.state.get<ClosedAgentTaskRecord>(request.taskId);
    if (existing && existing.state === "awaiting-approval") {
      const candidates = await this.state.list<ClosedAgentCandidate>(
        request.namespace.projectId,
        "candidate",
      );
      const candidate = candidates.find((item) => item.taskId === request.taskId);
      if (!candidate) throw osError("CLOSED_AGENT_IDEMPOTENCY_STATE_INCOMPLETE");
      const replayRequest = { ...request, namespace: candidate.namespace };
      const blocks = await this.ledger.repository.list(this.ledgerId(request));
      const planLookup = await this.cache.get<ClosedAgentPlan>(
        "agent-plan",
        candidate.namespace,
        this.planCacheInput(replayRequest, candidate.backendId),
      );
      if (!planLookup.entry) throw osError("CLOSED_AGENT_IDEMPOTENCY_PLAN_MISSING");
      const activeLearning = await this.learning.activeConfiguration(candidate.namespace);
      return {
        task: existing,
        candidate,
        plan: planLookup.entry.value,
        route: {
          backendId: candidate.backendId,
          locked: true,
          automatic: !request.preferredBackend,
          reasonCode: "IDEMPOTENT_REPLAY",
          fallbackAttempted: false,
        },
        cache: { candidateHit: true, planHit: true },
        learning: activeLearning,
        ledgerHeadHash: blocks.at(-1)?.blockHash ?? "",
      };
    }
    const createdAt = this.now().toISOString();
    let task: ClosedAgentTaskRecord = {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      kind: "task",
      id: request.taskId,
      projectId: request.namespace.projectId,
      namespace: structuredClone(request.namespace),
      taskType: request.taskType,
      backendId: null,
      state: "queued",
      errorCode: null,
      createdAt,
      updatedAt: createdAt,
    };
    await this.state.put(task);
    await this.ledger.append({
      ledgerId: this.ledgerId(request),
      namespace: request.namespace,
      eventType: "task-accepted",
      payload: {
        taskId: request.taskId,
        taskType: request.taskType,
        objectiveDigest: await sha256Hex(request.objective),
      },
    });
    try {
      const snapshots = await this.backendSnapshots(request.signal);
      const route = selectClosedAIBackend(request, snapshots);
      const backend = this.backends.get(route.backend.id);
      if (!backend) throw osError("CLOSED_AI_BACKEND_ADAPTER_MISSING");
      request = {
        ...request,
        namespace: {
          ...request.namespace,
          modelId: route.backend.modelId ?? `${route.backend.id}:runtime-managed`,
          modelDigest: route.backend.modelDigest ?? `${route.backend.id}:digest-runtime-managed`,
        },
      };
      const activeLearning = await this.learning.activeConfiguration(request.namespace);
      request = {
        ...request,
        learningConfiguration: activeLearning.configuration,
      };
      task = {
        ...task,
        namespace: structuredClone(request.namespace),
        backendId: route.backend.id,
        state: "running",
        updatedAt: this.now().toISOString(),
      };
      await this.state.put(task);
      await this.ledger.append({
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "backend-selected",
        payload: {
          backendId: route.backend.id,
          automatic: route.automatic,
          reasonCode: route.reasonCode,
          fallbackAttempted: false,
          controlledLearningApplied: activeLearning.applied,
          controlledLearningVersionId: activeLearning.versionId,
          controlledLearningConfigurationDigest: activeLearning.configurationDigest,
          controlledLearningReasonCode: activeLearning.reasonCode,
        },
      });

      const planInput = this.planCacheInput(request, route.backend.id);
      const planResult = await this.cache.compute(
        "agent-plan",
        request.namespace,
        planInput,
        () => createClosedAgentPlan({
          request,
          backendId: route.backend.id,
          complexity: route.complexity,
        }),
        { tags: ["closed-agent-plan", `task:${request.taskType}`] },
      );
      const plan = planResult.value;
      for (const role of plan.roles) assertClosedAgentPermission({ request, role });
      const toolResults = await this.executeTools(request, plan);
      const actorContext = request.context.filter((item) =>
        item.approved
        && item.visibility !== "author-only"
        && item.visibility !== "evaluator"
        && item.privacyLevel === request.namespace.privacyLevel);
      if (request.context.some((item) =>
        item.kind === "author-note"
        && item.visibility !== "author-only")) {
        throw osError("CLOSED_AGENT_AUTHOR_ONLY_LABEL_REQUIRED");
      }
      const candidateInput = {
        taskType: request.taskType,
        objectiveDigest: await sha256Hex(request.objective),
        actorContextDigests: await Promise.all(actorContext.map((item) => sha256Hex(item.text))),
        planDigest: plan.planDigest,
        backendId: route.backend.id,
        learningConfiguration: request.learningConfiguration ?? {},
        toolResultDigests: await Promise.all(
          toolResults.map((item) => sha256Hex(stableStringify(item.value))),
        ),
      };
      const executionResult = await this.cache.compute(
        "exact",
        request.namespace,
        candidateInput,
        () => backend.execute({ request, plan, actorContext, toolResults }),
        { tags: ["closed-agent-candidate", `task:${request.taskType}`] },
      );
      const execution = executionResult.value;
      if (execution.backendId !== route.backend.id) {
        throw osError("CLOSED_AI_BACKEND_IDENTITY_MISMATCH", undefined, {
          selected: route.backend.id,
          actual: execution.backendId,
        });
      }
      const evaluation = await evaluateClosedAgentCandidate({ request, execution });
      await this.ledger.append({
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "candidate-generated",
        payload: {
          taskId: request.taskId,
          backendId: execution.backendId,
          modelId: execution.modelId,
          modelDigest: execution.modelDigest,
          contentDigest: await sha256Hex(execution.content),
          candidateOnly: true,
        },
        result: {
          elapsedMs: execution.elapsedMs,
          dataLeftDevice: execution.dataLeftDevice,
          externalRequest: execution.externalRequest,
        },
      });
      await this.ledger.append({
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "candidate-evaluated",
        payload: {
          passed: evaluation.passed,
          score: evaluation.score,
          blockingCodes: evaluation.blockingCodes,
          warningCodes: evaluation.warningCodes,
          evaluatorInputDigest: evaluation.evaluatorInputDigest,
        },
      });
      if (!evaluation.passed) {
        throw osError("CLOSED_AGENT_EVALUATION_BLOCKED", undefined, {
          blockingCodes: evaluation.blockingCodes,
        });
      }
      const updatedAt = this.now().toISOString();
      const candidate: ClosedAgentCandidate = {
        schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
        kind: "candidate",
        id: `closed-agent-candidate:${await sha256Hex(`${request.taskId}|${execution.content}`)}`,
        projectId: request.namespace.projectId,
        taskId: request.taskId,
        namespace: structuredClone(request.namespace),
        backendId: execution.backendId,
        modelId: execution.modelId,
        modelDigest: execution.modelDigest,
        content: execution.content,
        contentDigest: await sha256Hex(execution.content),
        planDigest: plan.planDigest,
        evaluation,
        status: "awaiting-approval",
        candidateOnly: true,
        canonicalMutationCount: 0,
        createdAt: updatedAt,
        updatedAt,
      };
      task = {
        ...task,
        state: "awaiting-approval",
        updatedAt,
      };
      await this.state.put(candidate);
      await this.state.put(task);
      const verification = await this.ledger.verify(this.ledgerId(request));
      if (!verification.valid || !verification.headHash) {
        throw osError("CLOSED_AGENT_LEDGER_INTEGRITY_FAILED");
      }
      return {
        task,
        candidate,
        plan,
        route: {
          backendId: route.backend.id,
          locked: true,
          automatic: route.automatic,
          reasonCode: route.reasonCode,
          fallbackAttempted: false,
        },
        cache: {
          candidateHit: executionResult.cacheHit,
          planHit: planResult.cacheHit,
        },
        learning: activeLearning,
        ledgerHeadHash: verification.headHash,
      };
    } catch (cause) {
      const code = String((cause as { code?: string })?.code || "CLOSED_AGENT_TASK_FAILED");
      task = {
        ...task,
        state: code === "CLOSED_AGENT_TASK_CANCELLED" ? "cancelled" : "failed",
        errorCode: code,
        updatedAt: this.now().toISOString(),
      };
      await this.state.put(task);
      throw cause;
    }
  }

  async approveCandidate(input: ApprovalInput) {
    const candidate = await this.state.get<ClosedAgentCandidate>(input.candidateId);
    if (!candidate) throw osError("CLOSED_AGENT_CANDIDATE_NOT_FOUND");
    if (!input.humanApproved) throw osError("CLOSED_AGENT_HUMAN_APPROVAL_REQUIRED");
    if (!candidate.evaluation.passed || candidate.status !== "awaiting-approval") {
      throw osError("CLOSED_AGENT_APPROVAL_GATE_FAILED");
    }
    const approvalId = `closed-agent-approval:${crypto.randomUUID()}`;
    const ledgerId = `closed-agent:${candidate.namespace.projectId}:${candidate.taskId}`;
    const approvalBlock = await this.ledger.append({
      ledgerId,
      namespace: candidate.namespace,
      eventType: "approval-signed",
      payload: {
        approvalId,
        candidateId: candidate.id,
        candidateDigest: candidate.contentDigest,
        approvedBy: input.approvedBy,
        humanApproved: true,
      },
      signApproval: true,
    });
    let canonicalCommitId: string | null = null;
    let nextStoryBibleRevision: string | undefined;
    if (input.canonicalCommit) {
      const result = await input.canonicalCommit({ candidate, approvalId });
      canonicalCommitId = result.commitId;
      nextStoryBibleRevision = result.storyBibleRevision;
      await this.ledger.append({
        ledgerId,
        namespace: candidate.namespace,
        eventType: "canonical-commit",
        payload: {
          approvalId,
          candidateId: candidate.id,
          commitId: result.commitId,
          previousStoryBibleRevision: candidate.namespace.storyBibleRevision,
          resultingStoryBibleRevision: result.storyBibleRevision ?? null,
        },
      });
    }
    const approvedAt = this.now().toISOString();
    const approval: ClosedAgentApprovalRecord = {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      kind: "approval",
      id: approvalId,
      projectId: candidate.projectId,
      namespace: structuredClone(candidate.namespace),
      candidateId: candidate.id,
      approvedBy: input.approvedBy,
      approvalBlockHash: approvalBlock.blockHash,
      canonicalCommitId,
      approvedAt,
    };
    const memory: ClosedAgentMemoryRecord = {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      kind: "memory",
      id: `closed-agent-memory:${candidate.id}`,
      projectId: candidate.projectId,
      namespace: structuredClone(candidate.namespace),
      candidateId: candidate.id,
      content: candidate.content,
      contentDigest: candidate.contentDigest,
      approvalId,
      approvedAt,
      canonical: Boolean(canonicalCommitId),
    };
    const updatedCandidate: ClosedAgentCandidate = {
      ...candidate,
      status: canonicalCommitId ? "committed" : "approved",
      canonicalMutationCount: canonicalCommitId ? 1 : 0,
      updatedAt: approvedAt,
    };
    await this.state.put(approval);
    await this.state.put(memory);
    await this.state.put(updatedCandidate);
    const task = await this.state.get<ClosedAgentTaskRecord>(candidate.taskId);
    if (task) {
      await this.state.put({
        ...task,
        state: "completed",
        updatedAt: approvedAt,
      });
    }
    if (nextStoryBibleRevision) {
      const count = await this.cache.invalidateStoryBibleRevision(
        candidate.namespace,
        candidate.namespace.storyBibleRevision,
      );
      await this.ledger.append({
        ledgerId,
        namespace: candidate.namespace,
        eventType: "cache-invalidated",
        payload: {
          invalidatedEntryCount: count,
          previousStoryBibleRevision: candidate.namespace.storyBibleRevision,
          resultingStoryBibleRevision: nextStoryBibleRevision,
        },
      });
    }
    const learningSignal = await this.recordLearningOutcome({
      candidate: updatedCandidate,
      outcome: canonicalCommitId ? "approved_canon" : "accepted",
      sourceApprovalId: approvalId,
    });
    return {
      approval,
      memory,
      candidate: updatedCandidate,
      canonicalMutationCount: updatedCandidate.canonicalMutationCount,
      learningSignal,
    };
  }

  async rejectCandidate(candidateId: string) {
    const candidate = await this.state.get<ClosedAgentCandidate>(candidateId);
    if (!candidate) throw osError("CLOSED_AGENT_CANDIDATE_NOT_FOUND");
    if (candidate.status !== "awaiting-approval") {
      throw osError("CLOSED_AGENT_REJECTION_GATE_FAILED");
    }
    const updated: ClosedAgentCandidate = {
      ...candidate,
      status: "rejected",
      updatedAt: this.now().toISOString(),
    };
    await this.state.put(updated);
    await this.recordLearningOutcome({
      candidate: updated,
      outcome: "rejected",
      sourceApprovalId: null,
    });
    return updated;
  }

  async createKnowledgeRulePackCandidate(input: {
    namespace: Parameters<ControlledLearningOS["createKnowledgeRulePackCandidate"]>[0]["namespace"];
    sourceText: string;
    sourceTitle?: string;
    sourceType: "user-provided-article" | "ai-export" | "reference-notes";
    rules: ControlledKnowledgeRule[];
    humanConfirmedRights: boolean;
    sourceTenantId?: string;
    sourceProjectId?: string;
    sourceCanonId?: string;
  }) {
    const transformation = await this.learning.createKnowledgeRulePackCandidate(input);
    const ledgerId = this.learningLedgerId(
      transformation.candidate.projectId,
      transformation.candidate.id,
    );
    const block = await this.ledger.append({
      ledgerId,
      namespace: transformation.candidate.namespace,
      eventType: "learning-candidate",
      payload: {
        candidateId: transformation.candidate.id,
        candidateType: transformation.candidate.candidateType,
        sourceDigest: transformation.sourceDigest,
        transformationDigest: transformation.transformationDigest,
        proposalDigest: transformation.candidate.proposalDigest,
        ruleCount: transformation.ruleCount,
        sourceContentStored: false,
        verbatimCopyStored: false,
        copyingRiskCheck: transformation.copyingRiskCheck,
      },
    });
    return {
      ...transformation,
      ledgerId,
      ledgerHeadHash: block.blockHash,
    };
  }

  async approveLearningCandidate(input: {
    candidateId: string;
    score: number;
    blockingCodes?: string[];
    approvedBy: string;
    humanApproved: boolean;
  }) {
    const evaluated = await this.learning.evaluateCandidate(input.candidateId, {
      score: input.score,
      blockingCodes: input.blockingCodes,
    });
    const approvalId = `controlled-learning-approval:${crypto.randomUUID()}`;
    const approved = await this.learning.approveCandidate(evaluated.id, {
      approvedBy: input.approvedBy,
      approvalId,
      humanApproved: input.humanApproved,
    });
    const dataset = await this.learning.createDataset(approved.id, input.humanApproved);
    const ledgerId = this.learningLedgerId(approved.projectId, approved.id);
    const block = await this.ledger.append({
      ledgerId,
      namespace: approved.namespace,
      eventType: "learning-candidate",
      payload: {
        candidateId: approved.id,
        proposalDigest: approved.proposalDigest,
        evaluationScore: approved.evaluation?.score ?? null,
        blockingCodes: approved.evaluation?.blockingCodes ?? [],
        approvalId,
        approvedBy: input.approvedBy,
        humanApproved: true,
        datasetId: dataset.id,
        datasetDigest: dataset.contentDigest,
        rawContentStored: false,
      },
      signApproval: true,
    });
    return {
      candidate: approved,
      dataset,
      approvalId,
      ledgerId,
      ledgerHeadHash: block.blockHash,
    };
  }

  startLearningABTest(
    input: Parameters<ControlledLearningOS["startABTest"]>[0],
  ) {
    return this.learning.startABTest(input);
  }

  recordLearningABSample(
    testId: string,
    baselineScore: number,
    candidateScore: number,
  ) {
    return this.learning.recordABSample(testId, baselineScore, candidateScore);
  }

  async adoptLearningCandidate(candidateId: string, testId: string) {
    const version = await this.learning.adoptCandidate(candidateId, testId);
    const ledgerId = this.learningLedgerId(version.projectId, version.candidateId);
    const block = await this.ledger.append({
      ledgerId,
      namespace: version.namespace,
      eventType: "learning-adopted",
      payload: {
        candidateId: version.candidateId,
        versionId: version.id,
        version: version.version,
        configurationDigest: version.configurationDigest,
        parentVersionId: version.parentVersionId,
      },
    });
    return {
      version,
      ledgerId,
      ledgerHeadHash: block.blockHash,
    };
  }

  async rollbackLearningVersion(versionId: string) {
    const version = await this.learning.repository.get<ControlledLearningVersion>(versionId);
    if (!version) throw osError("CONTROLLED_LEARNING_VERSION_NOT_FOUND");
    const restored = await this.learning.rollbackVersion(versionId);
    const ledgerId = this.learningLedgerId(version.projectId, version.candidateId);
    const block = await this.ledger.append({
      ledgerId,
      namespace: version.namespace,
      eventType: "rollback",
      payload: {
        versionId,
        candidateId: version.candidateId,
        restoredVersionId: restored?.id ?? null,
        resultingStatus: "rolled_back",
      },
    });
    return {
      rolledBackVersionId: versionId,
      restored,
      ledgerId,
      ledgerHeadHash: block.blockHash,
    };
  }

  async dashboard(projectId: string) {
    const [backends, cache, learning, tasks, candidates, approvals, memories] = await Promise.all([
      this.backendSnapshots(),
      this.cache.stats(),
      this.learning.dashboard(projectId),
      this.state.list<ClosedAgentTaskRecord>(projectId, "task"),
      this.state.list<ClosedAgentCandidate>(projectId, "candidate"),
      this.state.list<ClosedAgentApprovalRecord>(projectId, "approval"),
      this.state.list<ClosedAgentMemoryRecord>(projectId, "memory"),
    ]);
    return {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      status: "ready" as const,
      oneSharedSystem: true,
      backends,
      cache,
      learning,
      queue: {
        queued: tasks.filter((task) => task.state === "queued").length,
        running: tasks.filter((task) => task.state === "running").length,
        awaitingApproval: tasks.filter((task) => task.state === "awaiting-approval").length,
      },
      candidates: candidates.length,
      approvals: approvals.length,
      approvedMemoryRecords: memories.length,
      canonicalMutationRequiresCallback: true,
      silentFallback: false,
      rawChainOfThoughtStored: false,
    };
  }

  private async executeTools(request: ClosedAgentTaskRequest, plan: ClosedAgentPlan) {
    const results: Array<{ toolId: string; value: unknown }> = [];
    for (const toolId of request.allowedToolIds) {
      const tool = this.tools.get(toolId);
      if (!tool) throw osError("CLOSED_AGENT_TOOL_NOT_REGISTERED", undefined, { toolId });
      const role = plan.steps.find((step) => step.allowedToolIds.includes(toolId))?.role ?? "planner";
      assertClosedAgentPermission({ request, role, tool });
      const cacheResult = await this.cache.compute(
        "tool-result",
        request.namespace,
        {
          toolId,
          taskId: request.taskId,
          objectiveDigest: await sha256Hex(request.objective),
        },
        () => tool.execute({
          namespace: request.namespace,
          taskId: request.taskId,
          payload: { taskType: request.taskType },
          signal: request.signal,
        }),
        { tags: ["closed-agent-tool", `tool:${toolId}`] },
      );
      results.push({ toolId, value: cacheResult.value });
    }
    return results;
  }

  private async recordLearningOutcome(input: {
    candidate: ClosedAgentCandidate;
    outcome: ControlledLearningOutcome;
    sourceApprovalId: string | null;
  }) {
    const task = await this.state.get<ClosedAgentTaskRecord>(input.candidate.taskId);
    const collection = await this.learning.collectExperienceIfConsented({
      namespace: input.candidate.namespace,
      outcome: input.outcome,
      taskType: task?.taskType ?? "learning.preferenceReview",
      featureText: stableStringify({
        taskType: task?.taskType ?? "learning.preferenceReview",
        backendId: input.candidate.backendId,
        planDigest: input.candidate.planDigest,
      }),
      resultText: input.candidate.content,
      score: input.candidate.evaluation.score,
      tags: [
        `backend:${input.candidate.backendId}`,
        `task:${task?.taskType ?? "learning.preferenceReview"}`,
        `outcome:${input.outcome}`,
      ],
      sourceApprovalId: input.sourceApprovalId,
    });
    if (!collection.collected) {
      return {
        ...collection,
        ledgerRecorded: false,
        ledgerErrorCode: null,
      };
    }
    try {
      await this.ledger.append({
        ledgerId: `closed-agent:${input.candidate.projectId}:${input.candidate.taskId}`,
        namespace: input.candidate.namespace,
        eventType: "learning-experience",
        payload: {
          experienceId: collection.experience.id,
          outcome: collection.experience.outcome,
          outcomeLabel: collection.experience.outcomeLabel,
          featureDigest: collection.experience.featureDigest,
          resultDigest: collection.experience.resultDigest,
          sourceApprovalId: collection.experience.sourceApprovalId,
          rawInputStored: false,
          rawOutputStored: false,
          rawChainOfThoughtStored: false,
        },
      });
      return {
        ...collection,
        ledgerRecorded: true,
        ledgerErrorCode: null,
      };
    } catch {
      return {
        ...collection,
        ledgerRecorded: false,
        ledgerErrorCode: "CONTROLLED_LEARNING_LEDGER_APPEND_FAILED",
      };
    }
  }

  private ledgerId(request: ClosedAgentTaskRequest) {
    return `closed-agent:${request.namespace.projectId}:${request.taskId}`;
  }

  private learningLedgerId(projectId: string, candidateId: string) {
    return `closed-learning:${projectId}:${candidateId}`;
  }

  private planCacheInput(
    request: ClosedAgentTaskRequest,
    backendId: ClosedAIBackendAdapter["id"],
  ) {
    return {
      taskType: request.taskType,
      backendId,
      objectiveDigest: request.objective,
      allowedToolIds: [...request.allowedToolIds].sort(),
      permissionScopes: [...request.permissionScopes].sort(),
    };
  }
}

export const CLOSED_AGENT_OS_HEALTH = {
  schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
  status: "ready",
  oneSharedSystemStatus: "ready",
  threeBackendCoexistenceStatus: "ready",
  browserAIAdapterStatus: "ready_runtime_dependent",
  localOllamaAdapterStatus: "ready_runtime_dependent",
  privateAIHubAdapterStatus: "contract_ready_runtime_not_connected",
  routerStatus: "ready",
  plannerStatus: "ready",
  toolRegistryStatus: "ready",
  permissionGatewayStatus: "ready",
  taskQueueStatus: "ready",
  storyMemoryStatus: "ready",
  evaluatorStatus: "ready",
  approvalTransactionStatus: "ready",
  cacheIntegrationStatus: "ready",
  controlledLearningIntegrationStatus: "ready",
  controlledLearningOutcomeCaptureStatus: "ready",
  adoptedLearningConfigurationStatus: "ready",
  knowledgeRulePackWorkflowStatus: "ready",
  learningDataLineageStatus: "ready",
  verifiableLedgerIntegrationStatus: "ready",
  noSilentFallbackStatus: "ready",
  agentDirectShellAccess: false,
  agentDirectDatabaseAccess: false,
  agentDirectFilesystemAccess: false,
  agentDirectNetworkAccess: false,
  rawChainOfThoughtStored: false,
} as const;
