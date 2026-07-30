import OpenCC from "opencc-js/cn2t";

const toTaiwanTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

export function normalizeTraditionalChinese(value: string) {
  return toTaiwanTraditional(value);
}

const ROLE_PREFIXES = [
  "守衛",
  "隊長",
  "城主",
  "國王",
  "女王",
  "皇帝",
  "皇后",
  "王子",
  "公主",
  "醫師",
  "醫生",
  "老師",
  "教授",
  "警官",
  "偵探",
] as const;

function normalizeNameCandidate(value: string) {
  let candidate = value.trim();
  for (const prefix of ROLE_PREFIXES) {
    if (candidate.startsWith(prefix) && candidate.length > prefix.length + 1) {
      candidate = candidate.slice(prefix.length);
      break;
    }
  }
  return /^[\p{Script=Han}·]{2,12}$/u.test(candidate)
    ? candidate
    : null;
}

/**
 * Extracts only high-confidence character-name shapes from author-provided
 * context. This is intentionally conservative: a missed name is preferable to
 * protecting arbitrary simplified prose from conversion.
 */
export function extractProtectedProperNouns(source: string) {
  const names = new Set<string>();
  const add = (value: string | undefined) => {
    const candidate = value ? normalizeNameCandidate(value) : null;
    if (candidate) names.add(candidate);
  };

  for (const match of source.matchAll(
    /(?:姓名|主角|配角|角色名|人物名)[：:\s]+([\p{Script=Han}·]{2,12})/gu,
  )) {
    add(match[1]);
  }
  for (const match of source.matchAll(
    /(?:角色名|人物名)(?:為|是)?\s*([\p{Script=Han}·]{2,12})(?=[，。；、！？\s]|$)/gu,
  )) {
    add(match[1]);
  }
  for (const match of source.matchAll(
    /([\p{Script=Han}·]{2,12})[；;](?=(?:身分|身份|性格|目標|目标|職業|职业)[：:])/gu,
  )) {
    add(match[1]);
  }
  for (const match of source.matchAll(
    /([\p{Script=Han}·]{2,4})[與和及、]([\p{Script=Han}·]{2,4})(?=(?:在|於|的|說|問|答|道|喊|想|看|走|得知|抵達|尚|仍|，|。|！|？|；|\s|$))/gu,
  )) {
    add(match[1]);
    add(match[2]);
  }
  for (const match of source.matchAll(
    /(?:^|[，。！？；\s「『])([\p{Script=Han}·]{2,6})(?=(?:說|問|答|道|喊|想|看|走|笑|哭|點頭|搖頭|得知|抵達|尚|仍|在|的))/gu,
  )) {
    add(match[1]);
  }
  return [...names];
}

export function normalizeTraditionalChinesePreservingProperNouns(
  value: string,
  source: string,
) {
  const protectedTerms = extractProtectedProperNouns(source)
    .filter((term) => value.includes(term))
    .sort((left, right) => right.length - left.length);
  if (!protectedTerms.length) return normalizeTraditionalChinese(value);

  const replacements: Array<{ placeholder: string; term: string }> = [];
  let masked = value;
  for (const [index, term] of protectedTerms.entries()) {
    const placeholder = `\uE000NOVELNAME${index.toString(36)}\uE001`;
    if (!masked.includes(term)) continue;
    replacements.push({ placeholder, term });
    masked = masked.split(term).join(placeholder);
  }
  let converted = normalizeTraditionalChinese(masked);
  for (const { placeholder, term } of replacements) {
    converted = converted.split(placeholder).join(term);
  }
  return converted;
}

export function containsConvertibleSimplifiedChinese(
  value: string,
  protectedSource = "",
) {
  return (
    protectedSource
      ? normalizeTraditionalChinesePreservingProperNouns(value, protectedSource)
      : normalizeTraditionalChinese(value)
  ) !== value;
}

export function containsProtectedProperNounDrift(
  value: string,
  protectedSource: string,
) {
  const protectedTerms = extractProtectedProperNouns(protectedSource);
  const protectedSet = new Set(protectedTerms);
  return protectedTerms.some((term) => {
    const converted = normalizeTraditionalChinese(term);
    return converted !== term
      && !protectedSet.has(converted)
      && value.includes(converted);
  });
}
