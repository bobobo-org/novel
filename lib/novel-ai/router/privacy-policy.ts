import type { AiPrivacyMode, AiStorageMode } from "../providers/provider-types";

export function effectivePrivacyMode(input: {
  storageMode: AiStorageMode;
  requestedPrivacyMode?: AiPrivacyMode;
  fullOfflineRequired?: boolean;
}): AiPrivacyMode {
  if (input.fullOfflineRequired || input.storageMode === "SQLITE_LOCAL") return "local_only";
  return input.requestedPrivacyMode ?? "local_first";
}

export function externalAllowed(mode: AiPrivacyMode, allowExternalProvider?: boolean) {
  if (mode === "local_only") return false;
  if (allowExternalProvider === false) return false;
  return mode === "external_allowed" || mode === "external_preferred" || Boolean(allowExternalProvider);
}
