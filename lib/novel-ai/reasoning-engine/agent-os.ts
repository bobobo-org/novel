import { REASONING_ENGINE_SCHEMA_VERSION, type ReasoningAgentRole, type ReasoningEngineInput, type ReasoningEngineOutput } from "./types";
import { assertReasoningToolPermission } from "./permission-gateway";
import { SovereignToolRegistry } from "./tool-registry";
import { buildPublicReasoningAnswer } from "./reasoning-summary-builder";
import { buildDeliberativePlan } from "./deliberative-planner";
import { buildSourceGroundedSynthesis, type SynthesisClaim } from "./source-grounded-synthesis";

export type AgentRuntime = {
  run(input: {
    role: ReasoningAgentRole;
    instruction: string;
    observations: string[];
    signal?: AbortSignal;
  }): Promise<{ answer: string; reasons: string[]; alternatives: string[]; uncertainty: string[]; confidence: number; claimEvidence?: SynthesisClaim[] }>;
};

const taskAgents: Record<ReasoningEngineInput["taskClass"], ReasoningAgentRole[]> = {
  creative: ["planner", "story_architect", "character_agent", "world_agent", "writer", "continuity_agent", "critic", "judge"],
  adult_creative: ["planner", "story_architect", "character_agent", "writer", "continuity_agent", "critic", "judge"],
  fact: ["planner", "researcher", "adversarial_reviewer", "judge"],
  analysis: ["planner", "researcher", "critic", "adversarial_reviewer", "judge"],
  research: ["planner", "researcher", "adversarial_reviewer", "critic", "judge"],
  high_risk_real_world: ["planner", "researcher", "adversarial_reviewer", "judge"],
};

export class SovereignReasoningEngine {
  private readonly registry: SovereignToolRegistry;
  private readonly runtime: AgentRuntime;

  constructor(
    registry: SovereignToolRegistry,
    runtime: AgentRuntime,
  ) {
    this.registry = registry;
    this.runtime = runtime;
  }

  async run(input: ReasoningEngineInput): Promise<ReasoningEngineOutput> {
    const deadline = AbortSignal.timeout(Math.max(1000, input.timeoutMs));
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const agents = taskAgents[input.taskClass].slice(0, Math.max(1, input.maxAgentSteps));
    const observations: string[] = [];
    const toolsUsed: string[] = [];
    const deliberativePlan = buildDeliberativePlan({
      taskClass: input.taskClass,
      instruction: input.instruction,
      availableTools: input.allowedToolIds,
    });
    for (const toolId of input.allowedToolIds) {
      const tool = this.registry.get(toolId);
      if (!tool) throw Object.assign(new Error(`找不到工具：${toolId}`), { code: "REASONING_TOOL_NOT_FOUND" });
      assertReasoningToolPermission({ request: input, role: agents[0], tool });
      const result = await tool.execute({ contextRefs: input.contextRefs }, { projectId: input.projectId, requestId: input.requestId, signal });
      observations.push(JSON.stringify(result));
      toolsUsed.push(toolId);
    }
    let latest: Awaited<ReturnType<AgentRuntime["run"]>> = { answer: "", reasons: [], alternatives: [], uncertainty: [], confidence: 0 };
    for (const role of agents) {
      if (signal.aborted) throw Object.assign(new Error("推理任務已中止。"), { code: "REASONING_ABORTED" });
      latest = await this.runtime.run({ role, instruction: input.instruction, observations, signal });
      observations.push(`${role}:${latest.answer}`);
    }
    const publicAnswer = buildPublicReasoningAnswer({
      answer: latest.answer,
      keyReasons: latest.reasons,
      supportingEvidence: input.contextRefs,
      majorAlternatives: latest.alternatives,
      uncertainty: latest.uncertainty,
      limitations: toolsUsed.length ? [] : ["本次沒有使用外部知識工具。"],
    });
    const sourceSynthesis = input.sourceDocuments && latest.claimEvidence
      ? buildSourceGroundedSynthesis({
          question: input.instruction,
          sources: input.sourceDocuments,
          claims: latest.claimEvidence,
        })
      : null;
    return {
      schemaVersion: REASONING_ENGINE_SCHEMA_VERSION,
      requestId: input.requestId,
      ...publicAnswer,
      confidence: Math.max(0, Math.min(100, latest.confidence)),
      agentsUsed: agents,
      toolsUsed,
      deliberativePlan: {
        plannerVersion: deliberativePlan.plannerVersion,
        hypothesisCount: deliberativePlan.hypotheses.length,
        verificationGates: deliberativePlan.verificationGates,
      },
      sourceSynthesis: sourceSynthesis ? {
        synthesisVersion: sourceSynthesis.synthesisVersion,
        citationCoverage: sourceSynthesis.citationCoverage,
        unsupportedFactCount: sourceSynthesis.unsupportedFactCount,
        contradictionCount: sourceSynthesis.contradictions.length,
      } : null,
      externalRequestCount: 0,
      rawInternalReasoningExposed: false,
    };
  }
}
