import { expect, type Page, test } from "@playwright/test";

const CONTROL = "http://127.0.0.1:8799";
const A = "-1001";
const B = "-1002";

async function ctl(path: string, body?: object) {
  const res = await fetch(`${CONTROL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function open(page: Page, chat = A) {
  await page.goto("/");
  await page.getByRole("button", { name: chat === A ? "Nhóm Dự án" : "Nhóm Bạn bè" }).click();
  await expect(page.getByTestId("message").first()).toBeVisible();
  await expect(page.getByTestId("stream-state")).toHaveText("Cập nhật trực tiếp");
}

const msgById = (page: Page, id: number) => page.locator(`[data-testid=message][data-id="${id}"]`);
let nextId = 500;

test.beforeEach(async () => {
  await ctl("/set", { send: "ok", slow_chat: null, slow_ms: 0, fail_changes: 0 });
});

test("telegram text renders as text only (no XSS)", async ({ page }) => {
  await open(page);
  await expect(msgById(page, 120)).toContainText("<img src=x onerror=");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null)).toBeNull();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test("SSE applies new, edited and deleted messages", async ({ page }) => {
  await open(page);
  const id = nextId++;
  await ctl("/message", { chat: A, id, text: "live new" });
  await expect(msgById(page, id)).toContainText("live new");
  await ctl("/message", { chat: A, id, text: "live edited", edit: 1_900_000_000 });
  await expect(msgById(page, id)).toContainText("live edited");
  // edits/deletes also apply to messages older than the newest one
  await ctl("/message", { chat: A, id: 117, text: "old edited", edit: 1_900_000_000 });
  await expect(msgById(page, 117)).toContainText("old edited");
  await ctl("/delete", { chat: A, id });
  await expect(msgById(page, id)).toContainText("đã bị xóa");
});

test("failed drain after a notification does not lose changes", async ({ page }) => {
  await open(page);
  const [first, second] = [nextId++, nextId++];
  await ctl("/set", { fail_changes: 1 });
  await ctl("/message", { chat: A, id: first, text: "first after failure" });
  await page.waitForTimeout(500);
  await ctl("/message", { chat: A, id: second, text: "second" });
  await expect(msgById(page, first)).toBeVisible();
  await expect(msgById(page, second)).toBeVisible();
});

test("switching chats never shows a slow stale response", async ({ page }) => {
  await open(page, B);
  await ctl("/set", { slow_chat: A, slow_ms: 1500 });
  await page.getByRole("button", { name: "Nhóm Dự án" }).click();
  await page.getByRole("button", { name: "Nhóm Bạn bè" }).click();
  await expect(page.getByText("Tin B số 5")).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByText("Tin A số 116")).toHaveCount(0);
  await expect(page.getByText("Tin B số 5")).toBeVisible();
});

test("local data loads while the browser reports offline", async ({ page }) => {
  await open(page, B);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByRole("button", { name: "Nhóm Dự án" }).click();
  await expect(page.getByText("Tin A số 116")).toBeVisible();
});

async function startReply(page: Page, id: number, text: string) {
  await msgById(page, id).getByRole("button", { name: "Trả lời" }).click();
  await page.getByLabel("Nội dung trả lời").fill(text);
}

test("double click sends once; Enter adds a newline", async ({ page }) => {
  await open(page);
  const before = (await ctl("/state")).send_calls;
  await ctl("/set", { send: "slow" });
  await startReply(page, 116, "line 1");
  await page.getByLabel("Nội dung trả lời").press("Enter");
  await page.getByLabel("Nội dung trả lời").pressSequentially("line 2");
  await expect(page.getByLabel("Nội dung trả lời")).toHaveValue("line 1\nline 2");
  const send = page.getByRole("button", { name: "Gửi", exact: true });
  await send.click();
  await send.click({ force: true }).catch(() => undefined);
  await page.getByLabel("Nội dung trả lời").press("ControlOrMeta+Enter");
  await expect(page.getByText("Đã gửi.")).toBeVisible();
  expect((await ctl("/state")).send_calls - before).toBe(1);
});

test("errors keep the draft and going online does not auto-send", async ({ page }) => {
  await open(page);
  await ctl("/set", { send: "flood" });
  await startReply(page, 115, "keep me");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByText("Telegram yêu cầu chờ")).toBeVisible();
  await expect(page.getByLabel("Nội dung trả lời")).toHaveValue("keep me");

  await ctl("/set", { send: "unknown" });
  await page.waitForTimeout(500);
  const calls = (await ctl("/state")).send_calls;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1000);
  expect((await ctl("/state")).send_calls).toBe(calls); // nothing resent on reconnect
});

test("unknown result offers retry with the same request", async ({ page }) => {
  await open(page);
  await ctl("/set", { send: "unknown" });
  await startReply(page, 114, "maybe sent");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByText("Chưa rõ Telegram đã nhận tin")).toBeVisible();
  await expect(page.getByLabel("Nội dung trả lời")).toHaveAttribute("readonly", "");
  await ctl("/set", { send: "ok" });
  await page.getByRole("button", { name: "Thử lại cùng yêu cầu" }).click();
  await expect(page.getByText("Đã gửi.")).toBeVisible();
});

test("AI draft goes to the composer and is never sent automatically", async ({ page }) => {
  await open(page);
  const calls = (await ctl("/state")).send_calls;
  await page.getByRole("button", { name: "AI" }).click();
  await page.getByLabel("Chọn tin #118 cho AI").click();
  await page.getByLabel("Chọn tin #119 cho AI").click();
  await page.getByRole("button", { name: "Soạn nháp" }).click();
  await expect(page.getByText("Bản nháp AI: cảm ơn mọi người!")).toBeVisible();
  await page.getByRole("button", { name: "Đưa vào khung soạn" }).click();
  await expect(page.getByLabel("Nội dung trả lời")).toHaveValue("Bản nháp AI: cảm ơn mọi người!");
  await page.waitForTimeout(500);
  expect((await ctl("/state")).send_calls).toBe(calls);
});

test("dialog focus, reduced motion and scroll position", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  // focus returns to the trigger after closing the confirm dialog
  const trigger = page.getByRole("button", { name: "Xóa dữ liệu" }).first();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // loading older messages keeps the visible message in place
  const timeline = page.getByTestId("timeline");
  await timeline.evaluate((el) => (el.scrollTop = 0));
  const firstId = Number(await page.getByTestId("message").first().getAttribute("data-id"));
  const anchor = msgById(page, firstId);
  const y0 = (await anchor.boundingBox())!.y;
  await page.getByRole("button", { name: "Tải tin cũ hơn" }).click();
  await expect(msgById(page, firstId - 1)).toBeAttached();
  expect(Math.abs((await anchor.boundingBox())!.y - y0)).toBeLessThan(5);

  // not at the bottom => a new message does not yank the scroll position
  const top = await timeline.evaluate((el) => el.scrollTop);
  await ctl("/message", { chat: A, id: nextId++, text: "no jump" });
  await page.waitForTimeout(800);
  expect(Math.abs((await timeline.evaluate((el) => el.scrollTop)) - top)).toBeLessThan(5);
});
