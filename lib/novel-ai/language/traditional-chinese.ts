import OpenCC from "opencc-js/cn2t";
import { sha256Hex, stableStringify } from "../closed-ai-cache";

const toTaiwanTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

export const TRADITIONAL_CHINESE_NORMALIZATION_POLICY_VERSION =
  "closed-agent-traditional-chinese-policy-v3-boundary-identity-occurrences" as const;
export const TRADITIONAL_CHINESE_NORMALIZER_VERSION =
  "opencc-js-1.4.1-cn-to-tw-single-pass-v1" as const;
export const TRADITIONAL_CHINESE_INTEGRITY_SCHEMA_VERSION =
  "closed-agent-traditional-chinese-integrity-v2-ambiguous-occurrences" as const;

const MAX_PROTECTED_TERMS = 64;
const MAX_PROTECTED_TERM_CHARACTERS = 512;
const CRYPTOGRAPHIC_DIGEST = /^[a-f0-9]{64}$/u;
const INTEGRITY_RECEIPT_ID = /^traditional-chinese-integrity:[a-f0-9]{64}$/u;
const INTEGRITY_PROVIDER_IDS = new Set([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
] as const);

function hasBoundedIdentifier(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 192;
}

function hasValidModelIdentity(modelId: unknown, modelDigest: unknown) {
  return modelId === null && modelDigest === null
    || hasBoundedIdentifier(modelId)
      && typeof modelDigest === "string"
      && CRYPTOGRAPHIC_DIGEST.test(modelDigest);
}


export type TraditionalChineseNormalizationPolicy = {
  policyVersion: typeof TRADITIONAL_CHINESE_NORMALIZATION_POLICY_VERSION;
  policyId: string;
  sourceDigest: string;
  protectedTermsDigest: string;
  /** Ephemeral normalization input. Never persist this list or expose it to UI telemetry. */
  protectedTerms: string[];
  /** Ephemeral occurrence policy aligned by index with `protectedTerms`. */
  protectedTermModes: TraditionalChineseProtectedTermMode[];
  /** Ephemeral unregistered active-chapter anchors; evaluator-only, never masked. */
  continuityTerms: string[];
};

export type TraditionalChineseProtectedTermMode =
  | "global-unambiguous"
  | "identity-bound-ambiguous";

export type TraditionalChineseIntegrityStage =
  "closed-agent-final-selected-content";

export type TraditionalChineseNormalizationIntegrityRecord = {
  schemaVersion: typeof TRADITIONAL_CHINESE_INTEGRITY_SCHEMA_VERSION;
  normalizerVersion: typeof TRADITIONAL_CHINESE_NORMALIZER_VERSION;
  policyVersion: typeof TRADITIONAL_CHINESE_NORMALIZATION_POLICY_VERSION;
  policyId: string;
  sourceDigest: string;
  protectedTermsDigest: string;
  /** The task that performed the one normalization operation. Cache reuse keeps this origin. */
  originRequestId: string;
  providerId: string;
  modelId: string | null;
  modelDigest: string | null;
  inputStage: TraditionalChineseIntegrityStage;
  normalizationInputDigest: string;
  outputDigest: string;
  normalizationOperationCount: 1;
  /** Bounded count of convertible two-Han canonical terms in ambiguous subject positions. */
  ambiguousCanonicalOccurrenceCount: number;
  receiptId: string;
};

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

const IDENTITY_OCCURRENCE_ROLE_PREFIXES = [
  ...ROLE_PREFIXES,
  "鑄劍師",
  "主角",
  "配角",
  "少年",
  "少女",
  "青年",
  "女子",
  "男子",
  "女孩",
  "男孩",
  "妹妹",
  "哥哥",
  "姐姐",
  "弟弟",
] as const;

const IDENTITY_OCCURRENCE_PREFIXES = [
  "看見",
  "看见",
  "望見",
  "望见",
  "遇見",
  "遇见",
  "遇到",
  "叫住",
  "拉住",
  "尋找",
  "寻找",
  "等待",
  "問候",
  "问候",
  "對",
  "对",
  "向",
  "跟",
  "陪",
] as const;

