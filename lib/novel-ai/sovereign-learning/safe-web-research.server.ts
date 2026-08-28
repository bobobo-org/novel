import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { sanitizeRetrievedKnowledge } from "../security/retrieval-content-sanitizer";
import {
  createTextFingerprint,
  normalizeForLearning,
  sha256Hex,
} from "./hashing";
import {
  assertControlledWebContentCanCreateRules,
  classifyControlledWebContent,
  type ControlledWebSourceEvidence,
} from "./web-knowledge-contract";
import type { LearningWebSourceProfile } from "./types";

const USER_AGENT = "NovelControlledLearningBot/1.0";
const MAX_REDIRECTS = 3;
const MAX_ROBOTS_BYTES = 128 * 1024;
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_SOURCE_CHARACTERS = 60_000;
const TOTAL_RESEARCH_TIMEOUT_MS = 10_000;

type HostAddress = { address: string; family: number };
type ResolveHost = (hostname: string) => Promise<HostAddress[]>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ControlledWebFetchDependencies = {
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
  now?: () => string;
  sourceProfile?: LearningWebSourceProfile;
  deadlineMs?: number;
  signal?: AbortSignal;
};

export type ControlledWebResearchResult = {
  evidence: ControlledWebSourceEvidence;
  transientSanitizedText: string;
};

function webResearchError(code: string, message: string, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function timeoutError() {
  return webResearchError("WEB_RESEARCH_TIMEOUT", "來源網站回應逾時。", 504);
}

function controllerError(controller: AbortController) {
  return controller.signal.reason === "WEB_RESEARCH_TIMEOUT"
    ? timeoutError()
    : webResearchError("WEB_RESEARCH_CANCELLED", "公開頁面分析已由使用者取消。", 499);
}

async function withinDeadline<T>(
  promise: Promise<T>,
  deadlineAt: number,
  onTimeout?: () => void,
): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    onTimeout?.();
    throw timeoutError();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(timeoutError());
        }, remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stripIpv6Brackets(value: string) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function isPublicIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string) {
  const normalized = stripIpv6Brackets(address).toLowerCase().split("%")[0];
  if (!normalized || normalized === "::" || normalized === "::1") return false;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (mapped) return isPublicIpv4(mapped);
  if (/^(?:fc|fd|fe[89ab]|ff)/u.test(normalized)) return false;
  if (/^(?:2001:db8|2001:10|2001:2|2001:20|2002:|64:ff9b:)/u.test(normalized)) return false;
  return /^[23][0-9a-f]{0,3}:/u.test(normalized);
}

export function isPublicInternetAddress(address: string) {
  const normalized = stripIpv6Brackets(address);
  const family = isIP(normalized);
  return family === 4 ? isPublicIpv4(normalized) : family === 6 ? isPublicIpv6(normalized) : false;
}

export function parseControlledWebUrl(rawUrl: string) {
  if (!rawUrl.trim() || rawUrl.length > 2_048) {
    throw webResearchError("WEB_RESEARCH_URL_INVALID", "來源網址不可空白或超過 2,048 字元。");
  }
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw webResearchError("WEB_RESEARCH_URL_INVALID", "來源網址格式無效。");
  }
  if (url.protocol !== "https:") {
    throw webResearchError("WEB_RESEARCH_HTTPS_REQUIRED", "受控網路研究只接受 HTTPS 來源。");
  }
  if (url.username || url.password) {
    throw webResearchError("WEB_RESEARCH_URL_CREDENTIALS_BLOCKED", "來源網址不得包含帳號或密碼。");
  }
  if (url.port && url.port !== "443") {
    throw webResearchError("WEB_RESEARCH_PORT_BLOCKED", "受控網路研究只允許標準 HTTPS 連接埠。");
  }
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (
    !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".lan")
    || hostname.endsWith(".home")
  ) {
    throw webResearchError("WEB_RESEARCH_PRIVATE_HOST_BLOCKED", "本機或內部網路位址不能作為研究來源。");
  }
  if (isIP(hostname) && !isPublicInternetAddress(hostname)) {
    throw webResearchError("WEB_RESEARCH_PRIVATE_ADDRESS_BLOCKED", "私人、保留或本機 IP 不能作為研究來源。");
  }
  url.hash = "";
  return url;
}

