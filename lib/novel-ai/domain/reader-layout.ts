export const READER_CONTENT_WIDTH_MIN = 320;
export const READER_CONTENT_WIDTH_LEGACY_DEFAULT = 760;
export const READER_CONTENT_WIDTH_DEFAULT = 1_120;
export const READER_CONTENT_WIDTH_MAX = 1_480;
export const READER_CONTENT_WIDTH_STEP = 20;
export const READER_CONTENT_WIDTH_PREFERENCE_VERSION = 1;

function normalizeReaderContentWidth(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return READER_CONTENT_WIDTH_DEFAULT;
  }
  return Math.min(
    READER_CONTENT_WIDTH_MAX,
    Math.max(READER_CONTENT_WIDTH_MIN, value),
  );
}

export function migrateReaderContentWidthPreference(
  value: unknown,
  preferenceVersion: unknown,
) {
  const storedVersion = typeof preferenceVersion === "number"
    && Number.isInteger(preferenceVersion)
    && preferenceVersion >= 0
    ? preferenceVersion
    : 0;
  const needsLegacyDefaultUpgrade = storedVersion < READER_CONTENT_WIDTH_PREFERENCE_VERSION
    && value === READER_CONTENT_WIDTH_LEGACY_DEFAULT;
  const contentWidth = normalizeReaderContentWidth(
    needsLegacyDefaultUpgrade ? READER_CONTENT_WIDTH_DEFAULT : value,
  );
  const contentWidthPreferenceVersion = Math.max(
    storedVersion,
    READER_CONTENT_WIDTH_PREFERENCE_VERSION,
  );

  return {
    contentWidth,
    contentWidthPreferenceVersion,
    needsSave: contentWidth !== value
      || contentWidthPreferenceVersion !== preferenceVersion,
  };
}