const IDENTITY_OCCURRENCE_SUFFIX = /^(?:說|说|問|问|答|道|喊|叫|開口|开口|低語|低语|走|看|笑|哭|點頭|点头|搖頭|摇头|抬頭|抬头|轉身|转身|回頭|回头|站|坐|來|来|去|握|拿|推|拉|望|聽|听|踏|伸|停|[:：])/u;
const IDENTITY_OCCURRENCE_RIGHT_BOUNDARY = /^(?:$|[\s，,。！？!?；;：:」』）)]|的|忽然|突然|說|说|問|问|答|道|喊|叫|開口|开口|低語|低语|走|看|笑|哭|點頭|点头|搖頭|摇头|抬頭|抬头|轉身|转身|回頭|回头|站|坐|來|来|去|握|拿|推|拉|望|聽|听|踏|伸|停|在|決定|决定)/u;
const IDENTITY_OCCURRENCE_LEFT_BOUNDARY = /(?:^|[\s「『（(，。！？；：])$/u;
const IDENTITY_OCCURRENCE_VOCATIVE = /^(?:[，,!！?？:：」』])/u;
const EXPLICIT_COMMON_NOUN_PREFIXES = [
  "這個",
  "这个",
  "那個",
  "那个",
  "一個",
  "一个",
  "某個",
  "某个",
  "每個",
  "每个",
  "整個",
  "整个",
  "這座",
  "这座",
  "那座",
  "一座",
  "某座",
  "每座",
] as const;
const EXPLICIT_COMMON_TWO_HAN_PREFIXES = new Map<string, readonly string[]>([
  ["开心", ["很", "非常", "十分", "格外", "感到", "覺得", "觉得", "變得", "变得"]],
  ["国王", ["見到", "见到", "拜見", "拜见", "擁立", "拥立"]],
  ["长城", ["到", "來到", "来到", "登上", "望向", "修築", "修筑"]],
  ["万里", ["走了", "行了", "相隔", "遠隔", "远隔", "距離", "距离", "綿延", "绵延"]],
]);

function hasExplicitCommonNounContext(value: string, start: number, term: string) {
  const before = value.slice(Math.max(0, start - 16), start);
  const after = value.slice(start + term.length, start + term.length + 8);
  return EXPLICIT_COMMON_NOUN_PREFIXES.some((prefix) => before.endsWith(prefix))
    || EXPLICIT_COMMON_TWO_HAN_PREFIXES.get(term)?.some(
      (prefix) => before.endsWith(prefix),
    ) === true
    || (term === "万里" && /^(?:長城|长城)/u.test(after));
}

function isProtectedIdentityOccurrence(
  value: string,
  start: number,
  term: string,
) {
  const before = value.slice(Math.max(0, start - 16), start);
  const after = value.slice(start + term.length, start + term.length + 8);
  const hasLeftIdentityBoundary = IDENTITY_OCCURRENCE_LEFT_BOUNDARY.test(before);
  const hasIdentityPrefix =
    IDENTITY_OCCURRENCE_ROLE_PREFIXES.some((prefix) => before.endsWith(prefix))
    || IDENTITY_OCCURRENCE_PREFIXES.some((prefix) => before.endsWith(prefix));
  const isTwoHanTerm = /^[\p{Script=Han}]{2}$/u.test(term);
  const hasUnambiguousLeftContext = hasIdentityPrefix
    || (hasLeftIdentityBoundary && !isTwoHanTerm);
  return (
      hasUnambiguousLeftContext
      && IDENTITY_OCCURRENCE_SUFFIX.test(after)
    )
    || (
      IDENTITY_OCCURRENCE_RIGHT_BOUNDARY.test(after)
      && hasUnambiguousLeftContext
    )
    || (
      hasLeftIdentityBoundary
      && IDENTITY_OCCURRENCE_VOCATIVE.test(after)
    );
}

function protectedIdentityRanges(
  value: string,
  terms: readonly string[],
  modes: readonly TraditionalChineseProtectedTermMode[] = terms.map(
    () => "global-unambiguous" as const,
  ),
) {
  const candidates: Array<{ start: number; end: number }> = [];
  const entries = terms.flatMap((term, index) => {
    const mode = modes[index];
    return normalizeCanonicalNameCandidate(term)
      && (mode === "global-unambiguous" || mode === "identity-bound-ambiguous")
      ? [{ term, mode }]
      : [];
  }).sort((left, right) => (
    right.term.length - left.term.length || compareUnicode(left.term, right.term)
  ));
  for (const { term, mode } of entries) {
    let start = value.indexOf(term);
    while (start >= 0) {
      if (
        mode === "global-unambiguous"
        || isProtectedIdentityOccurrence(value, start, term)
      ) {
        candidates.push({ start, end: start + term.length });
      }
      start = value.indexOf(term, start + 1);
    }
  }
  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const selected: Array<{ start: number; end: number }> = [];
  for (const candidate of candidates) {
    const previous = selected.at(-1);
    if (previous && candidate.start < previous.end) continue;
    selected.push(candidate);
  }
  return selected;
}

function countAmbiguousCanonicalOccurrences(
  value: string,
  terms: readonly string[],
  modes: readonly TraditionalChineseProtectedTermMode[],
) {
  let count = 0;
  for (const [index, term] of terms.entries()) {
    if (
      modes[index] !== "identity-bound-ambiguous"
      || !/^[\p{Script=Han}]{2}$/u.test(term)
      || normalizeTraditionalChinese(term) === term
    ) continue;
    let start = value.indexOf(term);
    while (start >= 0 && count < MAX_PROTECTED_TERMS) {
      if (
        !isProtectedIdentityOccurrence(value, start, term)
        && !hasExplicitCommonNounContext(value, start, term)
      ) count += 1;
      start = value.indexOf(term, start + 1);
    }
  }
  return count;
}

function normalizeCanonicalNameCandidate(value: string) {
  const candidate = value.trim();
  return /^[\p{Script=Han}·]{2,12}$/u.test(candidate)
    ? candidate
    : null;
}

const DISALLOWED_CANONICAL_IDENTITY_TERMS = new Set([
  "我们",
  "我們",
  "你们",
  "你們",
  "他们",
  "他們",
  "她们",
  "她們",
  "它们",
  "它們",
  "众人",
  "眾人",
  "有人",
  "大家",
  "这是",
  "這是",
]);

function normalizeNameCandidate(value: string) {
  let candidate = value.trim();
  for (const prefix of ROLE_PREFIXES) {
    if (candidate.startsWith(prefix) && candidate.length > prefix.length + 1) {
      candidate = candidate.slice(prefix.length);
      break;
    }
  }
  if (
    /^(?:这|這|那|此|有人|眾人|众人|我|你|您|他|她|它|不|仍|尚|當|当)/u.test(candidate)
    || /(?:在|的|仍|開始|开始|繼續|继续|創作|创作|請寫|请写|續章|续章|正文|章節|章节|第一|長城|长城|國開|国开|圍開|围开|興起|兴起|起來|起来)/u.test(candidate)
    || /(?:說|说|道|問|问|答|喊|叫|在|的|仍|尚)$/u.test(candidate)
  ) return null;
  return normalizeCanonicalNameCandidate(candidate);
}

/**
 * Extracts only high-confidence character-name shapes from author-provided
 * context. This is intentionally conservative: a missed name is preferable to
 * protecting arbitrary simplified prose from conversion.
 */
function structuredSourceSegments(source: string) {
  const normalized = source.replace(/\r\n?/gu, "\n").trim();
  const tagged = normalized.match(/^\[active[_-]chapter\]\s*([\s\S]+)$/iu);
  if (!tagged?.[1]) return [{ text: source, highConfidenceOnly: false }];
  try {
    const record = JSON.parse(tagged[1]) as {
      title?: unknown;
      content?: unknown;
      summary?: unknown;
    };
    return [
      typeof record.title === "string" ? record.title : "",
      typeof record.content === "string" ? record.content : "",
      typeof record.summary === "string" ? record.summary : "",
    ].filter(Boolean).map((text) => ({ text, highConfidenceOnly: true }));
  } catch {
    return [{ text: source, highConfidenceOnly: false }];
  }
}

function extractHighConfidenceNarrativeNames(source: string, names: Set<string>) {
  for (const match of source.matchAll(
    /(?:^|[\s「『（(，。！？；：])([\p{Script=Han}]{2,4}?)(?=(?:說|说|問|问|答|道|喊|叫|開口|开口|低語|低语))/gu,
  )) {
    const candidate = match[1] ? normalizeNameCandidate(match[1]) : null;
    if (candidate) names.add(candidate);
  }
}

function extractProtectedProperNounsFromSegment(source: string, names: Set<string>) {
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
}

export function extractProtectedProperNouns(source: string) {
  const names = new Set<string>();
  for (const segment of structuredSourceSegments(source)) {
    if (segment.highConfidenceOnly) {
      extractHighConfidenceNarrativeNames(segment.text, names);
    } else {
      extractProtectedProperNounsFromSegment(segment.text, names);
    }
  }
  return [...names];
}

function compareUnicode(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function extractExplicitProtectedProperNouns(source: string) {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /(?:主角姓名|人物姓名|角色名|姓名|名字|角色)\s*[:：]\s*([\p{Script=Han}]{2,4}|[\p{Script=Han}]{1,5}·[\p{Script=Han}·]{1,6})(?=[，。；、！？\s]|$)/gu,
  )) {
    const rawCandidate = match[1]?.trim() ?? "";
    const plainCharacters = Array.from(rawCandidate);
    const plausiblePlainName = plainCharacters.length >= 2
      && plainCharacters.length <= 4
      && !/(?:開始|开始|繼續|继续|創作|创作|請寫|请写|續章|续章|正文|章節|章节|第一|長城|长城|國開|国开|圍開|围开|興起|兴起|起來|起来|我們|我们|你們|你们)/u.test(
        rawCandidate,
      );
    const candidate = rawCandidate.includes("·") || plausiblePlainName
      ? normalizeNameCandidate(rawCandidate)
      : null;
    if (candidate) names.add(candidate);
  }
  return [...names];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addCanonicalName(names: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const candidate = normalizeCanonicalNameCandidate(value);
  if (candidate && !DISALLOWED_CANONICAL_IDENTITY_TERMS.has(candidate)) {
    names.add(candidate);
  }
}

function addCanonicalAliases(names: Set<string>, value: unknown) {
  if (typeof value === "string") {
    addCanonicalName(names, value);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const alias of value) addCanonicalName(names, alias);
}

function extractCanonicalContextNames(source: string) {
  const names = new Set<string>();
  const tagged = source.replace(/\r\n?/gu, "\n").trim()
    .match(/^\[(CHARACTERS|CANONICAL_CHARACTER_IDENTITIES|PROJECT_SEED)\]\s*([\s\S]+)$/u);
  if (!tagged?.[1] || !tagged[2]) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(tagged[2]);
  } catch {
    return [];
  }
  if (
    tagged[1] === "CHARACTERS"
    || tagged[1] === "CANONICAL_CHARACTER_IDENTITIES"
  ) {
    const characters = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.characters)
        ? parsed.characters
        : [];
    for (const character of characters) {
      if (!isRecord(character)) continue;
      addCanonicalName(names, character.name);
    }
    for (const character of characters) {
      if (!isRecord(character)) continue;
      addCanonicalAliases(names, character.aliases);
    }
  } else if (isRecord(parsed)) {
    const protagonist = parsed.protagonist;
    if (typeof protagonist === "string") {
      addCanonicalName(names, protagonist);
    } else if (isRecord(protagonist)) {
      addCanonicalName(names, protagonist.value);
      addCanonicalName(names, protagonist.name);
      addCanonicalAliases(names, protagonist.aliases);
    }
  }
  return [...names];
}

