import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "extension/**/*.test.js"],
    environmentMatchGlobs: [["src/components/**", "jsdom"]],
  },
});
