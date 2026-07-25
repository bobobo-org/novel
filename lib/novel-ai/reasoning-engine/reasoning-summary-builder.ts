export function buildPublicReasoningAnswer(input: {
  answer: string;
  keyReasons: string[];
  supportingEvidence: string[];
  majorAlternatives: string[];
  uncertainty: string[];
  limitations: string[];
}) {
  return {
    answer: input.answer,
    keyReasons: input.keyReasons.slice(0, 10),
    supportingEvidence: input.supportingEvidence.slice(0, 20),
    majorAlternatives: input.majorAlternatives.slice(0, 8),
    uncertainty: input.uncertainty.slice(0, 8),
    limitations: input.limitations.slice(0, 8),
  };
}
