# Novel Local AI Companion 1.0.0

This package runs only on the user's Windows computer. It connects the Novel
Studio web page to an existing Ollama installation through loopback:

- Local Bridge: `http://127.0.0.1:3217`
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

Return to `/settings/local-ai`, request pairing, then read the six-digit
one-time code locally:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher pair
```

The optional “remember within this tab” setting stores only the short-lived,
origin-bound local Bridge session in `sessionStorage`. It is never written to
`localStorage`, a URL, project data, backup data, or normal logs. Closing the
tab, changing the exact origin, restarting the Bridge, changing its instance
identity, or reaching the expiry invalidates recovery and requires pairing
again.

## Verify the download

The setup page publishes the SHA-256 of the exact ZIP. In PowerShell:

```powershell
Get-FileHash .\novel-local-ai-companion-v1.0.0.zip -Algorithm SHA256
```

Compare the full value before extracting. This release is checksum-verifiable
but not code-signed. Windows may therefore show an unsigned-download warning.
Do not bypass an organization policy; use the source files from the repository
or ask an administrator to review them.

## Stop

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher stop
```

Stopping the Bridge does not stop, install, remove, or modify Ollama.
