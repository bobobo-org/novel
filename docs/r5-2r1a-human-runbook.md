# R5.2R1A Local Browser Operator Runbook

This package validates the existing Preview with installed Google Chrome and Microsoft Edge. It does not modify product code, deploy a Preview, call an external AI, or write Story Bible data.

## Preconditions

- Use the same interactive Windows desktop that runs Ollama and the Local Bridge.
- Keep `qwen2.5:3b` installed; the runner does not download models.
- Close any prior R5.2 test browser windows.
- Do not change firewall, proxy, hosts, browser policies, browser flags, URLs, storage, or Bridge configuration.

## Run

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-r5-2r1a-real-browser.ps1
```

The default run is the Chrome grant smoke test. After it succeeds, run the four-flow matrix:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-r5-2r1a-real-browser.ps1 -FullMatrix
```

Before browser launch the runner displays the Product Preview URL, product commit, harness commit, Chrome and Edge binary paths, isolated profile paths, Bridge bind/port, exact origin, and each unique `run_id`.

## Allowed human actions

The operator may only:

1. Choose Allow or Block in the browser's native Local Network Access prompt, matching the displayed flow.
2. Return to PowerShell and type `CONTINUE <decision challenge>` exactly as displayed.

The runner prints a heartbeat every 30 seconds and does not automatically time out while a real operator is available. Every heartbeat revalidates the harness process, exact browser PID/profile/session/user, actual command line, browser control channel, Preview page and URL, visible browser window, loopback Bridge, and exact enrolled origin. To stop safely, type `ABORT <operator challenge>` exactly as displayed. Closing the terminal records `ABORTED_OPERATOR_UNAVAILABLE`.

If the browser, control channel, Preview page, visible window, Bridge, or origin enrollment is lost, the wait ends immediately with a specific liveness failure. The run is recorded as `NOT_TESTED`, is not reusable for acceptance, and the runner preserves partial evidence before revoking the origin and cleaning up. A `CONTINUE` command is revalidated against the same gate and is rejected as `OPERATOR_CONTINUE_REJECTED_STALE_BROWSER_STATE` if the browser state became stale.

Do not manually change the URL, enrollment command, browser storage, Bridge settings, evidence, or test results. Invalid input does not advance the run. An explicit challenged `ABORT` records `ABORTED_BY_OPERATOR`; the runner does not overwrite that evidence with an automatic retry.

## Browser sandbox

Both branded browser adapters require the normal Chromium sandbox. The Playwright channel sets `chromiumSandbox: true` and removes Playwright's sandbox-disabling defaults. The CDP fallback does not pass sandbox-disabling switches. After startup, the harness audits the actual process command lines and fails closed before Preview navigation if a forbidden security argument is present or command-line evidence cannot be read.

## Evidence

Every flow uses a separate profile, `run_id`, trace, HAR/network log, console log, Bridge access slice, screenshot, final result, cleanup record, and SHA-256 manifest under:

```text
artifacts/closed-ai-phase1-1r5-2r1a/runs/<run_id>/
```

The runner revokes the Preview origin, stops the Bridge, and verifies port cleanup in `finally`, including aborted runs. No pairing token, complete prompt, or complete output should appear in evidence.

## Interpretation

- `COMPLETED_FOR_REVIEW` means automation and the human decision finished; inspect correlation evidence before declaring a grant or deny PASS.
- `ABORTED_BY_OPERATOR` is final for that `run_id`.
- `BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT` is a harness-observed browser loss, never an operator abort.
- A liveness failure must not automatically restart the same profile or advance to the next matrix flow.
- Adapter or identity errors are failures and must not be bypassed with security flags or a daily browser profile.
- Story Bible remains `NOT_TESTED` in R5.2R1A.
