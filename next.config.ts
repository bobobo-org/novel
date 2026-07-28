import type { NextConfig } from "next";

const LEGACY_PROFESSIONAL_PATH =
  "/legacy/novel-system.html?mode=professional";
const LEGACY_CONSUMER_PATH = "/legacy/novel-system.html";

const nextConfig: NextConfig = {
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
        source: "/studio",
        destination: LEGACY_CONSUMER_PATH,
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
