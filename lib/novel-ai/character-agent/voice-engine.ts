import { clampScore } from "./record-factory";
import type { CharacterAgentProfile, VoiceDriftReport } from "./types";

function averageSentenceLength(line: string) {
  const sentences = line.split(/[。！？!?]+/u).map((item) => item.trim()).filter(Boolean);
  if (!sentences.length) return line.length;
  return sentences.reduce((sum, sentence) => sum + sentence.length, 0) / sentences.length;
}

export function evaluateVoiceDrift(profile: CharacterAgentProfile, line: string): VoiceDriftReport {
  const issues: string[] = [];
  const avg = averageSentenceLength(line);
  if (profile.voiceProfile.sentenceLength === "short" && avg > 28) issues.push("句子長度超過角色慣用的短句。");
  if (profile.voiceProfile.sentenceLength === "long" && avg < 8) issues.push("句子明顯短於角色慣用表達。");
  const avoided = profile.voiceProfile.avoidedPhrases.filter((phrase) => phrase && line.includes(phrase));
  if (avoided.length) issues.push(`使用角色避用詞：${avoided.join("、")}`);
  const addressRequired = profile.voiceProfile.preferredAddressTerms.length > 0;
  if (addressRequired && !profile.voiceProfile.preferredAddressTerms.some((term) => line.includes(term))) {
    issues.push("沒有使用角色慣用稱謂。");
  }
  if (profile.voiceProfile.formality >= 70 && /欸|啦|喔|嘛/u.test(line)) issues.push("語氣比角色設定更口語。");
  if (profile.voiceProfile.directness >= 70 && /也許|可能吧|不知道/u.test(line)) issues.push("表達比角色設定更迂迴。");
  const score = clampScore(100 - issues.length * 22, 0, 100);
  return {
    score,
    reason: issues.length ? issues.join(" ") : "稱謂、句長、用詞與正式程度符合目前角色語氣。",
    conflictingEvidence: issues.length ? profile.voiceProfile.sourceReferences : [],
    suggestedRevision: issues.length ? "依角色慣用句長、稱謂與正式程度重新措辭。" : null,
  };
}

export function voiceSimilarity(left: CharacterAgentProfile, right: CharacterAgentProfile) {
  const numericDistance = (
    Math.abs(left.voiceProfile.formality - right.voiceProfile.formality)
    + Math.abs(left.voiceProfile.directness - right.voiceProfile.directness)
    + Math.abs(left.voiceProfile.emotionalExpressiveness - right.voiceProfile.emotionalExpressiveness)
  ) / 3;
  const patterns = new Set(left.voiceProfile.speechPatterns);
  const sharedPatterns = right.voiceProfile.speechPatterns.filter((pattern) => patterns.has(pattern)).length;
  const denominator = Math.max(1, new Set([...left.voiceProfile.speechPatterns, ...right.voiceProfile.speechPatterns]).size);
  return clampScore(100 - numericDistance - (1 - sharedPatterns / denominator) * 35, 0, 100);
}
