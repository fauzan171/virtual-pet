import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Qwen realtime ASR relies on native Node WebSocket framing/masking.
  // Bundling `ws` into a Route Handler breaks its native buffer utilities.
  serverExternalPackages: ['ws'],
  // The machine also has a parent-level lockfile. Pin both roots to this repo
  // so Next does not trace or resolve dependencies from /Users/mekari.
  outputFileTracingRoot: process.cwd(),
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
