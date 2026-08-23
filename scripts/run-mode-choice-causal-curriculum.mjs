import assert from "node:assert/strict";
import {
  auditModeChoiceNovelty,
  createModeChoiceStrategyFingerprint,
  getAllModeChoiceCurriculumDrafts,
  getModeChoiceCurriculum,
  MODE_CHOICE_PUBLIC_PROVENANCE,
  MODE_CHOICE_RECENT_FINGERPRINT_LIMIT,
  MODE_CHOICE_RULE_INDEX_LIMIT,
  MODE_CHOICE_TOP_K_PER_MODE,
} from "../lib/novel-ai/sovereign-learning/mode-choice-causal-curriculum.ts";
import { normalizeSharedLearningRules } from "../lib/novel-ai/sovereign-learning/shared-learning-contract.ts";

const expectedStateKeys = {
  rpg: ["ability", "equipment", "quest", "stamina", "actionPoints"],
  romance: ["relationship", "trust", "eventProgress", "characterGrowth"],
  management: ["funds", "workforce", "quality", "reputation", "risk"],
};

assert.equal(MODE_CHOICE_PUBLIC_PROVENANCE.length, 4);
for (const source of MODE_CHOICE_PUBLIC_PROVENANCE) {
  assert.match(source.url, /^https:\/\//u);
  assert.equal(source.rightsBasis, "public_abstract_research");
  assert.equal(source.retainedForm, "abstract_summary_only");
  assert.equal(source.rawSourceRetained, false);
  assert.ok(source.summary.length >= 30 && source.summary.length <= 100);
  assert.ok(source.supports.length >= 3);
  assert.equal("sourceText" in source, false);
  assert.equal("quote" in source, false);
}

const allDrafts = getAllModeChoiceCurriculumDrafts();
assert.equal(allDrafts.length, MODE_CHOICE_RULE_INDEX_LIMIT);
assert.equal(new Set(allDrafts.map((rule) => rule.parameters.curriculumRuleId)).size, allDrafts.length);
assert.equal(allDrafts.every((rule) => rule.parameters.fixedChoiceCopy === false), true);
assert.equal(allDrafts.every((rule) => rule.parameters.canonGroundingRequired === true), true);
assert.equal(allDrafts.every((rule) => rule.sourceOverlapScore === 0 && rule.longestSourceMatch === 0), true);
assert.equal(allDrafts.every((rule) => !/https?:\/\//u.test(JSON.stringify(rule))), true);

const normalized = await normalizeSharedLearningRules({
  rules: allDrafts,
  teacherVersion: "closed-mode-choice-causal-teacher-v1",
});
assert.equal(normalized.rejectedCount, 0);
assert.equal(normalized.rules.length, MODE_CHOICE_RULE_INDEX_LIMIT);
assert.equal(normalized.rules.every((rule) => rule.shared && rule.abstractionScore >= 0.98), true);

for (const mode of ["rpg", "romance", "management"]) {
  const curriculum = getModeChoiceCurriculum(mode, Number.POSITIVE_INFINITY);
  assert.equal(curriculum.selection.topKLimit, MODE_CHOICE_TOP_K_PER_MODE);
  assert.equal(curriculum.selection.ruleIndexLimit, MODE_CHOICE_RULE_INDEX_LIMIT);
  assert.equal(curriculum.selection.entireLearningLibraryScanned, false);
  assert.equal(curriculum.selection.fixedModeIndex, true);
  assert.equal(curriculum.rules.length, MODE_CHOICE_TOP_K_PER_MODE);
  assert.equal(curriculum.privacy.fixedChoiceCopyIncluded, false);
  assert.equal(curriculum.privacy.rawSourceIncluded, false);
  assert.deepEqual(new Set(curriculum.requiredStateKeys), new Set(expectedStateKeys[mode]));
  const coveredStateKeys = new Set(curriculum.rules.flatMap((rule) => rule.stateKeys));
  for (const stateKey of expectedStateKeys[mode]) {
    assert.ok(coveredStateKeys.has(stateKey), `${mode} curriculum must cover ${stateKey}`);
  }
  assert.ok(curriculum.rules.some((rule) => rule.id === "canon-state-concretization"));
  assert.ok(curriculum.rules.some((rule) => rule.id === "same-and-recent-choice-novelty"));
  assert.equal(curriculum.provenance.length, MODE_CHOICE_PUBLIC_PROVENANCE.length);
}

assert.equal(getModeChoiceCurriculum("rpg", 10_000).rules.length, MODE_CHOICE_TOP_K_PER_MODE);
assert.equal(getModeChoiceCurriculum("rpg", Number.NaN).rules.length, MODE_CHOICE_TOP_K_PER_MODE);
assert.equal(getModeChoiceCurriculum("rpg", 1).rules.length, 1);

const context = {
  mode: "rpg",
  canonRevisionId: "canon-revision-17",
  stateRevision: 23,
  activeCanonAnchorIds: ["sealed-gate", "quartermaster-ledger", "field-camp"],
  activeStateKeys: ["ability", "equipment", "quest", "stamina", "actionPoints"],
  unresolvedHookIds: ["gate-deadline", "missing-scout"],
};
const candidates = [
  {
    intent: "advance",
    actionFamily: "direct-breakthrough",
    canonAnchorIds: ["sealed-gate"],
    targetStateKeys: ["quest"],
    costStateKeys: ["stamina"],
    benefitStateKeys: ["quest"],
    riskBand: "high",
  },
  {
    intent: "investigate",
    actionFamily: "resource-inspection",
    canonAnchorIds: ["quartermaster-ledger"],
    targetStateKeys: ["equipment"],
    costStateKeys: ["actionPoints"],
    benefitStateKeys: ["ability"],
    riskBand: "low",
  },
  {
    intent: "recover",
    actionFamily: "temporary-regroup",
    canonAnchorIds: ["field-camp"],
    targetStateKeys: ["stamina", "actionPoints"],
    costStateKeys: ["quest"],
    benefitStateKeys: ["stamina", "actionPoints"],
    riskBand: "medium",
  },
];

const accepted = auditModeChoiceNovelty({ context, candidates });
assert.equal(accepted.accepted, true);
assert.equal(accepted.fingerprints.length, 3);
assert.equal(new Set(accepted.fingerprints.map((fingerprint) => fingerprint.signature)).size, 3);
assert.equal(accepted.fingerprints.every((fingerprint) => fingerprint.renderedTextRetained === false), true);
assert.equal(JSON.stringify(accepted.fingerprints).includes("sealed-gate"), false, "fingerprints must hash Canon anchors");
assert.equal(JSON.stringify(accepted.fingerprints).includes("direct-breakthrough"), false, "fingerprints must hash action families");
assert.equal(accepted.privacy.renderedTextRetained, false);
assert.equal(accepted.privacy.canonTextRetained, false);

const sameTurnDuplicate = auditModeChoiceNovelty({
  context,
  candidates: [candidates[0], candidates[1], {
    ...candidates[1],
    actionFamily: "inspect-resources-again",
  }],
});
assert.equal(sameTurnDuplicate.accepted, false);
assert.ok(sameTurnDuplicate.violations.some((violation) => violation.code === "SAME_TURN_INTENT_DUPLICATE"));
assert.ok(sameTurnDuplicate.violations.some((violation) => violation.code === "SAME_TURN_STRATEGY_TOO_SIMILAR"));

const recentDuplicate = createModeChoiceStrategyFingerprint(context, candidates[0]);
const recentHistory = Array.from({ length: 40 }, () => recentDuplicate);
const recentAudit = auditModeChoiceNovelty({
  context,
  candidates,
  recentFingerprints: recentHistory,
});
assert.equal(recentAudit.accepted, false);
assert.equal(recentAudit.inspectedRecentFingerprintCount, MODE_CHOICE_RECENT_FINGERPRINT_LIMIT);
assert.ok(recentAudit.violations.some((violation) => violation.code === "RECENT_STRATEGY_TOO_SIMILAR"));

const staleCanonAudit = auditModeChoiceNovelty({
  context,
  candidates: [candidates[0], candidates[1], {
    ...candidates[2],
    canonAnchorIds: ["anchor-not-in-active-canon"],
  }],
});
assert.equal(staleCanonAudit.accepted, false);
assert.ok(staleCanonAudit.violations.some((violation) => violation.code === "CHOICE_NOT_CANON_GROUNDED"));

const inactiveStateAudit = auditModeChoiceNovelty({
  context,
  candidates: [candidates[0], candidates[1], {
    ...candidates[2],
    targetStateKeys: ["funds"],
  }],
});
assert.equal(inactiveStateAudit.accepted, false);
assert.ok(inactiveStateAudit.violations.some((violation) => violation.code === "CHOICE_STATE_NOT_ACTIVE"));

console.log(JSON.stringify({
  status: "MODE_CHOICE_CAUSAL_CURRICULUM_PASS",
  ruleIndexCount: allDrafts.length,
  topKPerMode: MODE_CHOICE_TOP_K_PER_MODE,
  recentFingerprintLimit: MODE_CHOICE_RECENT_FINGERPRINT_LIMIT,
  provenanceCount: MODE_CHOICE_PUBLIC_PROVENANCE.length,
  modes: Object.keys(expectedStateKeys),
}, null, 2));
