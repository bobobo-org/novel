# Novel Local AI Companion 1.2.0

This package runs only on the user's Windows computer. It connects the Novel
Studio web page to an existing Ollama installation through loopback:

- Local Bridge: `http://127.0.0.1:3217`
- Private Hub: `http://127.0.0.1:3227`
- Ollama: `http://127.0.0.1:11434`
- LAN listening: disabled
- telemetry: disabled
- firewall modification: none
- software installation: none

## Requirements

1. Windows PowerShell.
2. Node.js 22 or newer.
3. Ollama installed and running.
4. At least one Ollama text-generation model.

## Start

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
incompatible. Download the newer ZIP, verify its SHA-256, stop the old service,
replace the extracted package, and start it again. The Studio reconnects and
re-verifies the selected model automatically. The website never silently
installs software or overrides Windows or organization policy.

## Verify the download

The setup page publishes the SHA-256 of the exact ZIP. In PowerShell:

```powershell
Get-FileHash .\novel-local-ai-companion-v1.2.0.zip -Algorithm SHA256
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
