export function isCompletedNextStaticScriptNavigationCancellation({
  failure,
  engineName,
  baseUrl,
  currentUrl,
  navigationProof,
}) {
  if (engineName !== "webkit" && engineName !== "chromium") return false;
  const expectedErrorText = engineName === "webkit"
    ? "Load request cancelled"
    : "net::ERR_ABORTED";
  if (
    failure.errorText !== expectedErrorText
    || failure.method !== "GET"
    || failure.resourceType !== "script"
    || failure.rscHeader
  ) return false;

  try {
    const requestUrl = new URL(failure.url);
    const destinationUrl = new URL(navigationProof.destinationUrl);
    const settledUrl = new URL(currentUrl);
    const observedAt = Number(failure.observedAt);
    const startedAt = Number(navigationProof.startedAt);
    const arrivedAt = Number(navigationProof.arrivedAt);
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.username === ""
      && requestUrl.password === ""
      && requestUrl.search === ""
      && requestUrl.hash === ""
      && /^\/_next\/static\/chunks\/[A-Za-z0-9_-]{8,64}\.js$/u.test(requestUrl.pathname)
      && navigationProof.landed === true
      && destinationUrl.origin === new URL(baseUrl).origin
      && destinationUrl.href === settledUrl.href
      && Number.isFinite(observedAt)
      && Number.isFinite(startedAt)
      && Number.isFinite(arrivedAt)
      && startedAt <= observedAt
      && observedAt <= arrivedAt;
  } catch {
    return false;
  }
}

export function isVerifiedNextStaticScriptResponse({
  status,
  contentType,
  cacheControl,
  bodyLength,
}) {
  return status === 200
    && /^(?:application|text)\/javascript(?:;|$)/iu.test(contentType)
    && /(?:^|,)\s*(?:public\s*,\s*)?max-age=\d+\s*,\s*immutable(?:,|$)/iu.test(cacheControl)
    && Number.isSafeInteger(bodyLength)
    && bodyLength > 0;
}

export function isExactProductReleaseIdentity(identity, expectedProductCommit) {
  return /^[0-9a-f]{40}$/u.test(expectedProductCommit)
    && identity?.appCommit === expectedProductCommit
    && identity?.releaseProductCommit === expectedProductCommit;
}

const postCutoverProductionOrigins = new Set([
  "https://novel-orcin.vercel.app",
  "https://novel-lqtechs-projects.vercel.app",
]);

export function classifyPostCutoverExactChunkRetry({
  runtimePhase,
  retryMode,
  engineName,
  viewport,
  attempt,
  baseUrl,
  expectedProductCommit,
  error,
  pageErrors,
  requestedChunkRequests,
}) {
  if (
    runtimePhase !== "post-cutover-production"
    || retryMode !== "exact-once"
    || engineName !== "webkit"
    || viewport?.width !== 320
    || viewport?.height !== 568
    || attempt !== 0
    || !/^[0-9a-f]{40}$/u.test(expectedProductCommit)
    || error?.code !== "ERR_ASSERTION"
    || error?.operator !== "deepStrictEqual"
    || error?.mobileViewportPageErrorsAssertion !== pageErrors
    || error?.actual !== pageErrors
    || !Array.isArray(error?.expected)
    || error.expected.length !== 0
    || !Array.isArray(pageErrors)
    || pageErrors.length !== 1
    || !Array.isArray(requestedChunkRequests)
  ) return null;

  const match = /^Failed to load chunk (\/_next\/static\/chunks\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]{8,64}\.js) from module \d+$/u.exec(pageErrors[0]);
  if (!match) return null;

  try {
    const parsedBaseUrl = new URL(baseUrl);
    const origin = parsedBaseUrl.origin;
    if (
      parsedBaseUrl.username !== ""
      || parsedBaseUrl.password !== ""
      || parsedBaseUrl.pathname !== "/"
      || parsedBaseUrl.search !== ""
      || parsedBaseUrl.hash !== ""
    ) return null;
    if (!postCutoverProductionOrigins.has(origin)) return null;
    const chunkUrl = new URL(match[1], parsedBaseUrl);
    const requestedExactly = requestedChunkRequests.some((request) => {
      if (request?.method !== "GET" || request?.resourceType !== "script") return false;
      const requestedUrl = new URL(request.url);
      return requestedUrl.origin === origin
        && requestedUrl.username === ""
        && requestedUrl.password === ""
        && requestedUrl.search === ""
        && requestedUrl.hash === ""
        && requestedUrl.href === chunkUrl.href;
    });
    return requestedExactly
      ? { chunkPath: match[1], chunkUrl: chunkUrl.href, origin }
      : null;
  } catch {
    return null;
  }
}
