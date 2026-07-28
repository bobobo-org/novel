export function reviseReasoningAnswer(input: {
  answer: string;
  critique: string[];
  maxCritiqueRounds: 0 | 1;
  revision?: (answer: string, critique: string[]) => Promise<string>;
}) {
  if (!input.maxCritiqueRounds || !input.critique.length || !input.revision) {
    return Promise.resolve({ answer: input.answer, revised: false, critiqueRounds: 0 });
  }
  return input.revision(input.answer, input.critique).then((answer) => ({ answer, revised: true, critiqueRounds: 1 }));
}
