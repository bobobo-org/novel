# Closed AI Phase 1.1 result

## Verdict

`PHASE1_1_NOT_READY`

The real local runtime and core desktop Studio flow work, but the stricter acceptance gate is not fully evidenced.

## Verified

- Studio pairing, model discovery, model selection, streaming generation, cancellation, timeout, retry, revoke, reload invalidation, Bridge restart, and Ollama restart were exercised through the Studio UI.
- Real `qwen2.5:3b` generation completed through `local_ollama`; external AI calls were zero.
- Browser console contained zero errors and zero warnings during the recorded run.
- Bridge listens only on loopback, does not modify the firewall, does not download models, and does not retain complete prompts or outputs.
- Phase 1, Phase 0, training governance, P2.1R1, H1, TypeScript, lint baseline, and build regressions passed.

## Release blockers

1. A physical mobile soft keyboard and physical-device long-stream interaction were not testable in desktop Chromium emulation.
2. A complete browser storage export was not captured; source/contract/reload evidence exists, but the requested DevTools-equivalent artifact does not.
3. Model removal and in-flight model switching were contract-tested but not fully exercised through the UI because only one text model was installed.
4. Final re-pair after the forced-expiry scenario was interrupted by browser-control reset.
5. Windows user re-login first launch was not tested.
6. A truly clean shell without the bundled Node runtime cannot run the Node launcher; the product still needs a packaged Windows entry point or explicit Node prerequisite handling.
7. Story intelligence quality is partial: character extraction hallucinated one organization, and continuity review missed age/location conflicts.

## Safety declarations

- DevTools state modification: no
- Direct Bridge API used instead of UI: no
- Automatic model download: no
- Firewall modification: no
- Non-loopback listener: no
- Full prompt/output stored by Bridge: no
- Pairing token found in logs or artifacts: no
- Real external AI called: no
- Production deployed: no
- Main merged or pushed: no

The branch may be committed as an evidence-backed intermediate result, but it must not be described as `PHASE1_1_READY`.
