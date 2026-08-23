const PRIVATE_IPV4_HOST = /^(?:127\.|10\.|192\.168\.|169\.254\.)|^172\.(?:1[6-9]|2\d|3[01])\./u;
const PRIVATE_IPV6_HOST = /^(?:::1|(?:fc|fd)[0-9a-f]{2}:)/iu;
const SENSITIVE_QUERY_KEY = /(?:access[_-]?token|api[_-]?key|secret|password|passwd|authorization|session|signature)/iu;

/**
 * Accepts the common paste form (`youtube.com/...`) while keeping the public
 * research boundary explicit. The server repeats DNS/SSRF validation before
 * it fetches anything; this client-safe normalization only gives immediate,
 * visible feedback and prevents obvious credential-bearing URLs.
 */
export function normalizePublicResearchUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("請先貼上公開來源網址。");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("網址格式無效；請貼上完整的公開頁面網址。");
  }
  if (url.protocol !== "https:") throw new Error("只接受 HTTPS 公開網址。");
  if (!url.hostname || url.username || url.password || url.port) {
    throw new Error("網址不可包含帳號、密碼或自訂連接埠。");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || PRIVATE_IPV4_HOST.test(hostname)
    || PRIVATE_IPV6_HOST.test(hostname)
  ) {
    throw new Error("只接受公開網際網路網址，不可使用本機或內部網路位址。");
  }
  for (const [key] of url.searchParams) {
    if (SENSITIVE_QUERY_KEY.test(key)) {
      throw new Error("網址查詢參數疑似包含憑證，請移除後再分析。");
    }
  }
  url.hash = "";
  return url.toString();
}
