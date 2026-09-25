import type { NextConfig } from "next";

const config: NextConfig = {
  // Shared workspace rules (manifest diffs, handle rules). Bundled from its build output.
  transpilePackages: ["@gigacad/core"],
};

export default config;
