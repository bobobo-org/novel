import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("artifacts/closed-ai-phase1-1r5-2r1j-evidence-utf8");
const inputPath = path.join(root, "input.json");
const outputPath = path.join(root, "output.json");
const readerPath = path.resolve("scripts/r5-2-desktop/evidence-json.ps1");
const roundtripPath = path.resolve("tests/browser-harness/r5-2r1j-evidence-utf8-roundtrip.ps1");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const fixture = {
  traditionalChinese: "諸天萬界小說生成系統，角色在雨夜作出選擇。",
  lineEndings: "第一行\r\n第二行\n第三行",
  quoted: "他說：\"不要覆蓋原稿。\"",
  backslash: "C:\\作品\\章節\\第一章.txt",
  emoji: "星火✨ 劍⚔️ 完成✅",
  replacementCharacter: "前段\uFFFD後段",
  modelOutput: {
    model: "qwen2.5:3b",
    source: "local_ollama",
    text: "本機模型輸出包含繁體中文、\n多行錯誤訊息：\nERR \\ path \"quoted\"。",
  },
  uiTextAfterDecision: Array.from({ length: 600 }, (_, index) =>
    `第${index + 1}段：角色沿著世界規則推進；保留引號\"、反斜線\\與 emoji 🌌。`,
  ).join("\n"),
};

await writeFile(inputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
const inputBytes = await readFile(inputPath);
assert.notDeepEqual([...inputBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "input must be UTF-8 without BOM");

execFileSync("powershell.exe", [
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", roundtripPath,
  "-InputPath", inputPath,
  "-OutputPath", outputPath,
  "-ReaderPath", readerPath,
], { stdio: "pipe" });

const outputBytes = await readFile(outputPath);
assert.notDeepEqual([...outputBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "output must be UTF-8 without BOM");
const parsed = JSON.parse(outputBytes.toString("utf8"));
assert.deepEqual(parsed, fixture);

const result = {
  schemaVersion: "r5-2r1j-evidence-utf8-test-v1",
  status: "PASS",
  powershellVersion: "5.1",
  cases: ["traditional Chinese", "CRLF and LF", "quotes", "backslashes", "emoji", "long UI text", "model output", "replacement character", "UTF-8 without BOM"],
  inputBytes: inputBytes.length,
  outputBytes: outputBytes.length,
  semanticEquality: true,
};
await writeFile(path.join(root, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result));
