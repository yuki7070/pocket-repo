import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle so the app can be shipped and run
  // from the published npm package via `npx pocket-repo`.
  output: "standalone",
  allowedDevOrigins: ["192.168.50.251", "100.100.49.3"],
  poweredByHeader: false
};

export default nextConfig;
