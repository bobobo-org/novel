export const BROWSER_LIVENESS_FAILURE_CODES = Object.freeze([
  "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT",
  "BROWSER_CONTROL_CHANNEL_LOST_DURING_OPERATOR_WAIT",
  "PREVIEW_PAGE_LOST_DURING_OPERATOR_WAIT",
  "PREVIEW_URL_CHANGED_DURING_OPERATOR_WAIT",
  "VISIBLE_BROWSER_WINDOW_LOST_DURING_OPERATOR_WAIT",
  "BROWSER_PROFILE_MISMATCH_DURING_OPERATOR_WAIT",
  "BRIDGE_PROCESS_LOST_DURING_OPERATOR_WAIT",
  "ORIGIN_ENROLLMENT_LOST_DURING_OPERATOR_WAIT",
]);

function fail(code, message, snapshot) {
  const error = new Error(message);
  error.code = code;
  error.livenessState = snapshot;
  error.reusableForAcceptance = false;
  throw error;
}

export function validateBrowserLiveness(snapshot, expected = {}) {
  const state = { checkedAt: new Date().toISOString(), ...snapshot };
  if (!state.harnessProcessAlive) {
    fail("BROWSER_CONTROL_CHANNEL_LOST_DURING_OPERATOR_WAIT", "Harness process is no longer alive.", state);
  }
  if (!state.browserProcessAlive || state.browserPid !== expected.browserPid) {
    fail("BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT", "Expected browser process is missing or was replaced.", state);
  }
  if (!state.executableIdentityMatches || !state.sessionMatches || !state.userMatches) {
    fail("BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT", "Expected browser identity, session, or user no longer matches.", state);
  }
  if (!state.profileMatches || state.profilePath !== expected.profilePath) {
    fail("BROWSER_PROFILE_MISMATCH_DURING_OPERATOR_WAIT", "Browser profile no longer matches the current run.", state);
  }
  if (!state.commandLineCompliant) {
    fail("BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT", "Browser command line is no longer compliant.", state);
  }
  if (!state.controlChannelResponsive || !state.cdpIdentityMatches || !state.browserContextConnected) {
    fail("BROWSER_CONTROL_CHANNEL_LOST_DURING_OPERATOR_WAIT", "Browser control channel is unavailable or changed identity.", state);
  }
  if (!state.previewPageOpen) {
    fail("PREVIEW_PAGE_LOST_DURING_OPERATOR_WAIT", "Preview page was closed during operator wait.", state);
  }
  if (!state.previewUrlExact || state.previewUrl !== expected.previewUrl) {
    fail("PREVIEW_URL_CHANGED_DURING_OPERATOR_WAIT", "Preview page URL changed during operator wait.", state);
  }
  if (!state.visibleWindowPresent) {
    fail("VISIBLE_BROWSER_WINDOW_LOST_DURING_OPERATOR_WAIT", "Visible browser window is no longer present.", state);
  }
  if (!state.bridgeProcessAlive || !state.bridgeLoopbackOnly) {
    fail("BRIDGE_PROCESS_LOST_DURING_OPERATOR_WAIT", "Local Bridge is unavailable or no longer loopback-only.", state);
  }
  if (!state.originEnrolled || state.enrolledOrigin !== expected.origin) {
    fail("ORIGIN_ENROLLMENT_LOST_DURING_OPERATOR_WAIT", "Exact Preview origin is no longer enrolled.", state);
  }
  return { ...state, status: "ALIVE" };
}

export function correlateBridgeTraffic(row, expected) {
  const timestamp = Date.parse(String(row?.timestamp || ""));
  const start = Date.parse(String(expected.runStartedAt || ""));
  const end = Date.parse(String(expected.runEndedAt || new Date().toISOString()));
  const originMatches = row?.origin === expected.origin;
  const userAgentMatches = String(row?.user_agent || "").includes(expected.userAgentToken);
  const hostMatches = ["127.0.0.1:3217", "localhost:3217"].includes(String(row?.host || "").toLowerCase());
  const timestampMatches = Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
  const correlated = Boolean(
    row?.request_received && originMatches && userAgentMatches && hostMatches && timestampMatches
      && expected.browserAliveAtRequest && expected.controlChannelConnectedAtRequest
      && expected.previewPageOpenAtRequest && expected.uiActionAt,
  );
  return {
    correlated,
    timestampMatches,
    originMatches,
    userAgentMatches,
    hostMatches,
    browserAliveAtRequest: Boolean(expected.browserAliveAtRequest),
    controlChannelConnectedAtRequest: Boolean(expected.controlChannelConnectedAtRequest),
    previewPageOpenAtRequest: Boolean(expected.previewPageOpenAtRequest),
    uiActionCorrelated: Boolean(expected.uiActionAt),
  };
}
