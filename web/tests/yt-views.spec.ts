import { expect, type Page, test } from "@playwright/test";

// YouTrack tab, faked per test: bulk edits through saveTicket, the dashboard's bars by keyboard and its cut-window note,
// the saved report folding only when long.

const NOW = Date.now(), DAY = 864e5;
const tk = (n: number, state: string, extra: Record<string, unknown> = {}) => ({ id: `VA-${n}`, summary: `Việc ${n}`, created: NOW - 9 * DAY, updated: NOW - 9e6, resolved: null, type: "Task", state,
  priority: "Normal", assignee: "Anh", assigneeLogin: "anh", qc: null, qcLogin: null, reporter: "Bình", due: null, estimate: null, sprints: [], ...extra });

async function setup(page: Page, tickets: unknown[], since: number | null = null) {
  await page.addInitScript(() => localStorage.setItem("ytMode", "dev"));
  await page.route("**/api/status", async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), youtrack_configured: true } }));
  await page.route("**/api/yt/config", (r) => r.fulfill({ json: { base: "https://yt.test", mock: false, t: { wip: 3, stale: 7, dead: 14 }, hist: 0, ai: false } }));
  await page.route("**/api/yt/projects", (r) => r.fulfill({ json: [{ shortName: "VA", name: "VA" }] }));
  await page.route("**/api/yt/me", (r) => r.fulfill({ json: { login: "anh", name: "Anh" } }));
  await page.route(/\/api\/yt\/issues\?/, (r) => r.fulfill({ json: tickets }));
  await page.route(/\/api\/yt\/people\?/, (r) => r.fulfill({ json: [{ login: "anh", name: "Anh" }, { login: "binh", name: "Bình" }] }));
  await page.route(/\/api\/yt\/fields\?/, (r) => r.fulfill({ json: { State: ["Open", "In Progress", "Done"], Priority: ["Normal", "Major"], Type: ["Task"] } }));
  await page.route(/\/api\/yt\/workflow\?/, (r) => r.fulfill({ json: { states: ["Open", "In Progress", "Done"], pos: {}, edges: [["Open", "Done"], ["Done", "Open"]], hidden: [] } }));
  await page.route(/\/api\/yt\/sprints/, (r) => r.fulfill({ json: [] }));
  await page.route(/\/api\/yt\/statesince/, (r) => r.fulfill({ json: {} }));
  await page.route(/\/api\/yt\/asked\?/, (r) => r.fulfill({ json: [] }));
  await page.route(/\/api\/yt\/transitions\?/, (r) => r.fulfill({ json: { rows: [], since } }));
}

test("bulk State change: shown at once, one toast, the failed one stays picked, undo puts the rest back", async ({ page }) => {
  await setup(page, [tk(1, "Open"), tk(2, "Open"), tk(3, "Open")]);
  const calls: { id: string; value: string }[] = [];
  await page.route("**/api/yt/issue/field", async (r) => {
    const b = r.request().postDataJSON();
    calls.push(b);
    if (b.id === "VA-3" && b.value === "Done") return r.fulfill({ status: 400, json: { error: "không cho" } });
    await new Promise((res) => setTimeout(res, 800));
    return r.fulfill({ json: tk(+b.id.slice(3), b.value) });
  });
  await page.goto("/youtrack/?view=tickets");
  await page.getByLabel("Chọn tất cả ticket đang hiện").check();
  const bar = page.getByRole("region", { name: "Thao tác hàng loạt" });
  await bar.getByRole("button", { name: "Đổi State cho các ticket đã chọn" }).click();
  await page.getByRole("option", { name: "Done" }).click();
  const row = (n: number) => page.getByRole("row").filter({ hasText: `VA-${n}` });
  await expect(row(1).getByLabel("Trạng thái: Done")).toBeVisible({ timeout: 600 }); // before the server's answer (800 ms)
  await expect(page.getByRole("status").filter({ hasText: "2 ticket → Done" })).toContainText("Lỗi 1 ticket — VA-3: không cho");
  await expect(row(3).getByLabel("Trạng thái: Open")).toBeVisible();
  await expect(bar).toContainText("1 ticket đã chọn");
  await page.getByRole("button", { name: "Hoàn tác" }).click();
  await expect(row(1).getByLabel("Trạng thái: Open")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đã hoàn tác" })).toBeVisible();
  expect(calls.filter((c) => c.value === "Open").map((c) => c.id).sort()).toEqual(["VA-1", "VA-2"]);
});

test("dashboard: a day's bar opens its tickets by keyboard, and a cut window is said", async ({ page }) => {
  const done = (n: number, ago: number) => tk(n, "Done", { resolved: NOW - ago * DAY, updated: NOW - ago * DAY });
  await setup(page, [done(1, 1), done(2, 1), done(3, 3), tk(4, "Open")], NOW - 5 * DAY);
  await page.goto("/youtrack/?view=dash");
  const bars = page.locator("svg[role=group] [role=button]");
  await expect(bars.first()).toBeVisible();
  await expect(bars.first()).toHaveAttribute("tabindex", "0");
  await expect(bars.first()).toHaveAttribute("aria-label", /xong: 1$/);
  await bars.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(bars.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("VA-1");
  await expect(page.getByRole("dialog")).toContainText("VA-2");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("note")).toContainText("số liệu test chỉ tính từ");
});

for (const [name, lines] of [["long", 80], ["short", 2]] as const) {
  test(`saved report (${name}): folds only when long, the fold animates open`, async ({ page }) => {
    await setup(page, [tk(1, "Open")]);
    await page.addInitScript((n) => {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
      localStorage.setItem(`ytReport:VA:dev:${day}`, JSON.stringify({ at: Date.now(), text: Array.from({ length: n }, (_, k) => `- dòng báo cáo ${k + 1}`).join("\n") }));
    }, lines);
    await page.goto("/youtrack/");
    const first = page.getByText("dòng báo cáo 1", { exact: true });
    await expect(first).toBeVisible();
    const box = first.locator("xpath=ancestor::div[contains(@class,'overflow-hidden')][1]");
    const more = page.getByRole("button", { name: "Xem đầy đủ" });
    if (name === "short") { await expect(more).toHaveCount(0); expect((await box.boundingBox())!.height).toBeLessThan(288); return; }
    await expect(more).toHaveAttribute("aria-expanded", "false");
    expect(Math.round((await box.boundingBox())!.height)).toBe(288);
    await more.click();
    await expect(page.getByRole("button", { name: "Thu gọn", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(600);
    await page.getByRole("button", { name: "Thu gọn", exact: true }).click();
    await expect.poll(async () => Math.round((await box.boundingBox())!.height)).toBe(288);
  });
}