const COMMON_CHARACTER_SURNAMES = "趙钱錢孫孙李周吳吴鄭郑王馮冯陳陈褚衛卫蔣蒋沈韓韩楊杨朱秦尤許许何呂吕施張张孔曹嚴严華华金魏陶姜戚謝谢鄒邹喻柏水竇窦章雲云蘇苏潘葛奚范彭郎魯鲁韋韦昌馬马苗鳳凤花方俞任袁柳鮑鲍史唐費费廉岑薛雷賀贺倪湯汤滕殷羅罗畢毕郝鄔邬安常樂乐于時时傅皮卞齊齐康伍余元卜顧顾孟平黃黄和穆蕭萧尹姚邵汪祁毛禹狄米貝贝明臧計计伏成戴談谈宋茅龐庞熊紀纪舒屈項项祝董梁杜阮藍蓝閔闵席季麻強强賈贾路婁娄危江童顏颜郭梅盛林刁鍾钟徐邱駱骆高夏蔡田樊胡凌霍虞萬万支柯盧卢莫房裘繆缪解應应宗丁宣鄧邓郁單单杭洪包諸诸左石崔吉龔龚程嵇邢滑裴陸陆榮荣翁荀羊甄曲封芮羿儲储靳汲邴糜松井段富巫烏乌焦巴弓牧隗山谷車车侯宓蓬全郗班仰秋仲伊宮宫寧宁仇欒栾暴甘鈄钭厲厉戎祖武符劉刘景詹束龍龙葉叶幸司韶郜黎薊蓟薄印宿白懷怀蒲邰從从鄂索咸籍賴赖卓藺蔺屠蒙池喬乔陰阴鬱郁胥蒼苍雙双聞闻莘黨党翟譚谭貢贡勞劳逄姬申扶堵冉宰酈郦雍卻却璩桑桂濮牛壽寿通邊边扈燕冀郟郏浦尚農农溫温別别莊庄晏柴瞿閻阎充慕連连茹習习宦艾魚鱼容向古易慎戈廖庾終终暨居衡步都耿滿满弘匡國国文寇廣广祿禄闕阙東东歐欧殳沃利蔚越夔隆師师鞏巩厙厍聶聂晁勾敖融冷訾辛闞阚那簡简饒饶空曾毋沙乜養养鞠須须豐丰巢關关蒯相查後后荊荆紅红游竺權权逯蓋盖益桓公";
const ACTIVE_IDENTITY_ACTION = "說|说|問|问|答|道|喊|叫|開口|开口|低語|低语|走|看|笑|哭|點頭|点头|搖頭|摇头|抬頭|抬头|轉身|转身|回頭|回头|站|坐|來|来|去|握|拿|推|拉|望|聽|听|踏|伸|停";
const ACTIVE_ROLE_PREFIX_PATTERN = [...IDENTITY_OCCURRENCE_ROLE_PREFIXES]
  .sort((left, right) => right.length - left.length)
  .join("|");
