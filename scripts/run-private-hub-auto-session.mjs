import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
  PRIVATE_HUB_PROTOCOL,
  createPrivateHubServer,
} from "../local-ai/private-hub/server.mjs";

const origin = "https://novel-orcin.vercel.app";
const port = 3238;
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-private-hub-auto-"));
const hub = createPrivateHubServer({
  port,
  testMode: true,
  runtimeDir,
  pairingFile: path.join(runtimeDir, "pairing.json"),
});
const base = `http://127.0.0.1:${port}`;
const headers = (extra = {}) => ({
  Origin: origin,
  "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
  ...extra,
});
const read = async (response) => ({
  status: response.status,
  body: await response.json().catch(() => ({})),
});

try {
  await hub.start();
  const health = await read(await fetch(`${base}/health`, { headers: headers() }));
  assert.equal(health.status, 200);
  assert.equal(health.body.automaticSessionSupported, true);
  assert.match(health.body.hubVersion, /^1\.1\.0/u);

  const connected = await read(await fetch(`${base}/session/auto`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ intent: "closed-ai-connect" }),
  }));
  assert.equal(connected.status, 200);
  assert.equal(connected.body.automaticConnection, true);
  assert.equal(connected.body.sessionKind, "trusted_origin_auto");
  assert.equal("pairingId" in connected.body, false);
  assert.equal("code" in connected.body, false);

  const stats = await read(await fetch(`${base}/cache/stats`, {
    headers: headers({ Authorization: `Bearer ${connected.body.token}` }),
  }));
  assert.equal(stats.status, 200);
  assert.equal(stats.body.cache.encryptedAtRest, true);

  const revoked = await read(await fetch(`${base}/pair/revoke`, {
    method: "POST",
    headers: headers({
      Authorization: `Bearer ${connected.body.token}`,
      "X-Hub-CSRF": connected.body.csrf,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ confirm: true }),
  }));
  assert.equal(revoked.body.state, "revoked");

  const retry = await read(await fetch(`${base}/session/auto`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ intent: "closed-ai-connect" }),
  }));
  assert.equal(retry.body.errorCode, "BRIDGE_PAIRING_REVOKED");

  const lookalike = await read(await fetch(`${base}/session/auto`, {
    method: "POST",
    headers: {
      Origin: "https://novel-orcin.vercel.app.evil.example",
      "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ intent: "closed-ai-connect" }),
  }));
  assert.equal(lookalike.body.errorCode, "BRIDGE_ORIGIN_NOT_ALLOWED");

  process.stdout.write(`${JSON.stringify({
    suite: "private-hub-origin-auto-session",
    status: "PASS",
    passwordInputs: 0,
    pairingCodeRequests: 0,
    exactOriginEnforced: true,
    revocationEnforced: true,
    encryptedCache: true,
  }, null, 2)}\n`);
} finally {
  await hub.stop().catch(() => undefined);
  await rm(runtimeDir, { recursive: true, force: true });
}
