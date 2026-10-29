import { defineConfig, devices } from "@playwright/test";

// Runs against the static build (npm run build) served by an isolated fixture backend.
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:8765", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "uv run --no-sync python web/tests/fixture_server.py",
    cwd: "..",
    url: "http://127.0.0.1:8765/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