const ACTIVE_ROLE_NAME_PATTERN = new RegExp(
  `(?:${ACTIVE_ROLE_PREFIX_PATTERN})([\\p{Script=Han}]{2,4}?)(?=(?:${ACTIVE_IDENTITY_ACTION}))`,
  "gu",
);
const ACTIVE_SURNAME_NAME_PATTERN = new RegExp(
  `(?:^|[\\s「『（(，。！？；：])([${COMMON_CHARACTER_SURNAMES}][\\p{Script=Han}]{1,3}?)(?=(?:${ACTIVE_IDENTITY_ACTION}))`,
  "gu",
);

function extractActiveChapterContextNames(source: string) {
  const normalized = source.replace(/\r\n?/gu, "\n").trim();
  const tagged = normalized.match(
    /^\[(ACTIVE_CHAPTER|active[_-]chapter|current-chapter)\]\s*([\s\S]+)$/u,
  );
  if (!tagged?.[1] || !tagged[2]) return [];
  let segments: string[] = [];
  if (/^active[_-]chapter$/iu.test(tagged[1])) {
    try {
      const parsed = JSON.parse(tagged[2]);
      if (isRecord(parsed)) {
        segments = [parsed.title, parsed.content, parsed.summary]
          .filter((value): value is string => typeof value === "string");
      }
    } catch {
      return [];
    }
  } else {
    segments = [tagged[2]];
  }
  const names = new Set<string>();
  for (const segment of segments) {
    for (const pattern of [ACTIVE_ROLE_NAME_PATTERN, ACTIVE_SURNAME_NAME_PATTERN]) {
      pattern.lastIndex = 0;
      for (const match of segment.matchAll(pattern)) {
        const candidate = match[1] ? normalizeNameCandidate(match[1]) : null;
        if (candidate) names.add(candidate);
      }
    }
  }
  return [...names];
}

