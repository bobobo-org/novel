import type { KnowledgeBoundaryFinding } from "./knowledge-instruction-boundary";

const RULES: Array<{
  code: KnowledgeBoundaryFinding["code"];
  pattern: RegExp;
}> = [
  { code: "INSTRUCTION_OVERRIDE", pattern: /(?:ignore|disregard|forget|override|bypass|忽略|無視|忘記|覆蓋|繞過).{0,32}(?:previous|prior|system|developer|instruction|policy|rules?|先前|系統|開發者|規則|指令|提示|政策)/giu },
  { code: "CROSS_SCOPE_ACCESS", pattern: /(?:read|load|retrieve|access|讀取|載入|檢索|存取).{0,30}(?:other|another|其他|別的).{0,18}(?:story|project|user|workspace|作品|專案|使用者|工作區)/giu },
  { code: "TOOL_INVOCATION", pattern: /(?:call|invoke|execute|run|launch|呼叫|執行|啟動).{0,24}(?:shell|powershell|terminal|tool|command|curl|database|sql|工具|命令|資料庫)/giu },
  { code: "SECRET_EXFILTRATION", pattern: /(?:output|reveal|print|send|輸出|揭露|顯示|傳送).{0,20}(?:token|password|cookie|authorization|secret|system prompt|密碼|權杖|系統提示)/giu },
  { code: "CANONICAL_MUTATION", pattern: /(?:auto(?:matically)?|直接|自動).{0,18}(?:accept|approve|commit|overwrite|接受|核准|提交|覆寫).{0,24}(?:candidate|story bible|canonical|候選|正式|設定)/giu },
  { code: "ROLE_IMPERSONATION", pattern: /(?:(?:^|\n)\s*(?:system|developer|assistant|系統|開發者)\s*[:：]|(?:you are|act as|pretend to be|你現在是|扮演)\s+(?:the\s+)?(?:system|developer|系統|開發者))/giu },
  { code: "HIDDEN_INSTRUCTION", pattern: /<(?:script|style|template|noscript|meta)\b[\s\S]*?>|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/giu },
  { code: "UNICODE_OBFUSCATION", pattern: /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu },
  { code: "EXTERNAL_TRANSFER", pattern: /(?:send|upload|post|transmit|傳送|上傳|送出).{0,32}(?:full\s*text|story|document|content|全文|作品|文件|內容).{0,32}(?:external|remote|api|server|service|外部|遠端|服務)/giu },
  { code: "PRIVILEGE_ESCALATION", pattern: /(?:elevate|escalate|grant|enable|提升|授予|開啟).{0,24}(?:permission|privilege|admin|authority|權限|管理員|授權)/giu },
  { code: "STRUCTURED_TOOL_PAYLOAD", pattern: /["']?(?:toolName|toolArguments|shellCommand|databaseCommand|approvalAction|externalRequest)["']?\s*[:=]/giu },
];

function normalizeForDetection(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, "");
}

function hasDangerousIntent(text: string) {
  const normalized = normalizeForDetection(text).toLocaleLowerCase("en-US");
  const compact = normalized.replace(/[\s._-]+/g, "");
  const verbs = ["ignore", "disregard", "override", "bypass", "忽略", "無視", "繞過", "呼叫", "執行", "輸出", "傳送"];
  const targets = ["system", "developer", "instruction", "policy", "tool", "shell", "token", "password", "storybible", "canonical", "系統", "開發者", "規則", "工具", "權杖", "正式設定"];
  return verbs.some((verb) => compact.includes(verb)) && targets.some((target) => compact.includes(target));
}

function decodeBase64(value: string) {
  try {
    if (typeof atob === "function") return atob(value);
  } catch {
    return "";
  }
  return "";
}

export function detectPromptInjection(text: string): KnowledgeBoundaryFinding[] {
  const findings: KnowledgeBoundaryFinding[] = [];
  const normalized = normalizeForDetection(text);
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        code: rule.code,
        start: match.index,
        end: match.index + match[0].length,
        severity: rule.code === "UNICODE_OBFUSCATION" ? "warning" : "blocking",
        matchedText: match[0].slice(0, 160),
      });
    }
  }
  if (normalized !== text && hasDangerousIntent(normalized) && !findings.some((finding) => finding.severity === "blocking")) {
    findings.push({
      code: "UNICODE_OBFUSCATION",
      start: 0,
      end: text.length,
      severity: "blocking",
      matchedText: text.slice(0, 160),
    });
  }
  const compact = normalized.replace(/\s+/g, "");
  if (hasDangerousIntent(compact) && !findings.some((finding) => finding.severity === "blocking")) {
    findings.push({
      code: "INSTRUCTION_OVERRIDE",
      start: 0,
      end: text.length,
      severity: "blocking",
      matchedText: text.slice(0, 160),
    });
  }
  for (const match of text.matchAll(/\b[A-Za-z0-9+/]{24,}={0,2}\b/g)) {
    const decoded = decodeBase64(match[0]);
    if (!decoded || !hasDangerousIntent(decoded)) continue;
    findings.push({
      code: "SUSPICIOUS_BASE64",
      start: match.index,
      end: match.index + match[0].length,
      severity: "blocking",
      matchedText: match[0].slice(0, 48),
    });
  }
  return findings.sort((a, b) => a.start - b.start || b.end - a.end);
}
