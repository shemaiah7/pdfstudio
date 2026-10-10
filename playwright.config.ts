import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  webServer: { command: "npm run dev -- --port 5199", port: 5199, reuseExistingServer: true },
  use: { baseURL: "http://localhost:5199", headless: true },
});