function protectedTermMode(term: string): TraditionalChineseProtectedTermMode {
  // A canonical record authorizes a name, not every matching substring in
  // ordinary prose. Any spelling that OpenCC can change therefore needs a
  // finite identity-shaped occurrence before it may be copied unchanged.
  return normalizeTraditionalChinese(term) === term
    ? "global-unambiguous"
    : "identity-bound-ambiguous";
}

function boundedProtectedTerms(input: {
  objective: string;
  contextSources: readonly {
    id: string;
    kind: string;
    text: string;
    composerAuthority?: string;
    canonicalIdentitySource?: string;
  }[];
}) {
  // Free-form prose is never mined for names. Only explicit author labels and
  // allowlisted canonical identity fields may create normalization exceptions.
  const candidates = [
    ...input.contextSources.flatMap((item) => {
      if (item.composerAuthority !== "project-context-composer-v1") return [];
      if (
        item.kind === "canon"
        && item.canonicalIdentitySource === "characters"
        && /^(?:canonical-character-identities|characters):/u.test(item.id)
      ) {
        return extractCanonicalContextNames(item.text).map((term) => ({
          term,
          mode: protectedTermMode(term),
        }));
      }
      if (
        item.kind === "canon"
        && item.canonicalIdentitySource === "project-seed"
        && item.id.startsWith("seed:")
      ) {
        return extractCanonicalContextNames(item.text).map((term) => ({
          term,
          mode: protectedTermMode(term),
        }));
      }
      return [];
    }),
  ];
  const continuityCandidates = [
    ...extractExplicitProtectedProperNouns(input.objective),
    ...input.contextSources.flatMap((item) => (
      item.composerAuthority === "project-context-composer-v1"
      && item.kind === "canon"
      && item.canonicalIdentitySource === "active-chapter"
      && item.id.startsWith("chapter-active:")
        ? extractActiveChapterContextNames(item.text)
        : []
    )),
  ];
  const protectedEntries: Array<{
    term: string;
    mode: TraditionalChineseProtectedTermMode;
  }> = [];
  const seen = new Set<string>();
  let protectedCharacters = 0;
  for (const { term, mode } of candidates) {
    if (seen.has(term)) continue;
    if (protectedEntries.length >= MAX_PROTECTED_TERMS) break;
    if (protectedCharacters + term.length > MAX_PROTECTED_TERM_CHARACTERS) break;
    seen.add(term);
    protectedEntries.push({ term, mode });
    protectedCharacters += term.length;
  }
  const continuityTerms: string[] = [];
  for (const term of continuityCandidates) {
    if (seen.has(term) || continuityTerms.includes(term)) continue;
    if (protectedEntries.length + continuityTerms.length >= MAX_PROTECTED_TERMS) break;
    if (protectedCharacters + term.length > MAX_PROTECTED_TERM_CHARACTERS) break;
    continuityTerms.push(term);
    protectedCharacters += term.length;
  }
  return {
    protectedEntries: protectedEntries.sort(
      (left, right) => compareUnicode(left.term, right.term),
    ),
    continuityTerms: continuityTerms.sort(compareUnicode),
  };
}

