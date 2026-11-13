import { expect, type Page, test } from "@playwright/test";

// The UI flow dialog in the ticket sheet (fixture_server.py fakes ticket VA-1, its uiflow file, the AI run and the save).
// Edits by dragging come with the editor (Task 7); here the unsaved change is an AI result, which needs Cập nhật too.
const CONTROL = `http://127.0.0.1:${process.env.E2E_CONTROL ?? "8799"}`;

async function ctl(path: string, body?: object) {
  const res = await fetch(`${CONTROL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
type Post = { id: string; base: string | null; flow: { rev: number; screens: { id: string; x?: number }[] } };
const posts = async () => (await ctl("/state")).flow_posts as Post[];

const BAR = "Có thay đổi chưa lưu — cập nhật file trên ticket?";
const dialog = (page: Page) => page.getByRole("dialog", { name: "UI flow VA-1" });

async function openFlow(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ytMode", "dev")); // the role is asked for once, per browser
  await page.goto("/youtrack?ticket=VA-1");
  await page.getByRole("button", { name: "UI flow", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

/** No file yet: write a note, run the AI, wait for its flow on the map. */
async function render(page: Page) {
  const d = dialog(page);
  await d.getByLabel("Ghi chú thêm cho AI").fill("chỉ luồng đăng nhập");
  await d.getByRole("button", { name: "Render bằng AI" }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
}

test.beforeEach(async () => {
  await ctl("/set", { flow: "file", flow_save: "ok", flow_posts: [], ai_ms: 0 });
});

test("ticket detail opens the saved UI flow, from the button and from its file row", async ({ page }) => {
  await openFlow(page);
  const d = dialog(page);
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await expect(d.getByText(BAR)).toHaveCount(0);
  await expect(d.getByLabel("Ghi chú thêm cho AI")).toHaveCount(0);
  await page.keyboard.press("Escape"); // closes the dialog only, the ticket stays open
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Đăng nhập bằng OTP" })).toBeVisible();
  await page.getByRole("button", { name: /uiflow-VA-1\.html/ }).click();
  await expect(dialog(page).locator(".uf-screen")).toHaveCount(4);
});

test("no file yet: prompt box at the bottom, AI result is unsaved until Cập nhật, which posts it", async ({ page }) => {
  await ctl("/set", { flow: "none", ai_ms: 600 });
  await openFlow(page);
  const d = dialog(page);
  const box = await d.getByLabel("Ghi chú thêm cho AI").boundingBox();
  const dlg = await d.boundingBox();
  expect(dlg!.y + dlg!.height - (box!.y + box!.height)).toBeLessThan(80); // pinned to the bottom
  await d.getByLabel("Ghi chú thêm cho AI").fill("chỉ luồng đăng nhập");
  await d.getByRole("button", { name: "Render bằng AI" }).click();
  await expect(d.getByRole("button", { name: "Dừng" })).toBeVisible(); // running: the stop button in the box
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await expect(d.getByText(BAR)).toBeVisible();
  expect(await posts()).toEqual([]);
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByText(BAR)).toHaveCount(0);
  await expect(d.getByText("Để sau: Nhập OTP → Trang chủ")).toBeVisible(); // what changed, from the server
  const [p] = await posts();
  expect(p.id).toBe("VA-1");
  expect(p.base).toBeNull();
  expect(p.flow.screens.map((s) => s.id)).toEqual(["login", "code", "err", "home"]);
  expect(typeof p.flow.screens[0].x).toBe("number"); // laid out by the engine
});

test("re-render over a saved file posts with its base; Không hides the bar and sends nothing", async ({ page }) => {
  await openFlow(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Thao tác UI flow" }).click();
  await page.getByRole("menuitem", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
  await expect(d.getByText(BAR)).toBeVisible();
  await d.getByRole("button", { name: "Không", exact: true }).click();
  await expect(d.getByText(BAR)).toHaveCount(0);
  expect(await posts()).toEqual([]);
  // closing with an unsaved change asks first
  await d.getByRole("button", { name: "Đóng" }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Bỏ thay đổi chưa lưu?");
  await ask.getByRole("button", { name: "Hủy" }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  // the same change, saved over the opened file
  await d.getByRole("button", { name: "Thao tác UI flow" }).click();
  await page.getByRole("menuitem", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
  await expect(d.getByText(BAR)).toBeVisible();
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByText(BAR)).toHaveCount(0);
  const [p] = await posts();
  expect(p).toMatchObject({ id: "VA-1", base: "1-1" });
});

test("409 shows the conflict message and keeps my edit until Xem bản mới", async ({ page }) => {
  await ctl("/set", { flow: "none", flow_save: "409" });
  await openFlow(page);
  const d = dialog(page);
  await render(page);
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByText("UI flow vừa được người khác cập nhật")).toBeVisible();
  await expect(d.getByText(BAR)).toBeVisible(); // my change is still there to save
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await ctl("/set", { flow: "file" });
  await d.getByRole("button", { name: "Xem bản mới" }).click();
  await expect(d.getByText(BAR)).toHaveCount(0);
  await expect(d.getByText("UI flow vừa được người khác cập nhật")).toHaveCount(0);
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  expect(await posts()).toHaveLength(1);
});

test("a save of unknown outcome shows the server's words, keeps the change and never retries", async ({ page }) => {
  await ctl("/set", { flow: "none", flow_save: "502" });
  await openFlow(page);
  const d = dialog(page);
  await render(page);
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByText("Không rõ đã lưu chưa — mở lại UI flow để kiểm tra trước khi lưu lại")).toBeVisible();
  await expect(d.getByText(BAR)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await posts()).toHaveLength(1);
});

test("GET /flow failing shows the error, not the empty state", async ({ page }) => {
  await ctl("/set", { flow: "fail" });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.getByRole("alert")).toContainText("YouTrack 502 khi tải tệp");
  await expect(d.getByLabel("Ghi chú thêm cho AI")).toHaveCount(0); // no render here: what it would replace is unknown
  await expect(d.getByText("Ticket này chưa có UI flow")).toHaveCount(0);
  await ctl("/set", { flow: "file" });
  await d.getByRole("button", { name: "Thử lại" }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
});

test("a broken file says so and offers to render again", async ({ page }) => {
  await ctl("/set", { flow: "broken" });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.getByText("File UI flow trên ticket không đọc được")).toBeVisible();
  await d.getByRole("button", { name: "Render lại bằng AI" }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await expect(d.getByText(BAR)).toBeVisible();
});
