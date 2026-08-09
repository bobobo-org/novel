export default function TechnicalEvidencePanel({ evidence }: { evidence: unknown }) {
  return <pre data-testid="conversation-technical-evidence">{JSON.stringify(evidence, null, 2)}</pre>;
}