export async function createTraditionalChineseNormalizationPolicy(input: {
  objective: string;
  privacyLevel: string;
  context: readonly {
    id: string;
    kind: string;
    visibility: string;
    privacyLevel: string;
    approved: boolean;
    text: string;
    composerAuthority?: string;
    canonicalIdentitySource?: string;
  }[];
}): Promise<TraditionalChineseNormalizationPolicy> {
  const canonicalContext = input.context
    .filter((item) =>
      item.approved
      && (item.visibility === "actor" || item.visibility === "both")
      && item.privacyLevel === input.privacyLevel)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      visibility: item.visibility,
      privacyLevel: item.privacyLevel,
      approved: item.approved,
      text: item.text,
      composerAuthority: item.composerAuthority,
      canonicalIdentitySource: item.canonicalIdentitySource,
    }));
  const { protectedEntries, continuityTerms } = boundedProtectedTerms({
    objective: input.objective,
    contextSources: canonicalContext,
  });
  const protectedTerms = protectedEntries.map(({ term }) => term);
  const protectedTermModes = protectedEntries.map(({ mode }) => mode);
  const sourceDigest = await sha256Hex(stableStringify({
      domain: "closed-agent-traditional-chinese-source-v1",
      objective: input.objective,
      context: canonicalContext,
    }));
  const protectedTermsDigest = await sha256Hex(stableStringify({
      domain: "closed-agent-traditional-chinese-protected-terms-v3",
      protectedEntries,
      continuityTerms,
    }));
  return {
    policyVersion: TRADITIONAL_CHINESE_NORMALIZATION_POLICY_VERSION,
    policyId: `normalization-policy:${await sha256Hex(stableStringify({
      domain: "closed-agent-traditional-chinese-policy-identity-v2",
      policyVersion: TRADITIONAL_CHINESE_NORMALIZATION_POLICY_VERSION,
      sourceDigest,
      protectedTermsDigest,
    }))}`,
    sourceDigest,
    protectedTermsDigest,
    protectedTerms,
    protectedTermModes,
    continuityTerms,
  };
}

export function normalizeTraditionalChinesePreservingProperNouns(
  value: string,
  source: string,
) {
  return normalizeTraditionalChinesePreservingProtectedTerms(
    value,
    extractProtectedProperNouns(source),
  );
}

export function normalizeTraditionalChinesePreservingProtectedTerms(
  value: string,
  terms: readonly string[],
  modes?: readonly TraditionalChineseProtectedTermMode[],
) {
  const ranges = protectedIdentityRanges(value, terms, modes);
  if (!ranges.length) return normalizeTraditionalChinese(value);
  const output: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      output.push(normalizeTraditionalChinese(value.slice(cursor, range.start)));
    }
    output.push(value.slice(range.start, range.end));
    cursor = range.end;
  }
  if (cursor < value.length) output.push(normalizeTraditionalChinese(value.slice(cursor)));
  return output.join("");
}

function immutableIntegrityFields(
  record: Omit<TraditionalChineseNormalizationIntegrityRecord, "receiptId">,
) {
  return record;
}

async function integrityReceiptId(
  record: Omit<TraditionalChineseNormalizationIntegrityRecord, "receiptId">,
) {
  return `traditional-chinese-integrity:${await sha256Hex(stableStringify({
    domain: "closed-agent-traditional-chinese-integrity-receipt-v1",
    record: immutableIntegrityFields(record),
  }))}`;
}

export async function verifyTraditionalChineseNormalizationPolicy(
  policy: TraditionalChineseNormalizationPolicy,
) {
  try {
    if (
    !policy
    || typeof policy !== "object"
      || policy.policyVersion !== TRADITIONAL_CHINESE_NORMALIZATION_POLICY_VERSION
      || typeof policy.policyId !== "string"
      || !/^normalization-policy:[a-f0-9]{64}$/u.test(policy.policyId)
    || typeof policy.sourceDigest !== "string"
    || !CRYPTOGRAPHIC_DIGEST.test(policy.sourceDigest)
    || typeof policy.protectedTermsDigest !== "string"
    || !CRYPTOGRAPHIC_DIGEST.test(policy.protectedTermsDigest)
    || !Array.isArray(policy.protectedTerms)
    || !Array.isArray(policy.protectedTermModes)
    || !Array.isArray(policy.continuityTerms)
    || policy.protectedTermModes.length !== policy.protectedTerms.length
    || policy.protectedTerms.length + policy.continuityTerms.length
      > MAX_PROTECTED_TERMS
    || policy.protectedTerms.some((term) => typeof term !== "string")
    || policy.protectedTerms.reduce((sum, term) => sum + term.length, 0)
      + policy.continuityTerms.reduce((sum, term) => sum + term.length, 0)
      > MAX_PROTECTED_TERM_CHARACTERS
    || policy.protectedTerms.some((term, index) =>
      !/^[\p{Script=Han}·]{2,12}$/u.test(term)
      || DISALLOWED_CANONICAL_IDENTITY_TERMS.has(term)
      || policy.protectedTermModes[index] !== protectedTermMode(term)
      || (index > 0 && compareUnicode(policy.protectedTerms[index - 1]!, term) >= 0))
    || policy.protectedTermModes.some((mode) =>
      mode !== "global-unambiguous" && mode !== "identity-bound-ambiguous")
    || policy.continuityTerms.some((term, index) =>
      !/^[\p{Script=Han}·]{2,12}$/u.test(term)
      || policy.protectedTerms.includes(term)
      || (index > 0 && compareUnicode(policy.continuityTerms[index - 1]!, term) >= 0))
    ) return false;
    const protectedTermsDigest = await sha256Hex(stableStringify({
      domain: "closed-agent-traditional-chinese-protected-terms-v3",
      protectedEntries: policy.protectedTerms.map((term, index) => ({
        term,
        mode: policy.protectedTermModes[index],
      })),
      continuityTerms: policy.continuityTerms,
    }));
    const policyId = `normalization-policy:${await sha256Hex(stableStringify({
      domain: "closed-agent-traditional-chinese-policy-identity-v2",
      policyVersion: policy.policyVersion,
      sourceDigest: policy.sourceDigest,
      protectedTermsDigest: policy.protectedTermsDigest,
    }))}`;
    return policy.protectedTermsDigest === protectedTermsDigest
      && policy.policyId === policyId;
  } catch {
    return false;
  }
}

