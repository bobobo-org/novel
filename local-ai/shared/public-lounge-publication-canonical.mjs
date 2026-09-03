const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const BIDI_OVERRIDE_PATTERN = /[\u202A-\u202E\u2066-\u2069]/gu;

/**
 * Canonicalize a public-lounge publication text field before it crosses a
 * browser, Private AI Hub, or Vercel trust boundary.
 *
 * This module intentionally has no Node-only imports so the exact same code
 * can execute in both browser and server runtimes.
 */
export function canonicalizePublicLoungePublicationText(value, field) {
  if (typeof value !== "string") {
    throw new TypeError("PUBLIC_LOUNGE_TEXT_NOT_STRING");
  }
  let cleaned = value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .replace(BIDI_OVERRIDE_PATTERN, "");
  if (field === "inline") {
    return cleaned.replace(/\s+/gu, " ").trim();
  }
  if (field === "prose") {
    return cleaned.replace(/[ \t]+\n/gu, "\n").trim();
  }
  throw new TypeError("PUBLIC_LOUNGE_TEXT_FIELD_INVALID");
}

export function canonicalizePublicLoungeInlineText(value) {
  return canonicalizePublicLoungePublicationText(value, "inline");
}

export function canonicalizePublicLoungeProseText(value) {
  return canonicalizePublicLoungePublicationText(value, "prose");
}
