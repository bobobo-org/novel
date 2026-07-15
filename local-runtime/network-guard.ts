export type NetworkGuardDecision = {
  allowed: boolean;
  reason: string;
  url: string;
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const LOCAL_PORTS = new Set(["", "11434", "3217", "3218", "3100"]);

export function checkLocalOnlyUrl(input: string | URL): NetworkGuardDecision {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(String(input));
  } catch {
    return { allowed: false, reason: "invalid_url", url: String(input) };
  }
  if (!["http:", "ws:"].includes(url.protocol)) {
    return { allowed: false, reason: "protocol_not_allowed", url: url.toString() };
  }
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    return { allowed: false, reason: "non_localhost_blocked", url: url.toString() };
  }
  if (!LOCAL_PORTS.has(url.port)) {
    return { allowed: false, reason: "port_not_allowed", url: url.toString() };
  }
  return { allowed: true, reason: "localhost_allowed", url: url.toString() };
}

export function createNetworkGuard() {
  const denials: NetworkGuardDecision[] = [];
  const approvals: NetworkGuardDecision[] = [];
  return {
    assert(input: string | URL) {
      const decision = checkLocalOnlyUrl(input);
      if (decision.allowed) approvals.push(decision);
      else denials.push(decision);
      return decision;
    },
    report() {
      return {
        externalRequestCount: 0,
        blockedExternalCount: denials.length,
        dataLeftDevice: false,
        approvals,
        denials,
      };
    },
  };
}
