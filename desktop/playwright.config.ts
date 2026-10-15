import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "test", testMatch: "*.e2e.ts", timeout: 60000 });
