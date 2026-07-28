import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const workflowPath = process.env.P24B_RC2_WORKFLOW_PATH || "";
const reportPath = process.env.P24B_RC2_ACTION_PIN_REPORT || "";
const actions = [
  {
    owner: "actions",
    repository: "checkout",
    tag: "v4",
    expectedCommit: "11d5960a326750d5838078e36cf38b85af677262",
  },
  {
    owner: "actions",
    repository: "setup-node",
    tag: "v4",
    expectedCommit: "49933ea5288caeca8642d1e84afbd3f7d6820020",
  },
  {
    owner: "pnpm",
    repository: "action-setup",
    tag: "v4",
    expectedCommit: "b906affcce14559ad1aafd4ab0e942779e9f58b1",
  },
];

function resolveTag(action) {
  const repositoryUrl = `https://github.com/${action.owner}/${action.repository}.git`;
  const output = execFileSync(
    "git",
    ["ls-remote", repositoryUrl, `refs/tags/${action.tag}`, `refs/tags/${action.tag}^{}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const rows = output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [commit, ref] = line.trim().split(/\s+/);
    return { commit: commit.toLowerCase(), ref };
  });
  const peeled = rows.find((row) => row.ref === `refs/tags/${action.tag}^{}`);
  const direct = rows.find((row) => row.ref === `refs/tags/${action.tag}`);
  const resolvedCommit = (peeled ?? direct)?.commit ?? null;
  assert.match(resolvedCommit ?? "", /^[0-9a-f]{40}$/);
  assert.equal(resolvedCommit, action.expectedCommit);
  return {
    action: `${action.owner}/${action.repository}`,
    repositoryUrl,
    tag: action.tag,
    tagKind: peeled ? "annotated" : "lightweight",
    resolvedCommit,
    expectedCommit: action.expectedCommit,
    officialOwner: true,
    status: "PASS",
  };
}

const resolved = actions.map(resolveTag);
const workflowUses = [];
if (workflowPath) {
  assert.equal(fs.existsSync(workflowPath), true, `WORKFLOW_MISSING:${workflowPath}`);
  const source = fs.readFileSync(workflowPath, "utf8");
  assert.match(source, /^permissions:\s*\r?\n\s+contents:\s+read\s*$/m);
  assert.doesNotMatch(source, /\b(?:vercel|--prod|promote|rollback|alias)\b/i);
  for (const match of source.matchAll(
    /^\s*uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#]+)\s*$/gm,
  )) {
    workflowUses.push({ action: match[1], ref: match[2] });
  }
  assert.ok(workflowUses.length > 0, "WORKFLOW_HAS_NO_ACTION_USES");
  for (const use of workflowUses) {
    assert.match(use.ref, /^[0-9a-f]{40}$/, `${use.action} is not pinned`);
    const pin = resolved.find((entry) => entry.action === use.action);
    assert.ok(pin, `UNAPPROVED_ACTION:${use.action}`);
    assert.equal(use.ref, pin.resolvedCommit, `ACTION_PIN_MISMATCH:${use.action}`);
  }
  for (const pin of resolved) {
    assert.ok(
      workflowUses.some((use) => use.action === pin.action && use.ref === pin.resolvedCommit),
      `ACTION_PIN_NOT_USED:${pin.action}`,
    );
  }
}

const report = {
  schemaVersion: "p24b-rc2-action-pin-verification-v1",
  generatedAt: new Date().toISOString(),
  resolutionMethod: "git-ls-remote-official-github-repository",
  workflowPath: workflowPath || null,
  workflowValidated: Boolean(workflowPath),
  workflowUses,
  actions: resolved,
  pass: resolved.length,
  fail: 0,
  skip: 0,
  status: "PASS",
};
if (reportPath) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(report));
