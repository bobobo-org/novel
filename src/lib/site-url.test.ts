import { describe, expect, it } from 'vitest';

import { getAuthCallbackUrl, getSiteUrl, getCanonicalRedirectUrl } from './site-url';

describe('site URL helpers', () => {
  it('uses the current origin when no canonical site is configured', () => {
    expect(getSiteUrl('https://preview.example.com', {})).toBe('https://preview.example.com');
    expect(getAuthCallbackUrl('https://preview.example.com', {})).toBe(
      'https://preview.example.com/auth/callback',
    );
  });

  it('uses the canonical site URL for auth callbacks', () => {
    const env = { NEXT_PUBLIC_SITE_URL: 'https://novel-orcin.vercel.app/' };

    expect(getSiteUrl('https://preview.example.com', env)).toBe('https://novel-orcin.vercel.app');
    expect(getAuthCallbackUrl('https://preview.example.com', env)).toBe(
      'https://novel-orcin.vercel.app/auth/callback',
    );
  });

  it('redirects non-canonical production hosts while preserving path and search', () => {
    const redirectUrl = getCanonicalRedirectUrl(
      new URL('https://novel-lqtechs-projects.vercel.app/login?x=1'),
      { NEXT_PUBLIC_SITE_URL: 'https://novel-orcin.vercel.app' },
    );

    expect(redirectUrl?.toString()).toBe('https://novel-orcin.vercel.app/login?x=1');
  });

  it('does not redirect localhost development URLs', () => {
    const redirectUrl = getCanonicalRedirectUrl(new URL('http://localhost:3000/login'), {
      NEXT_PUBLIC_SITE_URL: 'https://novel-orcin.vercel.app',
    });

    expect(redirectUrl).toBeNull();
  });
});
