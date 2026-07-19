# Router Privacy Review

Strict-local correctly rejects Gemini/OpenAI/Grok and Private AI Hub, then selects an allowed local executor. Cloud providers require `privacyMode=external-allowed` plus explicit consent.

The review found that Private AI Hub was previously allowed for any mode except strict-local, including external mode without external consent. The review patch now allows it only when `privacyMode=private-hub-allowed`. Three independent high-risk runs verify no silent private/cloud selection.

Legacy cloud API routes still exist, but no evidence was found that the reviewed platform router silently falls back to them from strict-local mode.
