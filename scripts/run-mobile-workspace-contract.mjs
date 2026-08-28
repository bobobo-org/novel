import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const conversationShell = read("app/studio/project/[projectId]/chat/components/conversation-shell.tsx");
const conversationCss = read("app/studio/project/[projectId]/chat/conversation.module.css");
const learningCss = read("app/studio/project/[projectId]/learning/learning.module.css");
const dramaCss = read("app/studio/project/[projectId]/drama/drama.module.css");

assert.match(conversationShell, /viewport\?\.offsetTop \?\? 0/u);
assert.match(conversationShell, /--conversation-visual-top/u);
assert.doesNotMatch(conversationShell, /window\.scrollTo\(0,\s*0\)/u);
assert.doesNotMatch(conversationShell, /shell\.scrollTo\(0,\s*0\)/u);
assert.doesNotMatch(conversationShell, /window\.addEventListener\("scroll",\s*syncVisualViewport/u);
assert.match(
  conversationCss,
  /@media \(max-width: 900px\)[\s\S]*?\.shell\s*\{[\s\S]*?top:\s*var\(--conversation-visual-top,\s*0px\)[\s\S]*?height:\s*var\(--conversation-visual-height,\s*100dvh\)/u,
);

const learningMobileStart = learningCss.lastIndexOf("@media (max-width: 640px)");
assert.notEqual(learningMobileStart, -1);
const learningMobile = learningCss.slice(learningMobileStart);
assert.match(learningMobile, /\.researchSummaryGrid,[\s\S]*?\.mechanismGrid\s*\{\s*grid-template-columns:\s*1fr/u);
assert.match(learningMobile, /\.panel button,[\s\S]*?min-height:\s*44px/u);
assert.match(learningMobile, /\.manualTeacherRelay summary,[\s\S]*?\.storyResearchReport summary[\s\S]*?min-height:\s*44px/u);
assert.match(learningMobile, /\.ruleList,[\s\S]*?\.sourceList\s*\{[\s\S]*?max-height:\s*none[\s\S]*?overflow:\s*visible/u);
assert.match(learningMobile, /padding:\s*14px 14px calc\(96px \+ env\(safe-area-inset-bottom\)\)/u);
assert.match(learningMobile, /bottom:\s*max\(12px,\s*env\(safe-area-inset-bottom\)\)/u);

assert.match(dramaCss, /\.root select,\.root button\{min-height:44px/u);
assert.match(dramaCss, /\.root a\{[^}]*min-height:44px/u);
assert.match(dramaCss, /\.root summary\{[^}]*min-height:44px/u);
assert.match(dramaCss, /\.dramaShotTimeline\) article\{[^}]*content-visibility:auto;contain-intrinsic-size:auto 320px/u);
assert.match(dramaCss, /\.dramaShotTimeline\) input\{[^}]*min-height:44px/u);
assert.match(dramaCss, /\.dramaVideoConsents\) label\{[^}]*min-height:44px/u);

console.log("PASS mobile workspace keyboard, learning and drama contract");
