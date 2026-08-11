const PINNED_MODEL_PREFIX = [
  "/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  "resolve/32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad/",
].join("/");
const PINNED_WASM_PATH = [
  "/mlc-ai/binary-mlc-llm-libs",
  "025bcaf3780fa8254f5e5efd3bfea0a5397248f4",
  "web-llm-models/v0_2_84/base",
  "Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
].join("/");

function parsedUrl(value) {
  try {
    return value instanceof URL ? value : new URL(value);
  } catch {
    return null;
  }
}

export function isApprovedImmutableModelSource(value) {
  const url = parsedUrl(value);
  if (!url || url.protocol !== "https:" || url.port) return false;
  if (url.origin === "https://huggingface.co") {
    return url.pathname.startsWith(PINNED_MODEL_PREFIX);
  }
  return url.origin === "https://raw.githubusercontent.com"
    && url.pathname === PINNED_WASM_PATH;
}

export function isApprovedModelRedirect(value) {
  const url = parsedUrl(value);
  if (!url || url.protocol !== "https:" || url.port) return false;
  return /^cdn-lfs(?:-[a-z0-9]+)*\.(?:hf|huggingface)\.co$/u.test(url.hostname)
    || /^(?:cas-bridge|transfer)\.xethub\.hf\.co$/u.test(url.hostname)
    || /^[a-z0-9-]+\.aws\.cdn\.hf\.co$/u.test(url.hostname)
    || (
      url.origin === "https://huggingface.co"
      && url.pathname.startsWith("/api/resolve-cache/models/mlc-ai/")
    );
}

export function classifyClosedAiCrossOriginRequest({
  urlValue,
  expectedOrigin,
  requestPhase,
  rootUrlValue,
}) {
  const url = parsedUrl(urlValue);
  const origin = parsedUrl(expectedOrigin);
  if (!url || !origin || origin.origin !== expectedOrigin) return "blocked";
  if (url.origin === origin.origin) return "same-origin";
  if (requestPhase !== "model-install") return "blocked";
  if (isApprovedImmutableModelSource(url)) return "immutable-model-root";
  return isApprovedModelRedirect(url) && isApprovedImmutableModelSource(rootUrlValue)
    ? "immutable-model-redirect"
    : "blocked";
}

export function isPreviewToolbarRequest(value) {
  return parsedUrl(value)?.origin === "https://vercel.live";
}
