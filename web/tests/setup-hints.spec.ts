import { expect, type Page, test } from "@playwright/test";

// Setup suggestions: a YouTrack with no AI CLI and no workflow for the role shows where the AI would be (locked, with the
// way to set it up) and says why the State menu lists every State; the bot lists what is worth setting up, and both
// switch off from one place.

const NOW = Date.now(), DAY = 864e5;
const ticket = { id: "VA-1", summary: "Việc 1", created: NOW - 9 * DAY, updated: NOW - 9e6, resolved: null, type: "Task", state: "Open",
  priority: "Normal", assignee: "Anh", assigneeLogin: "anh", qc: "Anh", qcLogin: "anh", reporter: "Bình", due: null, estimate: null, sprints: [] };

async function youtrack(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ytMode", "qa"));
  await page.route("**/api/status", async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), youtrack_configured: true } }));
  await page.route("**/api/yt/config", (r) => r.fulfill({ json: { base: "https://yt.test", mock: false, t: { wip: 3, stale: 7, dead: 14 }, hist: 0, ai: false } }));
  await page.route("**/api/yt/projects", (r) => r.fulfill({ json: [{ shortName: "VA", name: "VA" }] }));
  await page.route("**/api/yt/me", (r) => r.fulfill({ json: { login: "anh", name: "Anh" } }));
  await page.route(/\/api\/yt\/issues\?/, (r) => r.fulfill({ json: [ticket] }));
  await page.route(/\/api\/yt\/issue\?id=VA-1/, (r) => r.fulfill({ json: { ...ticket, description: "", comments: [], links: [], attachments: [] } }));
  await page.route(/\/api\/yt\/people\?/, (r) => r.fulfill({ json: [{ login: "anh", name: "Anh" }] }));
  await page.route(/\/api\/yt\/fields\?/, (r) => r.fulfill({ json: { State: ["Open", "In Progress", "Done"], Priority: ["Normal"], Type: ["Task"] } }));
  await page.route(/\/api\/yt\/workflow\?/, (r) => r.fulfill({ json: { states: ["Open", "In Progress", "Done"], on: false, pos: {}, edges: [], hidden: [] } }));
  await page.route(/\/api\/yt\/(sprints|statesince|asked|mentions)/, (r) => r.fulfill({ json: [] }));
  await page.route(/\/api\/yt\/transitions\?/, (r) => r.fulfill({ json: { rows: [], since: null } }));
}

test("no AI, no workflow: the AI spots show locked, the State menu says why and walks to the workflow", async ({ page }) => {
  await youtrack(page);
  await page.goto("/youtrack/");
  await expect(page.getByRole("region", { name: "AI Studio" })).toContainText("Cần một AI CLI");
  await page.goto("/youtrack/?view=tickets");
  await page.locator("tbody tr[data-id]").first().click();
  await expect(page.getByRole("button", { name: "AI cho ticket này" })).toBeVisible();
  await page.getByRole("button", { name: "Đổi State VA-1" }).click();
  const tip = page.getByRole("note").filter({ hasText: "chưa bật workflow" });
  await expect(tip).toBeVisible();
  await tip.getByRole("button", { name: "Vẽ workflow" }).click();
  await expect(page).toHaveURL(/\/settings\//);
  // a hint goes straight to the settings (the ticket sheet closes with the page) and walks from there
  const box = page.getByRole("dialog", { name: /^Hướng dẫn:/ }), ring = page.locator("[data-guide-tour] > div[aria-hidden]");
  const lit = async (n: number, at: ReturnType<Page["locator"]>) => {
    await expect(box).toContainText(`Bước ${n}/5`);
    await expect.poll(async () => { const r = await ring.boundingBox(), c = await at.boundingBox();
      return !!r && !!c && r.x + r.width / 2 >= c.x && r.x + r.width / 2 <= c.x + c.width && r.y + r.height / 2 >= c.y && r.y + r.height / 2 <= c.y + c.height; }).toBe(true);
    await page.waitForTimeout(400); // the ring and the shade's hole move in 300 ms
  };
  const nav = page.locator('nav[aria-label="Mục cài đặt"] a[href="#youtrack"]');
  await lit(1, nav);
  await nav.click();
  const group = page.getByRole("group", { name: "Nhóm cài đặt YouTrack" }).getByRole("button", { name: "Workflow" }).or(page.getByRole("radio", { name: "Workflow" }));
  await lit(2, group.first());
  await group.first().click();
  await lit(3, page.getByRole("button", { name: "Lấy từ YouTrack" }));
});

test("no workflow: the bulk State menu and the Board say so too, and one Để sau hides it everywhere", async ({ page }) => {
  await youtrack(page);
  await page.goto("/youtrack/?view=tickets");
  await page.getByLabel("Chọn tất cả ticket đang hiện").check();
  await page.getByRole("region", { name: "Thao tác hàng loạt" }).getByRole("button", { name: "Đổi State cho các ticket đã chọn" }).click();
  const tip = page.getByRole("note").filter({ hasText: "chưa bật workflow" });
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bỏ chọn" }).click();
  await page.getByRole("radio", { name: "Board" }).or(page.getByRole("button", { name: "Board", exact: true })).first().click();
  await expect(tip).toBeVisible(); // above the Board
  await tip.getByRole("button", { name: "Để sau" }).click();
  await expect(tip).toBeHidden();
  await page.getByText("Việc 1").first().click(); // a card opens its ticket
  await page.getByRole("button", { name: "Đổi State VA-1" }).click();
  await expect(page.getByRole("listbox", { name: "Đổi State VA-1" })).toBeVisible();
  await expect(tip).toBeHidden(); // the same hint in the ticket's menu
});

test("the bot lists what is worth setting up, and it switches off", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ytMode", "qa"); localStorage.removeItem("aiIntro"); localStorage.removeItem("setupTips"); });
  await page.goto("/settings/");
  await page.keyboard.press("F1");
  const panel = page.locator("[data-gb-panel]");
  const nice = panel.getByText(/Nên làm để AI hiểu đúng việc/);
  await expect(nice).toBeVisible();
  await expect(panel.getByRole("button", { name: "Giới thiệu bản thân cho AI" })).toBeVisible();
  await panel.getByRole("button", { name: "Không cần gợi ý nữa" }).click();
  await expect(nice).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("setupTips"))).toBe("0");
});
