export const STUDIO_ORIGIN_ERROR = "ORIGIN_COMMAND_MISMATCH";

export type StudioOriginResolution =
  | { ready: true; origin: string }
  | { ready: false; origin: null; reason: "ssr" | "invalid" };

export function validateEnrollableOrigin(value: string): string {
  if (!value || value === "null" || value.includes("*")) throw new Error(STUDIO_ORIGIN_ERROR);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(STUDIO_ORIGIN_ERROR); }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(STUDIO_ORIGIN_ERROR);
  if (local ? !["http:", "https:"].includes(url.protocol) : url.protocol !== "https:") throw new Error(STUDIO_ORIGIN_ERROR);
  if (!local && (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || /^\[.*\]$/.test(url.hostname))) throw new Error(STUDIO_ORIGIN_ERROR);
  return url.origin;
}

export function resolveCurrentStudioOrigin(locationLike?: Pick<Location, "origin"> | null): StudioOriginResolution {
  if (!locationLike) return { ready: false, origin: null, reason: "ssr" };
  try { return { ready: true, origin: validateEnrollableOrigin(locationLike.origin) }; }
  catch { return { ready: false, origin: null, reason: "invalid" }; }
}

export function buildOriginEnrollmentCommand(origin: string): string {
  const exactOrigin = validateEnrollableOrigin(origin);
  return `node local-ai/bridge/launcher.mjs origin add ${exactOrigin} --confirm ${exactOrigin}`;
}

export function assertEnrollmentCommandMatchesPage(commandOrigin: string, pageOrigin: string): string {
  const exactCommandOrigin = validateEnrollableOrigin(commandOrigin);
  const exactPageOrigin = validateEnrollableOrigin(pageOrigin);
  if (exactCommandOrigin !== exactPageOrigin) throw new Error(STUDIO_ORIGIN_ERROR);
  return exactCommandOrigin;
}
