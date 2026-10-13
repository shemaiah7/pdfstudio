import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { join } from "node:path";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(join(__dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          kvNamespaces: ["QUOTA"],
          d1Databases: ["DB"],
          bindings: {
            ANTHROPIC_API_KEY: "test-key",
            TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
            SESSION_SECRET: "test-session-secret",
            ALLOWED_ORIGIN: "http://localhost:5173,http://localhost:5175",
            TURNSTILE_HOSTNAMES: "localhost",
            ELEVENLABS_API_KEY: "el-test-key",
            ELEVENLABS_AGENT_ID: "agent_test",
            VOICE_DAILY_SECONDS: "1800",
            PAYWALL_ENABLED: "false",
            CLERK_ISSUER: "https://clerk.test",
            CLERK_SECRET_KEY: "sk_test_clerk",
            STRIPE_SECRET_KEY: "sk_test_stripe",
            STRIPE_WEBHOOK_SECRET: "whsec_test",
            STRIPE_PRICE_MONTHLY: "price_month",
            STRIPE_PRICE_YEARLY: "price_year",
            APP_URL: "http://localhost:5173",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"] },
  };
});
