export const BROWSER_BACKGROUND_PREWARM_CONSENT_KEY =
  "novel_browser_ai_background_prewarm_v1";

type ConsentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): ConsentStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readBrowserBackgroundPrewarmConsent(
  storage: ConsentStorage | null = browserStorage(),
) {
  if (!storage) return false;
  try {
    return storage.getItem(BROWSER_BACKGROUND_PREWARM_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export function grantBrowserBackgroundPrewarmConsent(
  storage: ConsentStorage | null = browserStorage(),
) {
  if (!storage) return false;
  try {
    storage.setItem(BROWSER_BACKGROUND_PREWARM_CONSENT_KEY, "granted");
    return true;
  } catch {
    return false;
  }
}

export function revokeBrowserBackgroundPrewarmConsent(
  storage: ConsentStorage | null = browserStorage(),
) {
  if (!storage) return false;
  try {
    storage.removeItem(BROWSER_BACKGROUND_PREWARM_CONSENT_KEY);
    return true;
  } catch {
    return false;
  }
}