async function defaultResolveHost(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

async function assertPublicResolution(url: URL, resolveHost: ResolveHost, deadlineAt: number) {
  const hostname = stripIpv6Brackets(url.hostname);
  let addresses: HostAddress[];
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await withinDeadline(resolveHost(hostname), deadlineAt);
    } catch (error) {
      if ((error as { code?: string })?.code === "WEB_RESEARCH_TIMEOUT") throw error;
      addresses = [];
    }
  }
  if (!addresses.length) {
    throw webResearchError("WEB_RESEARCH_DNS_FAILED", "無法驗證來源網站的公開網路位址。", 502);
  }
  if (addresses.some(({ address }) => !isPublicInternetAddress(address))) {
    throw webResearchError("WEB_RESEARCH_DNS_PRIVATE_ADDRESS_BLOCKED", "來源網站解析到私人或保留網路位址，已阻止連線。", 403);
  }
  return addresses;
}

function appendNodeResponseHeaders(target: Headers, source: Record<string, string | string[] | undefined>) {
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) target.append(key, item);
    } else if (value !== undefined) {
      target.set(key, value);
    }
  }
}

function fetchPinnedPublicHttps(url: URL, init: RequestInit, target: HostAddress) {
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: target.address, family: target.family }]);
      return;
    }
    callback(null, target.address, target.family);
  };
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest({
      protocol: "https:",
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: init.method ?? "GET",
      headers,
      servername: url.hostname,
      lookup: pinnedLookup,
      signal: init.signal ?? undefined,
    }, (response) => {
      const responseHeaders = new Headers();
      appendNodeResponseHeaders(responseHeaders, response.headers);
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
        status: response.statusCode ?? 502,
        statusText: response.statusMessage,
        headers: responseHeaders,
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function readLimitedText(
  response: Response,
  maximumBytes: number,
  deadlineAt: number,
  controller: AbortController,
) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  let truncated = declared > maximumBytes;
  try {
    while (true) {
      const { done, value } = await withinDeadline(
        reader.read(),
        deadlineAt,
        () => controller.abort("WEB_RESEARCH_TIMEOUT"),
      );
      if (done) break;
      const remaining = maximumBytes - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const accepted = value.byteLength > remaining ? value.slice(0, remaining) : value;
      total += accepted.byteLength;
      text += decoder.decode(accepted, { stream: true });
      if (accepted.byteLength < value.byteLength || total >= maximumBytes) {
        truncated = true;
        break;
      }
    }
    text += decoder.decode();
    return { text, truncated };
  } catch (error) {
    if (controller.signal.aborted) {
      throw controllerError(controller);
    }
    if ((error as { code?: string })?.code === "WEB_RESEARCH_TIMEOUT") {
      throw timeoutError();
    }
    throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function controlledFetch(input: {
  initialUrl: URL;
  fetchImpl: FetchLike;
  resolveHost: ResolveHost;
  maximumBytes: number;
  accept: string;
  deadlineAt: number;
  controller: AbortController;
  pinResolvedAddress: boolean;
}) {
  let current = input.initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const addresses = await assertPublicResolution(current, input.resolveHost, input.deadlineAt);
    let response: Response;
    try {
      const requestInit: RequestInit = {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: input.controller.signal,
        headers: {
          Accept: input.accept,
          "User-Agent": USER_AGENT,
        },
      };
      const request = input.pinResolvedAddress
        ? fetchPinnedPublicHttps(current, requestInit, addresses[0])
        : input.fetchImpl(current, requestInit);
      response = await withinDeadline(request, input.deadlineAt, () => input.controller.abort("WEB_RESEARCH_TIMEOUT"));
    } catch (error) {
      if (input.controller.signal.aborted) {
        throw controllerError(input.controller);
      }
      if ((error as { code?: string })?.code === "WEB_RESEARCH_TIMEOUT") {
        throw timeoutError();
      }
      throw webResearchError("WEB_RESEARCH_NETWORK_FAILED", "無法安全讀取來源網站。", 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw webResearchError("WEB_RESEARCH_REDIRECT_INVALID", "來源網站回傳無效重新導向。", 502);
      if (redirects >= MAX_REDIRECTS) throw webResearchError("WEB_RESEARCH_REDIRECT_LIMIT", "來源網站重新導向次數過多。", 508);
      current = parseControlledWebUrl(new URL(location, current).toString());
      continue;
    }
    return {
      response,
      finalUrl: current,
      redirects,
      readText: () => readLimitedText(
        response,
        input.maximumBytes,
        input.deadlineAt,
        input.controller,
      ),
    };
  }
  throw webResearchError("WEB_RESEARCH_REDIRECT_LIMIT", "來源網站重新導向次數過多。", 508);
}

type RobotsRule = { allow: boolean; path: string };

export function isPathAllowedByRobots(robotsText: string, pathnameWithQuery: string) {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const originalLine of robotsText.split(/\r?\n/u)) {
    const line = originalLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && agents.length) {
      if (field === "disallow" && !value) continue;
      rules.push({ allow: field === "allow", path: value });
    }
  }
  flush();
  const agent = USER_AGENT.split("/")[0].toLowerCase();
  const exact = groups.filter((group) => group.agents.some((value) => agent.includes(value) && value !== "*"));
  const selected = exact.length ? exact : groups.filter((group) => group.agents.includes("*"));
  const matches = selected
    .flatMap((group) => group.rules)
    .filter((rule) => pathnameWithQuery.startsWith(rule.path.replace(/\*.*$/u, "")))
    .sort((left, right) => right.path.length - left.path.length || Number(right.allow) - Number(left.allow));
  return matches[0]?.allow ?? true;
}

async function checkRobots(
  url: URL,
  fetchImpl: FetchLike,
  resolveHost: ResolveHost,
  deadlineAt: number,
  controller: AbortController,
  pinResolvedAddress: boolean,
) {
  const robotsUrl = new URL("/robots.txt", url.origin);
  const result = await controlledFetch({
    initialUrl: robotsUrl,
    fetchImpl,
    resolveHost,
    maximumBytes: MAX_ROBOTS_BYTES,
    accept: "text/plain;q=1.0,*/*;q=0.1",
    deadlineAt,
    controller,
    pinResolvedAddress,
  });
  if (result.response.status === 404 || result.response.status === 410) {
    await result.response.body?.cancel().catch(() => undefined);
    return "not_present" as const;
  }
  if (result.response.status === 401 || result.response.status === 403) {
    throw webResearchError("WEB_RESEARCH_ROBOTS_DISALLOWED", "來源網站禁止自動讀取此內容。", 403);
  }
  if (!result.response.ok) {
    throw webResearchError("WEB_RESEARCH_ROBOTS_UNAVAILABLE", "無法確認來源網站的 robots 規則，已採取保守阻擋。", 503);
  }
  const { text: robotsText } = await result.readText();
  if (!isPathAllowedByRobots(robotsText, `${url.pathname}${url.search}`)) {
    throw webResearchError("WEB_RESEARCH_ROBOTS_DISALLOWED", "來源網站的 robots 規則不允許讀取此頁。", 403);
  }
  return "allowed" as const;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;|&apos;/giu, "'");
}

