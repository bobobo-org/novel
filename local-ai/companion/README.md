# Novel Local AI Companion 1.4.6

This package runs only on the user's Windows computer. It connects the Novel
Studio web page to an existing Ollama installation through loopback:

- Local Bridge: `http://127.0.0.1:3217`
- Private Hub: `http://127.0.0.1:3227`
- Ollama: `http://127.0.0.1:11434`
- LAN listening: disabled
- telemetry: disabled
- firewall modification: none
- installer scope: current Windows user only
- Windows logon autostart: enabled by the installer
- autonomous-learning experience ledger: append-only, hash-chained, and raw-content-free
- continuous-learning coordinator: runs while Private Hub is open and creates only sealed strategy candidates when new experience arrives

## Requirements

1. Windows PowerShell.
2. Node.js 22 or newer.
3. Ollama installed and running.
4. At least one Ollama text-generation model.

## Recommended installation

Download and run `novel-local-ai-companion-setup-v1.4.6.cmd`. The one-click
installer downloads checksum-pinned release files from the official site and:

1. verifies or installs Node.js LTS and Ollama through Windows `winget`;
2. installs this release under `%LOCALAPPDATA%\NovelLocalAICompanion`;
3. creates a current-user Windows logon shortcut;
4. starts Local Bridge and Private Hub immediately;
5. installs `qwen2.5:3b` only when no copy is already available.

Windows and the browser can still require a one-time, visible permission. The
website cannot and must not bypass Windows application policy or the browser's
native local-network permission.

## Manual/source installation

Open PowerShell inside the extracted package and run:

```powershell
$launcher = ".\bridge\novel-local-ai.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher diagnose
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher status
```

The official production origins connect automatically with an exact-origin,
short-lived session. No web form password or six-digit pairing code is needed.
The browser may still ask once for native local-network access; this permission
must be approved by the person using that browser.

Start the optional Private Hub for heavy multi-agent and private training work:

```powershell
$hub = ".\private-hub\novel-private-hub.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hub start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hub status
```

Preview or custom origins are not trusted automatically. For those origins
only, request pairing and read the one-time code locally:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher pair
```

The “remember within this tab” setting stores only the short-lived,
origin-bound session in `sessionStorage`. It is never written to
`localStorage`, a URL, project data, backup data, or normal logs. Closing the
tab, changing the exact origin, restarting the Bridge, changing its instance
identity, or reaching the expiry invalidates recovery and requires pairing
again. Revoking a production-origin session prevents automatic reconnection
until the service restarts or a manual pairing is explicitly completed.

## Version updates

The Studio reads the running Bridge and Private Hub versions from their local
health endpoints. It compares them with the minimum and recommended versions
published by the website and shows one of: current, update available, or
incompatible. Run the newer installer. It stops the prior release, keeps
releases in a versioned local directory, updates the logon shortcut, starts
both local services, and lets Studio reconnect and re-verify the selected model
automatically. The ZIP remains available for administrators who prefer source
inspection and manual installation.

## Verify the download

The setup page publishes the SHA-256 of the exact installer. In PowerShell:

```powershell
Get-FileHash .\novel-local-ai-companion-setup-v1.4.6.cmd -Algorithm SHA256
```

Compare the full value before extracting. This release is checksum-verifiable
but not code-signed. Windows may therefore show an unsigned-download warning.
Do not bypass an organization policy; use the source files from the repository
or ask an administrator to review them.

## Stop

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hub stop
```

Stopping the Bridge does not stop, install, remove, or modify Ollama.
