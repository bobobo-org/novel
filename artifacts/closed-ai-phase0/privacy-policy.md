# Closed AI privacy policy

Version: `closed-ai-privacy-v1`

- `device_only`: Browser AI or loopback Ollama only.
- `private_infrastructure_only`: Browser AI, loopback Ollama, or the explicitly configured Private Hub.
- `external_allowed`: external execution still requires explicit consent and a non-closed-only request.
- `closedOnly=true`: external providers and deterministic test providers are ineligible.
- `offlineRequired=true`: providers requiring network access are ineligible.

Private novel text is not training data by default. It may be used for the current user's inference, retrieval, or personal memory. Shared dataset export requires explicit consent, approved provenance, copyright review, and an approved Teacher Pipeline record.
