import { expect, test } from "@playwright/test";
const control = `http://127.0.0.1:${process.env.E2E_CONTROL ?? "8799"}`;
test("source manifest and review warning survive closing and restoring a draft", async ({ page }) => {
  await fetch(`${control}/set`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yt: true, reset_jobs: true, flow: "none", ai_calls: 0, ai_ms: 0, manifest: { estimated_input_tokens: 1000, budget: 12000, measurement: "estimated", sources: ["VA-1"], omitted: [{ source: "design", kind: "labels", count: 2 }], warnings: ["Cần xác nhận màn thiếu nguồn"] } }) });
  await page.addInitScript(() => localStorage.setItem("ytMode", "dev"));
  await page.goto("/youtrack?ticket=VA-1");
  const button = page.getByRole("button", { name: "UI flow", exact: true });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "UI flow VA-1" });
  await dialog.getByRole("button", { name: "Render bằng AI" }).click();
  await expect(dialog.getByText("Cần xác nhận màn thiếu nguồn")).toBeVisible();
  await expect(dialog.getByText("Đầu vào ước lượng: 1000/12000 token")).toBeVisible();
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await button.click();
  await expect(dialog.getByText("Cần xác nhận màn thiếu nguồn")).toBeVisible();
});
