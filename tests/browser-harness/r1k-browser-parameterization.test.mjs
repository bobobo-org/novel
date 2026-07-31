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
  assert.doesNotMatch(source, /RootElement\.FindAll/);
  pass += 1;
  assert.match(source, /\$windowElement\.FindAll/);
  pass += 1;
  console.log(`${file}: PASS`);
}

const grantSource = scripts.find(({ file }) => file.endsWith("run-automated-native-grant.ps1"))?.source ?? "";
assert.match(grantSource, /\$elementName\.StartsWith\(\$_, \[StringComparison\]::Ordinal\)/);
pass += 1;
assert.match(grantSource, /\$sixDigitCodeName/);
pass += 1;

console.log(JSON.stringify({ suite: "r1k-browser-parameterization", pass, fail: 0, skip: 0 }));