export async function normalizeTraditionalChineseWithIntegrity(input: {
  value: string;
  policy: TraditionalChineseNormalizationPolicy;
  requestId: string;
  providerId: string;
  modelId: string | null;
  modelDigest: string | null;
  inputStage: TraditionalChineseIntegrityStage;
}) {
  if (
    typeof input.value !== "string"
    || !await verifyTraditionalChineseNormalizationPolicy(input.policy)
    || input.inputStage !== "closed-agent-final-selected-content"
    || !hasBoundedIdentifier(input.requestId)
    || !hasBoundedIdentifier(input.providerId)
    || !INTEGRITY_PROVIDER_IDS.has(input.providerId as never)
    || !hasValidModelIdentity(input.modelId, input.modelDigest)
  ) {
    throw Object.assign(new Error("Traditional-Chinese normalization policy is invalid."), {
      code: "CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID",
    });
  }
  const content = normalizeTraditionalChinesePreservingProtectedTerms(
    input.value,
    input.policy.protectedTerms,
    input.policy.protectedTermModes,
  );
  const ambiguousCanonicalOccurrenceCount = countAmbiguousCanonicalOccurrences(
    input.value,
    input.policy.protectedTerms,
    input.policy.protectedTermModes,
  );
  const recordWithoutId: Omit<TraditionalChineseNormalizationIntegrityRecord, "receiptId"> = {
    schemaVersion: TRADITIONAL_CHINESE_INTEGRITY_SCHEMA_VERSION,
    normalizerVersion: TRADITIONAL_CHINESE_NORMALIZER_VERSION,
    policyVersion: input.policy.policyVersion,
    policyId: input.policy.policyId,
    sourceDigest: input.policy.sourceDigest,
    protectedTermsDigest: input.policy.protectedTermsDigest,
    originRequestId: input.requestId,
    providerId: input.providerId,
    modelId: input.modelId,
    modelDigest: input.modelDigest,
    inputStage: input.inputStage,
    normalizationInputDigest: await sha256Hex(input.value),
    outputDigest: await sha256Hex(content),
    normalizationOperationCount: 1,
    ambiguousCanonicalOccurrenceCount,
  };
  return {
    content,
    integrity: {
      ...recordWithoutId,
      receiptId: await integrityReceiptId(recordWithoutId),
    } satisfies TraditionalChineseNormalizationIntegrityRecord,
  };
}

export async function verifyTraditionalChineseNormalizationIntegrity(input: {
  content: string;
  integrity: TraditionalChineseNormalizationIntegrityRecord | null | undefined;
  policy: TraditionalChineseNormalizationPolicy;
  originRequestId?: string;
  providerId?: string;
  modelId?: string | null;
  modelDigest?: string | null;
}) {
  try {
    const record = input.integrity;
    if (
      !record
      || !await verifyTraditionalChineseNormalizationPolicy(input.policy)
      || !await verifyPersistedTraditionalChineseNormalizationIntegrity({
        content: input.content,
        integrity: record,
        originRequestId: input.originRequestId,
        providerId: input.providerId,
        modelId: input.modelId,
        modelDigest: input.modelDigest,
      })
    ) return false;
    return record.schemaVersion === TRADITIONAL_CHINESE_INTEGRITY_SCHEMA_VERSION
      && record.normalizerVersion === TRADITIONAL_CHINESE_NORMALIZER_VERSION
      && record.policyVersion === input.policy.policyVersion
      && record.policyId === input.policy.policyId
      && record.sourceDigest === input.policy.sourceDigest
      && record.protectedTermsDigest === input.policy.protectedTermsDigest;
  } catch {
    return false;
  }
}

/**
 * Revalidates a persisted direct record without reconstructing or persisting
 * the ephemeral protected-name list. Candidate/receipt/ledger equality is a
 * separate OS invariant; this verifies the record checksum and content bind.
 */
