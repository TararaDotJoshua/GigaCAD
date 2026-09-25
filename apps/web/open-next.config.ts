import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// Prerendered pages (the docs) are served from the build's static assets. Without an
// incremental cache the worker can't find them and throws NoFallbackError. Nothing in
// the app revalidates, so a read-only cache is enough.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
