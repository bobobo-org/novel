export type ProfessionalFrontdoorSearchParams = Record<
  string,
  string | string[] | undefined
>;

const LEGACY_PROFESSIONAL_PATH = "/legacy/novel-system.html";
const SAFE_QUERY_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MAX_QUERY_VALUE_LENGTH = 2048;

function queryValues(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

export function buildProfessionalFrontdoorUrl(
  searchParams: ProfessionalFrontdoorSearchParams = {},
) {
  const query = new URLSearchParams();
  query.set("mode", "professional");

  for (const key of Object.keys(searchParams).sort()) {
    if (key === "mode" || !SAFE_QUERY_KEY.test(key)) continue;
    for (const value of queryValues(searchParams[key])) {
      if (value.length <= MAX_QUERY_VALUE_LENGTH) query.append(key, value);
    }
  }

  return `${LEGACY_PROFESSIONAL_PATH}?${query.toString()}`;
}
