import { evaluateOpenExpression } from "../open-expression-policy";
import type { PersonaProfile } from "../persona-profile";

export function runOpenExpressionEngine(input: {
  text: string;
  fictional: boolean;
  controversial: boolean;
  persona: PersonaProfile;
}) {
  const evaluation = evaluateOpenExpression(input.text, {
    fictional: input.fictional,
    requestedSensitiveTheme: input.controversial,
  });
  return {
    ...evaluation,
    directEnough: input.persona.directness < 80 || !/(?:也許可以考慮|某種程度上可能|不妨或許)/.test(input.text),
    uncertaintyPresent: input.persona.uncertaintyDisclosure < 80 || /(?:不確定|可能|證據不足|無法確認)/.test(input.text),
    fictionalBoundaryClear: !input.fictional || evaluation.distinction === "fictional_expression",
  };
}

export function generateOpposingView(claim: string) {
  return {
    claim,
    opposingView: `反方需要檢驗「${claim}」是否忽略例外、代價或相反證據。`,
    isGeneratedHypothesis: true,
  };
}
