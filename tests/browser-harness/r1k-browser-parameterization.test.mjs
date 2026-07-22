import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scripts = await Promise.all([
  "scripts/r5-2-desktop/run-automated-native-grant.ps1",
  "scripts/r5-2-desktop/run-automated-native-deny.ps1",
].map(async (file) => ({ file, source: await readFile(file, "utf8") })));

let pass = 0;
for (const { file, source } of scripts) {
  assert.match(source, /ValidateSet\("chrome", "edge"\)/);
  pass += 1;
  assert.match(source, /msedge\.exe/);
  pass += 1;
  assert.match(source, /Microsoft\\Edge\\Application\\msedge\.exe/);
  pass += 1;
  assert.match(source, /"--browser", \$browserKey/);
  pass += 1;
  assert.match(source, /browser = \$browserKey/);
  pass += 1;
  assert.doesNotMatch(source, /"--browser", "chrome"/);
  pass += 1;
  assert.doesNotMatch(source, /\$runId = "chrome-(?:grant|deny)-"/);
  pass += 1;
  console.log(`${file}: PASS`);
}

console.log(JSON.stringify({ suite: "r1k-browser-parameterization", pass, fail: 0, skip: 0 }));
