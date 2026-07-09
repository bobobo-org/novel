import type { RuntimeEnv } from './env';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function getSiteUrl(origin: string, env: RuntimeEnv = process.env) {
  const configuredSiteUrl = env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!configuredSiteUrl) {
    return normalizeOrigin(origin);
  }

  return normalizeOrigin(configuredSiteUrl);
}

export function getAuthCallbackUrl(origin: string, env: RuntimeEnv = process.env) {
  return new URL('/auth/callback', getSiteUrl(origin, env)).toString();
}

export function getCanonicalRedirectUrl(requestUrl: URL, env: RuntimeEnv = process.env) {
  const configuredSiteUrl = env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!configuredSiteUrl || LOCAL_HOSTS.has(requestUrl.hostname)) {
    return null;
  }

  const canonicalUrl = new URL(configuredSiteUrl);

  if (requestUrl.origin === canonicalUrl.origin) {
    return null;
  }

  const redirectUrl = new URL(requestUrl);
  redirectUrl.protocol = canonicalUrl.protocol;
  redirectUrl.host = canonicalUrl.host;

  return redirectUrl;
}

function normalizeOrigin(url: string) {
  return new URL(url).origin;
}
