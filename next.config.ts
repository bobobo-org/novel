import type { NextConfig } from "next";

const LEGACY_PROFESSIONAL_PATH =
  "/legacy/novel-system.html?mode=professional";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/studio",
        destination: LEGACY_PROFESSIONAL_PATH,
        permanent: false,
      },
      {
        source: "/studio/:path*",
        destination: LEGACY_PROFESSIONAL_PATH,
        permanent: false,
      },
      {
        source: "/professional",
        destination: LEGACY_PROFESSIONAL_PATH,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
