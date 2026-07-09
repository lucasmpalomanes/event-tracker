import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server blocks cross-origin asset requests by default, which
  // breaks hydration (all buttons dead) when testing from a phone on the
  // LAN. Adjust if your machine's LAN IP changes.
  allowedDevOrigins: ["192.168.0.60"],
};

export default nextConfig;
