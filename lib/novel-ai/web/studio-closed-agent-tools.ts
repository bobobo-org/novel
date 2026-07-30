import {
  analyzeObjectiveAcceptance,
  ClosedAgentToolRegistry,
  type ClosedAIContextItem,
} from "../closed-agent-os";
import { sha256Hex } from "../closed-ai-cache";

export const STUDIO_CLOSED_AGENT_TOOL_IDS = [
  "acceptance-checklist",
  "story-context-index",
] as const;

function contextCoverage(context: ClosedAIContextItem[]) {
  const kinds = Object.fromEntries(
    ["canon", "story-bible", "retrieval", "memory"].map((kind) => [
      kind,
      context.filter((item) => item.kind === kind).length,
    ]),
  );
  return {
    kinds,
    hasCanon: Number(kinds.canon ?? 0) > 0,
    hasStoryBible: Number(kinds["story-bible"] ?? 0) > 0,
    hasRetrieval: Number(kinds.retrieval ?? 0) > 0,
    hasApprovedMemory: Number(kinds.memory ?? 0) > 0,
  };
}

export function createStudioClosedAgentToolRegistry() {
  return new ClosedAgentToolRegistry()
    .register({
      id: "acceptance-checklist",
      label: "作者目標驗收清單",
      capability: "local-metadata",
      requiredScopes: ["story:read"],
      localOnly: true,
      projectBound: true,
      async execute(input) {
        return {
          schemaVersion: "studio-acceptance-checklist-v1",
          taskType: input.taskType,
          contract: analyzeObjectiveAcceptance(input.objective),
          candidateOnly: true,
          canonicalMutationCount: 0,
        };
      },
    })
    .register({
      id: "story-context-index",
      label: "已核准作品脈絡索引",
      capability: "retrieval",
      requiredScopes: ["story-bible:read"],
      localOnly: true,
      projectBound: true,
      async execute(input) {
        const context = input.approvedContext.filter((item) =>
          item.approved
          && item.visibility !== "author-only"
          && item.visibility !== "evaluator"
          && item.privacyLevel === input.namespace.privacyLevel);
        return {
          schemaVersion: "studio-story-context-index-v1",
          projectId: input.namespace.projectId,
          coverage: contextCoverage(context),
          sources: await Promise.all(context.map(async (item) => ({
            id: item.id,
            kind: item.kind,
            learningFacet: item.learningFacet ?? "general",
            characters: item.text.length,
            digest: await sha256Hex(item.text),
          }))),
          excludedAuthorOnly: true,
          excludedUnapproved: true,
          rawSourceTextStored: false,
          candidateOnly: true,
          canonicalMutationCount: 0,
        };
      },
    });
}
