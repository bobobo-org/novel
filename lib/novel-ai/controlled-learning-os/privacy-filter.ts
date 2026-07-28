const CREDENTIAL_PATTERNS = [
  /\bvcp_[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:sk|sbp)_[A-Za-z0-9_-]{20,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
] as const;

const CHAIN_OF_THOUGHT_PATTERNS = [
  /\bchain[- ]of[- ]thought\b/iu,
  /\bhidden reasoning\b/iu,
  /(?:逐步|完整)(?:思考|推理)(?:過程|內容)/u,
] as const;

export type ControlledLearningPrivacyInput = {
  featureText?: string;
  resultText?: string;
  authorOnly?: boolean;
  privateSimulation?: boolean;
  rawChainOfThought?: boolean;
  sourceTenantId?: string;
  sourceProjectId?: string;
  sourceCanonId?: string;
};

export function inspectControlledLearningPrivacy(
  input: ControlledLearningPrivacyInput,
  expected: { tenantId: string; projectId: string; canonId: string },
) {
  const text = `${input.featureText ?? ""}\n${input.resultText ?? ""}`;
  const blockingCodes: string[] = [];
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) {
    blockingCodes.push("LEARNING_CREDENTIAL_BLOCKED");
  }
  if (input.rawChainOfThought || CHAIN_OF_THOUGHT_PATTERNS.some((pattern) => pattern.test(text))) {
    blockingCodes.push("LEARNING_RAW_CHAIN_OF_THOUGHT_BLOCKED");
  }
  if (input.authorOnly) blockingCodes.push("LEARNING_AUTHOR_ONLY_BLOCKED");
  if (input.privateSimulation) blockingCodes.push("LEARNING_PRIVATE_SIMULATION_BLOCKED");
  if (input.sourceTenantId && input.sourceTenantId !== expected.tenantId) {
    blockingCodes.push("LEARNING_CROSS_TENANT_BLOCKED");
  }
  if (input.sourceProjectId && input.sourceProjectId !== expected.projectId) {
    blockingCodes.push("LEARNING_CROSS_PROJECT_BLOCKED");
  }
  if (input.sourceCanonId && input.sourceCanonId !== expected.canonId) {
    blockingCodes.push("LEARNING_CROSS_CANON_BLOCKED");
  }
  return {
    passed: blockingCodes.length === 0,
    blockingCodes,
    redactionRequired: Boolean(input.featureText || input.resultText),
  };
}
