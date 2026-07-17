import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/studio", destination: "/legacy/novel-system.html" }];
  },
};

export default nextConfig;
