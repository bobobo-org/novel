/**
 * Production facade for the one-use RC6.4 prose diagnostic bridge.
 *
 * The production build aliases the diagnostic module to this file. Keep this
 * facade free of diagnostic global names, authorization domains, and bridge
 * version strings so there is no dormant control surface in client bytes.
 */

type DisabledBrowserProseDiagnosticConsumeInput = Readonly<{
  projectId: string;
  sessionId: string;
  taskType: "chapter.continue";
  requestId: string;
}>;

type DisabledBrowserProseDiagnosticConsumeResult = Readonly<{
  status: "applied" | "rejected";
  baseSeed: 17_041 | 27_043 | 37_049 | null;
}>;

export async function initializeBrowserProseDiagnosticBridge(): Promise<null> {
  return null;
}

export async function consumeBrowserProseDiagnosticSeed(
  _input: DisabledBrowserProseDiagnosticConsumeInput,
): Promise<DisabledBrowserProseDiagnosticConsumeResult | null> {
  void _input;
  return null;
}

/** Fail-closed target for any accidental Product import of the setup controller. */
export function browserAiSetupDiagnosticController(): null {
  return null;
}
