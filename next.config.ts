import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Payment proofs are user-supplied images. 5MB cap matches the upload route.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;