import type { NextConfig } from "next";

const LEGACY_PROFESSIONAL_PATH =
  "/legacy/novel-system.html?mode=professional";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
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
  async redirects() {
    return [
      {
        source: "/professional",
        destination: LEGACY_PROFESSIONAL_PATH,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
