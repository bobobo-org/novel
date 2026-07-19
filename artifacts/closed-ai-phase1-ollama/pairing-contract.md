# Pairing contract

States: `unpaired`, `pairing_requested`, `paired`, `revoked`, `expired`. The six-digit code is short-lived and one-use. The 256-bit token is short-lived, revocable, hashed in memory, bound to origin and Bridge instance, and accompanied by a CSRF nonce. Tokens are never accepted in query strings or normal logs.
