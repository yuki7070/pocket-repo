import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.50.251", "100.100.49.3"],
  poweredByHeader: false
};

export default nextConfig;
