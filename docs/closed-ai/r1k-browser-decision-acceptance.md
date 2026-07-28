# R1K Browser Decision Acceptance Contract

Contract version: `r1k-browser-decision-acceptance-v2`

R1K accepts two distinct native browser decision methods:

- `HUMAN_NATIVE_UI`: a human operator clicks the native browser control.
- `WINDOWS_UI_AUTOMATION`: Windows UI Automation locates and invokes the native browser control by semantic role and accessible name.

The methods are never interchangeable in reports. An automated run must report:

```text
technical_status: AUTOMATED_PASS
human_validation_status: HUMAN_NOT_RUN
decision_method: WINDOWS_UI_AUTOMATION
human_operator_clicked: false
```

An automated run is acceptable only when all of the following are evidenced:

1. A fresh, isolated browser profile had no existing permission before launch.
2. The UI Automation element belongs to the verified test-browser PID and window.
3. The element has button semantics and an accepted localized name for the declared Grant or Deny decision.
4. Selection uses semantic UI Automation lookup, never fixed screen coordinates.
5. Deny changes permission from `ASK_OR_UNSET` to `DENIED`; Grant changes it to `GRANTED`.
6. Deny errors and Grant success state are produced by product behavior, not injected by the harness.
7. Deny sends no browser request to Bridge. Grant sends non-zero browser requests and completes product-UI pairing without external AI fallback.
8. Neither decision writes accepted choices, story branches, Story Bible facts, or other formal repository data before an explicit product transaction.
9. Reload and Chrome restart preserve the permission according to browser design; cleanup revokes the Preview origin and releases all test processes and ports.

If a release gate explicitly requires human operation, `AUTOMATED_PASS / HUMAN_NOT_RUN` does not satisfy that separate gate. It must not be renamed to or summarized as human verification.

Evidence schemas evolve additively. Readers must reject unknown major versions and may ignore unknown fields within the same major version.
