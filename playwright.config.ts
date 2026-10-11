import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  webServer: { command: "npm run dev -- --port 5199", port: 5199, reuseExistingServer: true },
  use: {
    baseURL: "http://localhost:5199",
    headless: true,
    // Ask headless Chromium for a software WebGPU adapter; the search e2e falls back to CPU mode if none appears.
    launchOptions: { args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] },
  },
});