export async function verifyPersistedTraditionalChineseNormalizationIntegrity(input: {
  content: string;
  integrity: TraditionalChineseNormalizationIntegrityRecord | null | undefined;
  originRequestId?: string;
  providerId?: string;
  modelId?: string | null;
  modelDigest?: string | null;
}) {
  try {
    const record = input.integrity;
    if (
      typeof input.content !== "string"
      || !record
      || typeof record !== "object"
      || record.schemaVersion !== TRADITIONAL_CHINESE_INTEGRITY_SCHEMA_VERSION
      || record.normalizerVersion !== TRADITIONAL_CHINESE_NORMALIZER_VERSION
      || record.policyVersion !== TRADITIONAL_CHINESE_NORMALIZATION_POLICY_VERSION
      || !/^normalization-policy:[a-f0-9]{64}$/u.test(record.policyId)
      || !CRYPTOGRAPHIC_DIGEST.test(record.sourceDigest)
      || !CRYPTOGRAPHIC_DIGEST.test(record.protectedTermsDigest)
      || record.inputStage !== "closed-agent-final-selected-content"
      || !hasBoundedIdentifier(record.originRequestId)
      || !hasBoundedIdentifier(record.providerId)
      || !INTEGRITY_PROVIDER_IDS.has(record.providerId as never)
      || !hasValidModelIdentity(record.modelId, record.modelDigest)
      || typeof record.receiptId !== "string"
      || !INTEGRITY_RECEIPT_ID.test(record.receiptId)
      || typeof record.normalizationInputDigest !== "string"
      || !CRYPTOGRAPHIC_DIGEST.test(record.normalizationInputDigest)
      || typeof record.outputDigest !== "string"
      || !CRYPTOGRAPHIC_DIGEST.test(record.outputDigest)
      || record.normalizationOperationCount !== 1
      || !Number.isSafeInteger(record.ambiguousCanonicalOccurrenceCount)
      || record.ambiguousCanonicalOccurrenceCount < 0
      || record.ambiguousCanonicalOccurrenceCount > MAX_PROTECTED_TERMS
      || (input.originRequestId !== undefined
        && record.originRequestId !== input.originRequestId)
      || (input.providerId !== undefined && record.providerId !== input.providerId)
      || (input.modelId !== undefined && record.modelId !== input.modelId)
      || (input.modelDigest !== undefined && record.modelDigest !== input.modelDigest)
    ) return false;
    const { receiptId, ...recordWithoutId } = record;
    const expectedPolicyId = `normalization-policy:${await sha256Hex(stableStringify({
      domain: "closed-agent-traditional-chinese-policy-identity-v2",
      policyVersion: record.policyVersion,
      sourceDigest: record.sourceDigest,
      protectedTermsDigest: record.protectedTermsDigest,
    }))}`;
    return record.policyId === expectedPolicyId
      && record.outputDigest === await sha256Hex(input.content)
      && receiptId === await integrityReceiptId(recordWithoutId);
  } catch {
    return false;
  }
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

const HIGH_CONFIDENCE_SIMPLIFIED_CHINESE = /(?:这是|这个|这些|我们|你们|他们|她们|没有|因为|然后|已经|还是|时候|什么|怎么|为什么|应该|起来|进去|出来)|[这们国为个来说还进过发门问间见开无东乐书车马风气体头长亲爱边变点电动读话画让实写号听难类学术数应总处经认许从]/u;

/**
 * Defense-in-depth for persisted derived records. This deliberately omits
 * context-ambiguous forms such as 后/里/干/准/丑/台 and the 万/么/叶/广
 * characters that OpenCC can retain in dictionary-bound single-pass outputs
 * such as 万俟/叶音; the integrity record, rather than a lossy character list,
 * is the primary single-pass evidence.
 */
export function containsHighConfidenceSimplifiedChinese(
  value: string,
  protectedTerms: readonly string[],
  protectedTermModes?: readonly TraditionalChineseProtectedTermMode[],
) {
  const ranges = protectedIdentityRanges(
    value,
    protectedTerms,
    protectedTermModes,
  );
  let cursor = 0;
  for (const range of ranges) {
    if (HIGH_CONFIDENCE_SIMPLIFIED_CHINESE.test(value.slice(cursor, range.start))) {
      return true;
    }
    cursor = range.end;
  }
  return HIGH_CONFIDENCE_SIMPLIFIED_CHINESE.test(value.slice(cursor));
}

export function containsProtectedProperNounDrift(
  value: string,
  protectedSource: string,
) {
  const protectedTerms = extractProtectedProperNouns(protectedSource);
  return containsProtectedTermDrift(value, protectedTerms);
}

export function containsProtectedTermDrift(
  value: string,
  protectedTerms: readonly string[],
  protectedTermModes?: readonly TraditionalChineseProtectedTermMode[],
) {
  const protectedSet = new Set(protectedTerms);
  return protectedTerms.some((term, index) => {
    const converted = normalizeTraditionalChinese(term);
    const mode = protectedTermModes?.[index] ?? "global-unambiguous";
    const strongCanonicalIdentity = mode === "identity-bound-ambiguous"
      && (/^[\p{Script=Han}]{3,12}$/u.test(term) || term.includes("·"));
    return converted !== term
      && !protectedSet.has(converted)
      && (
        strongCanonicalIdentity
          ? value.includes(converted)
          : protectedIdentityRanges(value, [converted], [mode]).length > 0
      );
  });
}
