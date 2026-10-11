import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        kvNamespaces: ["QUOTA"],
        bindings: {
          ANTHROPIC_API_KEY: "test-key",
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          SESSION_SECRET: "test-session-secret",
          ALLOWED_ORIGIN: "http://localhost:5173,http://localhost:5175",
          TURNSTILE_HOSTNAMES: "localhost",
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