function htmlAttributes(tag: string) {
  const values = new Map<string, string>();
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/gu)) {
    values.set(match[1].toLowerCase(), decodeHtmlEntities(match[3]).trim());
  }
  return values;
}

function extractPublicMetadata(html: string) {
  const values: string[] = [];
  let title = "";
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = htmlAttributes(match[0]);
    const key = (attributes.get("property") || attributes.get("name") || attributes.get("itemprop") || "").toLowerCase();
    const content = attributes.get("content") || "";
    if (!content || content.length > 12_000) continue;
    if (["og:title", "twitter:title", "headline"].includes(key) && !title) title = content;
    if ([
      "og:title", "twitter:title", "headline", "og:description", "twitter:description", "description",
      "keywords", "author", "article:section", "video:tag",
    ].includes(key)) values.push(content);
  }
  const allowedJsonKeys = new Set(["name", "headline", "description", "keywords", "genre", "about", "articleSection"]);
  const collect = (value: unknown, depth = 0) => {
    if (depth > 5 || values.join(" ").length > 24_000) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 40)) collect(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (allowedJsonKeys.has(key) && typeof item === "string" && item.length <= 12_000) values.push(item);
      else if (key === "interactionStatistic" || key === "author" || key === "creator" || key === "about") collect(item, depth + 1);
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/giu)) {
    if (match[2].length > 128_000) continue;
    try {
      collect(JSON.parse(decodeHtmlEntities(match[2])));
    } catch {
      // Invalid public metadata is ignored; visible page text remains available.
    }
  }
  for (const match of html.matchAll(/"shortDescription"\s*:\s*"((?:\\.|[^"\\]){1,12000})"/gu)) {
    try {
      values.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      // A malformed embedded description is not trusted.
    }
  }
  return {
    title: normalizeForLearning(title).slice(0, 180),
    text: normalizeForLearning([...new Set(values.map((value) => normalizeForLearning(value)).filter(Boolean))].join("\n"))
      .slice(0, 30_000),
  };
}

