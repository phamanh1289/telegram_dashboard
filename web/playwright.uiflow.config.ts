import { defineConfig, devices } from "@playwright/test";

// The UI flow engine specs open a static fixture via file://, and the workflow geometry spec needs no page: no backend (no webServer).
// Run: npx playwright test -c playwright.uiflow.config.ts
export default defineConfig({
  testDir: "tests",
  testMatch: ["uiflow-{map,prototype,editor,lifecycle,zeplin,annotations,memos}.spec.ts", "workflow-graph.spec.ts"],
  reporter: "list",
  use: { trace: "retain-on-failure", locale: "vi-VN" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
