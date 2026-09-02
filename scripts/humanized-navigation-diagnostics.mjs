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
