import { defineConfig, devices } from "@playwright/test";

// The UI flow engine specs open a static fixture via file://, so they need no backend (no webServer).
// Run: npx playwright test -c playwright.uiflow.config.ts
export default defineConfig({
  testDir: "tests",
  testMatch: "uiflow.spec.ts",
  reporter: "list",
  use: { trace: "retain-on-failure", locale: "vi-VN" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
