import type { NextConfig } from "next";

/**
 * Sent with every page. No other site may frame GigaCAD (clickjacking), and pages can't be
 * re-based or embed plugins. A script policy needs per-request nonces, which would make every
 * page dynamic, so it isn't set yet.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Browsers ignore this over plain http, so local development is unaffected.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const config: NextConfig = {
  // Shared workspace rules (manifest diffs, handle rules). Bundled from its build output.
  transpilePackages: ["@gigacad/core"],
  experimental: {
    // Avatars go through a server action and may be up to 1 MB, the default limit.
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
