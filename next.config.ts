import type { NextConfig } from "next";
import { resolve } from "node:path";

const browserProseDiagnosticsRequested =
  process.env.NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS === "1";
const browserSetupDiagnosticsRequested =
  process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS === "1";
const productionDeployment = process.env.VERCEL_ENV === "production";

if (
  productionDeployment
  && (browserProseDiagnosticsRequested || browserSetupDiagnosticsRequested)
) {
  throw Object.assign(
    new Error("RC6_4_PRODUCTION_DIAGNOSTICS_MUST_BE_DISABLED"),
    { code: "RC6_4_PRODUCTION_DIAGNOSTICS_MUST_BE_DISABLED" },
  );
}

const browserProseDiagnosticsCompiled =
  browserProseDiagnosticsRequested && !productionDeployment;
const browserSetupDiagnosticsCompiled =
  browserSetupDiagnosticsRequested && !productionDeployment;
const disabledDiagnosticFacade =
  "./lib/novel-ai/web/browser-prose-diagnostic-disabled.ts";
const disabledDiagnosticAliases = {
  ...(browserProseDiagnosticsCompiled
    ? {}
    : {
        "@/lib/novel-ai/web/browser-prose-diagnostic-bridge":
          disabledDiagnosticFacade,
      }),
  ...(browserSetupDiagnosticsCompiled
    ? {}
    : {
        "@/lib/novel-ai/providers/browser-ai/browser-ai-setup-diagnostics":
          disabledDiagnosticFacade,
      }),
};

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  env: {
    NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS:
      browserProseDiagnosticsCompiled ? "1" : "0",
    NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS:
      browserSetupDiagnosticsCompiled ? "1" : "0",
  },
  turbopack: {
    resolveAlias: disabledDiagnosticAliases,
  },
  webpack(config) {
    if (Object.keys(disabledDiagnosticAliases).length === 0) return config;
    const existingAliases = config.resolve?.alias
      && !Array.isArray(config.resolve.alias)
      ? config.resolve.alias
      : {};
    config.resolve = {
      ...config.resolve,
      alias: {
        ...existingAliases,
        ...Object.fromEntries(Object.keys(disabledDiagnosticAliases).map(
          (specifier) => [specifier, resolve(disabledDiagnosticFacade)],
        )),
      },
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/legacy/novel-system.html",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/legacy/novel-system.build.json",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