function textFromHtml(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] || "";
  const metadata = extractPublicMetadata(html);
  const withoutActiveContent = html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|template|svg|canvas|form|iframe)[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
  return {
    title: metadata.title || normalizeForLearning(decodeHtmlEntities(titleMatch)).slice(0, 180),
    text: normalizeForLearning([metadata.text, decodeHtmlEntities(withoutActiveContent)].filter(Boolean).join("\n")),
    metadataCharacters: metadata.text.length,
  };
}

const CREDENTIAL_PATTERN = /\b(?:vcp|sbp|gh[pousr]|sk)-?[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/iu;

function isHighConfidencePromptInjection(
  finding: ReturnType<typeof sanitizeRetrievedKnowledge>["findings"][number],
) {
  if (finding.severity !== "blocking") return false;
  if (finding.code !== "INSTRUCTION_OVERRIDE") return true;
  const value = finding.matchedText ?? "";
  return /(?:ignore|disregard|forget|override|bypass).{0,32}(?:previous|prior|system|developer|instruction|policy|rules?)/iu.test(value)
    || /(?:忽略|無視|忘記|覆蓋|繞過).{0,32}(?:先前|系統|開發者|指令|提示|政策)/u.test(value);
}

function stripHeuristicOverrideSentences(value: string) {
  return value.replace(
    /(^|[\n.!?。！？])\s*(?:(?:please|you\s+must|must|now)\s+|(?:請|務必|立刻|現在)\s*)?(?:ignore|disregard|forget|override|bypass|忽略|無視|忘記|覆蓋|繞過).{0,240}?(?=$|[\n.!?。！？])/gimu,
    "$1 [untrusted override sentence quarantined] ",
  );
}

export async function fetchControlledWebResearch(
  rawUrl: string,
  dependencies: ControlledWebFetchDependencies = {},
): Promise<ControlledWebResearchResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const pinResolvedAddress = dependencies.fetchImpl === undefined;
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost;
  const requestedUrl = parseControlledWebUrl(rawUrl);
  const sourceProfile = dependencies.sourceProfile ?? { channel: "article" as const };
  const contentEligibility = classifyControlledWebContent({
    url: requestedUrl.toString(),
    sourceProfile,
  });
  // A video landing page contains metadata, recommendations and interface
  // labels, not a verified subtitle track. Reject before DNS or page fetch so
  // none of it can reach a teacher, rule extractor or repository.
  assertControlledWebContentCanCreateRules(contentEligibility);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort("WEB_RESEARCH_CALLER_ABORTED");
  if (dependencies.signal?.aborted) abortFromCaller();
  else dependencies.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const deadlineMs = Math.max(50, Math.min(20_000, Number(dependencies.deadlineMs) || TOTAL_RESEARCH_TIMEOUT_MS));
  const deadlineAt = Date.now() + deadlineMs;
  const overallTimer = setTimeout(() => controller.abort("WEB_RESEARCH_TIMEOUT"), deadlineMs);
  try {
    await assertPublicResolution(requestedUrl, resolveHost, deadlineAt);
    const robotsPolicy = await checkRobots(
      requestedUrl,
      fetchImpl,
      resolveHost,
      deadlineAt,
      controller,
      pinResolvedAddress,
    );
    const result = await controlledFetch({
      initialUrl: requestedUrl,
      fetchImpl,
      resolveHost,
      maximumBytes: MAX_SOURCE_BYTES,
      accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/json;q=0.9",
      deadlineAt,
      controller,
      pinResolvedAddress,
    });
    const finalContentEligibility = classifyControlledWebContent({
      url: result.finalUrl.toString(),
      sourceProfile,
    });
    // Redirects are part of the untrusted source boundary. A URL that looked
    // like an article may end on a video landing page, whose title,
    // description and social metadata are not a transcript. Reclassify the
    // controlled final URL before reading any response body so redirected
    // metadata can never reach teachers, rule extraction or shared storage.
    if (!finalContentEligibility.ruleCreationAllowed) {
      await result.response.body?.cancel().catch(() => undefined);
    }
    assertControlledWebContentCanCreateRules(finalContentEligibility);
  if (!result.response.ok) {
    throw webResearchError("WEB_RESEARCH_HTTP_FAILED", `來源網站回傳 HTTP ${result.response.status}。`, 502);
  }
  const contentType = (result.response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  const allowedTypes = new Set([
    "text/html",
    "application/xhtml+xml",
    "text/plain",
    "text/markdown",
    "application/json",
  ]);
  if (!allowedTypes.has(contentType)) {
    await result.response.body?.cancel().catch(() => undefined);
    throw webResearchError("WEB_RESEARCH_CONTENT_TYPE_BLOCKED", "此來源不是可安全分析的文字網頁。", 415);
  }
  const sourceRead = await result.readText();
  const raw = sourceRead.text;
  const extracted = contentType.includes("html")
    ? textFromHtml(raw)
    : { title: "", text: normalizeForLearning(raw), metadataCharacters: 0 };
  if (CREDENTIAL_PATTERN.test(extracted.text)) {
    throw webResearchError("WEB_RESEARCH_CREDENTIAL_CONTENT_BLOCKED", "來源內容疑似包含密鑰或登入憑證，已阻止外送。", 403);
  }
  const boundary = sanitizeRetrievedKnowledge(extracted.text, { sourceType: "web_content" });
  const blockingFindings = boundary.findings.filter(isHighConfidencePromptInjection);
  if (blockingFindings.length) {
    throw Object.assign(
      webResearchError("WEB_RESEARCH_PROMPT_INJECTION_BLOCKED", "來源含有高風險提示注入指令，已隔離且不會送給教師 AI。", 403),
      { detailCodes: blockingFindings.map((finding) => finding.code) },
    );
  }
  const heuristicOnly = boundary.sanitizationStatus === "quarantined" && !blockingFindings.length;
  const normalizedSanitizedText = normalizeForLearning(
    heuristicOnly ? stripHeuristicOverrideSentences(extracted.text) : boundary.sanitizedText,
  );
  const characterTruncated = normalizedSanitizedText.length > MAX_SOURCE_CHARACTERS;
  const sanitizedText = normalizedSanitizedText.slice(0, MAX_SOURCE_CHARACTERS);
  if (sanitizedText.length < 240) {
    throw webResearchError("WEB_RESEARCH_CONTENT_TOO_SHORT", "安全清理後的來源內容不足以蒸餾可靠規則。", 422);
  }
  const sourceDigest = await sha256Hex(sanitizedText);
    return {
      evidence: {
      requestedUrl: requestedUrl.toString(),
      finalUrl: result.finalUrl.toString(),
      title: extracted.title || result.finalUrl.hostname,
      fetchedAt: dependencies.now?.() ?? new Date().toISOString(),
      contentType,
      contentCharacters: sanitizedText.length,
      redirects: result.redirects,
        robotsPolicy,
      sourceDigest,
      sourceProfile,
      contentEligibility: finalContentEligibility,
      sourceTruncated: sourceRead.truncated || characterTruncated,
      fingerprint: createTextFingerprint(sanitizedText),
      sanitizationStatus: boundary.findings.length ? "sanitized" : "unchanged",
      warningCodes: [...new Set(boundary.findings.map((finding) =>
        `${heuristicOnly ? "HEURISTIC_REVIEW" : "UNTRUSTED_CONTENT"}_${finding.code}`)
        .concat(extracted.metadataCharacters > 0 ? ["PUBLIC_METADATA_ENRICHED"] : [])
        .concat(sourceRead.truncated ? ["WEB_SOURCE_BYTE_EXCERPT_ANALYZED"] : [])
        .concat(characterTruncated ? ["WEB_SOURCE_TEXT_EXCERPT_ANALYZED"] : []))],
      rawContentRetained: false,
      },
      transientSanitizedText: sanitizedText,
    };
  } finally {
    clearTimeout(overallTimer);
    dependencies.signal?.removeEventListener("abort", abortFromCaller);
  }
}
