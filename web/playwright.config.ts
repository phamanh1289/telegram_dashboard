import { defineConfig, devices } from "@playwright/test";

// Runs against the static build (npm run build) served by an isolated fixture backend, on its own port: the real
// dashboard keeps :8765.
const PORT = process.env.E2E_PORT ?? "8766";
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "uv run --no-sync python web/tests/fixture_server.py",
    cwd: "..",
    url: `http://127.0.0.1:${PORT}/health`,
    env: { E2E_PORT: PORT },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
