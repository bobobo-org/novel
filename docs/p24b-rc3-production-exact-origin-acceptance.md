# P2.4B RC3 Production exact-origin acceptance

This handoff is intentionally inert until an independently reviewed RC3 commit is deployed. It never promotes, aliases, merges, changes Vercel settings, or mutates Supabase.

## Safety gates

1. Use only `https://novel-orcin.vercel.app` or `https://novel-lqtechs-projects.vercel.app` as an exact origin. Paths, query strings, HTTP, and unrelated hosts are rejected.
2. The runner fetches `/api/release/identity` with `no-store` and refuses to continue unless the RC3 release tag, consumer release, architecture stage, build-sealed 40-character commit, and verified provenance all match.
3. Production only permits `--mode read-only`. Runtime and local repository mutations are blocked in Production by the runner.
4. A new disposable Microsoft Edge profile is created under the evidence directory. Daily browser profiles are not used.
5. Network evidence stores only method, status, origin, and path. Cookies, headers, query strings, pairing codes, CSRF values, and story text are not recorded.

## Read-only Production acceptance

Run each alias independently after RC3 has been deployed and independently approved:

```powershell
node scripts/run-p24b-rc3-exact-origin-acceptance.mjs `
  --base-url https://novel-orcin.vercel.app `
  --environment production `
  --mode read-only `
  --headed `
  --artifacts artifacts/p24b-rc3-production-primary
```

```powershell
node scripts/run-p24b-rc3-exact-origin-acceptance.mjs `
  --base-url https://novel-lqtechs-projects.vercel.app `
  --environment production `
  --mode read-only `
  --headed `
  --artifacts artifacts/p24b-rc3-production-mirror
```

The runner starts at `/`, reaches Local AI setup, Studio, and Legacy only through visible product links, returns from Legacy to the modern Studio, and repeats the core entry check at 390×844. It records zero manually entered deep URLs and rejects any unexpected third-party request.

## Native Edge and Local Ollama gate

The native Local Network Access decision is a separate device-scoped gate. For a Preview URL, run the existing safety-reviewed native harness with an exact setup URL and a fresh profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-r5-2r1a-real-browser.ps1 `
  -TargetUrl "https://PREVIEW_HOST.vercel.app/settings/local-ai" `
  -ProductCommit "PREVIEW_COMMIT" `
  -Browser edge `
  -Flow grant `
  -AutomatedNativeUi `
  -ArtifactDirectory "artifacts/p24b-rc3-consumer-activation/native-edge"
```

This harness keeps browser security checks enabled, binds the Bridge only to `127.0.0.1`, enrolls only the exact Preview origin, captures raw console/network/browser identity evidence, and revokes the temporary Bridge origin during cleanup. It never installs Ollama or downloads a model. `qwen2.5:3b` must already be installed.

After Preview runtime acceptance and Independent LUNA approval, repeat the native device gate for each Production exact origin only under a separately authorized Production acceptance task. Do not reuse Preview pairing state or copy a pairing code into evidence.

## Required stop conditions

Stop without changing Production if release identity is not RC3, provenance is not verified, Edge is not a fresh real profile, native Local Network Access is denied or unobserved, Local Bridge is not loopback-only, `qwen2.5:3b` does not complete a real inference, any external AI request occurs, or any credential-like value appears in evidence.
