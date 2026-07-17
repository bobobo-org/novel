import fs from "node:fs";
import { execSync } from "node:child_process";

const releaseTag = "novel-ai-h2w3-static-html-consistency-fix";

if (process.env.VERCEL !== "1" && process.env.NOVEL_STATIC_STAMP !== "1") {
  console.log("Skipping static release stamping outside deployment.");
  process.exit(0);
}

function resolveCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.NOVEL_STATIC_APP_COMMIT) return process.env.NOVEL_STATIC_APP_COMMIT;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
}

const appCommit = resolveCommit();

const replacements = new Map([
  ["__NOVEL_STATIC_APP_COMMIT__", appCommit],
  ["__NOVEL_STATIC_RELEASE_TAG__", releaseTag],
]);

for (const file of [
  "public/legacy/novel-system.html",
  "public/legacy/novel-whole-novel-workspace.js",
]) {
  let text = fs.readFileSync(file, "utf8");
  for (const [needle, value] of replacements) text = text.split(needle).join(value);
  fs.writeFileSync(file, text);
}
