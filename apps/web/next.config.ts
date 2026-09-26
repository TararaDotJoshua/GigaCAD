import type { NextConfig } from "next";

const config: NextConfig = {
  // Shared workspace rules (manifest diffs, handle rules). Bundled from its build output.
  transpilePackages: ["@gigacad/core"],
  experimental: {
    // Avatars go through a server action and may be up to 1 MB, the default limit.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;
