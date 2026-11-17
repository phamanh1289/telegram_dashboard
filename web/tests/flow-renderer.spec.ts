import { expect, test } from "@playwright/test";

const CONTROL = `http://127.0.0.1:${process.env.E2E_CONTROL ?? "8799"}`;
async function ctl(path: string, body?: object) {
  return (await fetch(`${CONTROL}${path}`, {
    method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })).json();
}

test("renderer mount failure retries the existing saved flow without calling AI", async ({ page }) => {
  await ctl("/set", { yt: true, reset_jobs: true, flow: "file", flow_save: "ok", flow_posts: [], ai_ms: 0, ai_calls: 0, save_ms: 0 });
  try {
    await page.addInitScript(() => localStorage.setItem("ytMode", "dev"));
    await page.route("**/uiflow.js", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      await route.fulfill({ response, body: source + `
        (() => {
          const original = window.UIFlow;
          let attempts = 0;
          window.UIFlow = { ...original, mount(host, flow, options) {
            if (++attempts === 1) {
              host.innerHTML = '<div data-partial-renderer>partial mount</div>';
              throw new Error('Synthetic renderer mount failure');
            }
            return original.mount(host, flow, options);
          } };
        })();` });
    });
    await page.goto("/youtrack?ticket=VA-1");
    await page.getByRole("button", { name: "UI flow", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "UI flow VA-1" });
    await expect(dialog.getByRole("alert")).toHaveText("Synthetic renderer mount failure");
    await expect(dialog.locator("[data-partial-renderer]")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Thử lại", exact: true }).click();
    await expect(dialog.locator(".uf-screen")).toHaveCount(4);
    await expect(dialog.getByText("Synthetic renderer mount failure")).toHaveCount(0);
    const state = await ctl("/state");
    expect(state.ai_calls).toBe(0);
    expect(state.flow_posts).toEqual([]);
  } finally {
    await ctl("/set", { yt: false });
  }
});
