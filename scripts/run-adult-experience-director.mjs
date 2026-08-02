import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ADULT_EXPERIENCE_PROFILE_VERSION,
  createAdultExperienceProfile,
  normalizeAdultExperienceProfile,
} from "../lib/novel-data/adult-experience-profile.ts";

const [studio, canonical] = await Promise.all([
  readFile(new URL("../app/studio/studio-client.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/repository/studio-canonical.ts", import.meta.url), "utf8"),
]);

const fallback = createAdultExperienceProfile();
assert.equal(fallback.version, ADULT_EXPERIENCE_PROFILE_VERSION);
assert.equal(fallback.fictionalAdultsConfirmed, false);
assert.equal(fallback.consentContinuityRequired, true);
assert.equal(fallback.realPersonLikenessBlocked, true);

const normalized = normalizeAdultExperienceProfile({
  visualStyle: "anime",
  genderPresentation: "nonbinary",
  personality: "  慢熱、機敏  ",
  pinnedMemories: ["共同承諾", "", "  第一次見面的雨夜  "],
  interactionMode: "ensemble",
  consentContinuityRequired: false,
  realPersonLikenessBlocked: false,
});
assert.equal(normalized.visualStyle, "anime");
assert.equal(normalized.personality, "慢熱、機敏");
assert.deepEqual(normalized.pinnedMemories, ["共同承諾", "第一次見面的雨夜"]);
assert.equal(normalized.interactionMode, "ensemble");
assert.equal(normalized.consentContinuityRequired, true);
assert.equal(normalized.realPersonLikenessBlocked, true);

assert.match(studio, /data-testid="studio-adult-character-director"/u);
assert.match(studio, /外觀・個性・聲音・關係・記憶・群像/u);
assert.match(studio, /data-testid="studio-adult-fictional-confirmation"/u);
assert.match(studio, /不接受真人仿貌/u);
assert.match(studio, /成人模式只接受明確成年、虛構且可撤回同意的角色/u);
assert.match(canonical, /adultExperienceProfile/u);

console.log(JSON.stringify({
  suite: "ADULT_EXPERIENCE_DIRECTOR",
  status: "PASS",
  assertions: 15,
  profileVersion: ADULT_EXPERIENCE_PROFILE_VERSION,
}, null, 2));
