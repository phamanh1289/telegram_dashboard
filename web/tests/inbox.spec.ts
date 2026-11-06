import { expect, type Page, test } from "@playwright/test";

// Fixture (fixture_server.py): tags A 111-120 ("Nhóm Dự án", 120 is the XSS one) and B 1-5 ("Nhóm Bạn bè"), oldest
// first; A 1-110 are live history only. Tests share one backend, so each one acts on its own tags.
const CONTROL = `http://127.0.0.1:${process.env.E2E_CONTROL ?? "8799"}`;
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

async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("message").first()).toBeVisible();
  await expect(page.getByTestId("tg-sub")).toHaveText("Cập nhật trực tiếp");
}

const row = (page: Page, id: number) => page.locator(`[data-testid=message][data-id="${id}"]`);
const inChat = (page: Page, chat: string) => page.locator(`[data-testid=message][data-key^="${chat}:"]`);
const reply = (page: Page) => page.getByLabel("Nội dung trả lời");

// A click on the row opens the reply panel (cards have no "Trả lời" button).
async function startReply(page: Page, id: number, text: string) {
  await row(page, id).locator("p").first().click();
  await reply(page).fill(text);
}

test.beforeEach(async () => {
  await ctl("/set", { send: "ok", slow_chat: null, slow_ms: 0, fail_changes: 0 });
});

test("telegram text renders as text only (no XSS)", async ({ page }) => {
  await open(page);
  await expect(row(page, 120)).toContainText("<img src=x onerror=");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null)).toBeNull();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test("SSE applies new, edited and deleted tags", async ({ page }) => {
  await open(page);
  await ctl("/message", { chat: A, id: 500, text: "live new" });
  await expect(row(page, 500)).toContainText("live new");
  await ctl("/message", { chat: A, id: 500, text: "live edited", edit: 1_900_000_000 });
  await expect(row(page, 500)).toContainText("live edited");
  await ctl("/delete", { chat: A, id: 500 });
  await expect(row(page, 500)).toHaveCount(0);
});

test("one Xong per card, no reply button on cards", async ({ page }) => {
  await open(page);
  await expect(row(page, 119).getByRole("button", { name: "Xong", exact: true })).toHaveCount(1);
  await expect(row(page, 119).getByRole("button", { name: "Trả lời" })).toHaveCount(0);
});

test("double click sends once; Enter adds a newline", async ({ page }) => {
  await open(page);
  const before = (await ctl("/state")).send_calls;
  await ctl("/set", { send: "slow" });
  await startReply(page, 116, "line 1");
  await reply(page).press("Enter");
  await reply(page).pressSequentially("line 2");
  await expect(reply(page)).toHaveValue("line 1\nline 2");
  const send = page.getByRole("button", { name: "Gửi", exact: true });
  await send.click();
  await send.click({ force: true });
  await expect(reply(page)).toBeVisible(); // still in flight (the fixture holds it 1.5 s): the shortcut must not resend
  await reply(page).press("ControlOrMeta+Enter");
  await expect(page.getByText("Đã gửi trả lời")).toBeVisible();
  expect((await ctl("/state")).send_calls - before).toBe(1);
});

test("errors keep the draft and going online does not auto-send", async ({ page }) => {
  await open(page);
  await ctl("/set", { send: "flood" });
  await startReply(page, 115, "keep me");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByText("Telegram yêu cầu chờ")).toBeVisible();
  await expect(reply(page)).toHaveValue("keep me");

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
  await expect(reply(page)).toHaveAttribute("readonly", "");
  await ctl("/set", { send: "ok" });
  await page.getByRole("button", { name: "Thử lại cùng yêu cầu" }).click();
  await expect(page.getByText("Đã gửi trả lời")).toBeVisible();
});

test("a reply draft survives Esc and a reload", async ({ page }) => {
  await open(page);
  await startReply(page, 113, "nháp dở dang");
  await page.keyboard.press("Escape"); // within the save debounce: closing the panel saves it
  await expect(reply(page)).toHaveCount(0);
  await expect(row(page, 113)).toContainText("Nháp");
  await page.reload();
  await row(page, 113).locator("p").first().click();
  await expect(reply(page)).toHaveValue("nháp dở dang");
});

test("⌘K jumps to a group", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog", { name: "Lệnh nhanh" }).getByRole("combobox").fill("ban be");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Nhóm Bạn bè" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("select several tags and mark them done together", async ({ page }) => {
  await open(page);
  const bar = page.getByRole("toolbar", { name: "Tin đã chọn" });
  await page.keyboard.press("j"); // the oldest tag: A 111
  await page.keyboard.press(" ");
  await expect(bar).toContainText("1 đã chọn");
  await row(page, 1).locator("p").first().click({ modifiers: ["Shift"] });
  await expect(bar).toContainText("2 đã chọn");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await row(page, 111).locator("p").first().click({ modifiers: ["Shift"] });
  await row(page, 1).locator("p").first().click({ modifiers: ["Shift"] });
  await bar.getByRole("button", { name: "Xong", exact: true }).click();
  await expect(row(page, 111)).toHaveCount(0);
  await expect(row(page, 1)).toHaveCount(0);
});

test("group data is deleted from the group's menu, focus comes back", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.getByRole("button", { name: "Nhóm Bạn bè" }).click();
  const trigger = page.getByRole("button", { name: "Thao tác với nhóm" });
  await trigger.click();
  await page.getByRole("menuitem", { name: /Xóa dữ liệu nhóm/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a failed change drain retries and loses nothing", async ({ page }) => {
  await open(page);
  // Alone: only the backoff retry can bring it in.
  await ctl("/set", { fail_changes: 1 });
  await ctl("/message", { chat: A, id: 504, text: "retried alone" });
  await expect(row(page, 504)).toBeVisible();
  // A second change during the backoff: the cursor stayed put, so the retry brings both.
  await ctl("/set", { fail_changes: 1 });
  await ctl("/message", { chat: A, id: 501, text: "first after failure" });
  await expect.poll(async () => (await ctl("/state")).fail_changes).toBe(0); // that drain got the 500
  await ctl("/message", { chat: A, id: 502, text: "second, during the backoff" });
  await expect(row(page, 501)).toBeVisible();
  await expect(row(page, 502)).toBeVisible();
  await expect(page.getByTestId("tg-sub")).toHaveText("Cập nhật trực tiếp");
});

test("switching groups never shows a slow stale response", async ({ page }) => {
  await open(page);
  await ctl("/set", { slow_chat: A, slow_ms: 1500 });
  const slow = page.waitForRequest((r) => r.url().includes(`/api/chats/${A}/messages?`));
  await page.getByRole("button", { name: "Nhóm Dự án" }).click();
  const req = await slow; // A's page is on its way, held by the fixture
  await page.getByRole("button", { name: "Nhóm Bạn bè" }).click();
  await expect(inChat(page, B).first()).toBeVisible();
  await req.response(); // A's page has landed (or was cancelled)
  await expect(inChat(page, A)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Nhóm Bạn bè" })).toBeVisible();
});

test("local data loads while the browser reports offline", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByRole("button", { name: "Nhóm Bạn bè" }).click();
  await expect(inChat(page, B).first()).toBeVisible();
});

test("loading older messages keeps the visible one in place", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Nhóm Dự án" }).click();
  await page.getByRole("button", { name: "Cả nhóm" }).click();
  const timeline = page.getByTestId("timeline");
  const older = page.getByRole("button", { name: "Tải tin cũ hơn" });
  await expect(older).toBeVisible();
  await timeline.evaluate((el) => (el.scrollTop = 0));
  const firstId = Number(await timeline.getByTestId("message").first().getAttribute("data-id"));
  // Its bottom edge: the row itself may lose its sender line once the same sender's older message lands above it.
  const bottom = async () => {
    const b = (await row(page, firstId).boundingBox())!;
    return b.y + b.height;
  };
  const y0 = await bottom();
  await older.click();
  await expect(row(page, firstId - 1)).toBeAttached();
  expect(Math.abs((await bottom()) - y0)).toBeLessThan(2);
});

test("a new tag does not yank the scroll when not at the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 }); // short, so the group's tags overflow
  await open(page);
  await page.getByRole("button", { name: "Nhóm Dự án" }).click();
  const timeline = page.getByTestId("timeline");
  await expect(inChat(page, A).first()).toBeVisible();
  await expect.poll(() => timeline.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40);
  await timeline.evaluate((el) => (el.scrollTop = 0));
  await ctl("/message", { chat: A, id: 503, text: "no jump" });
  await expect(row(page, 503)).toBeAttached();
  expect(await timeline.evaluate((el) => el.scrollTop)).toBeLessThan(5);
});

test("an AI draft fills the reply box and is never sent on its own", async ({ page }) => {
  await open(page);
  const calls = (await ctl("/state")).send_calls;
  await row(page, 112).locator("p").first().click();
  const ask = page.getByRole("button", { name: "Tóm tắt & gợi ý" });
  await ask.click();
  await expect(reply(page)).toHaveValue("Bản nháp AI: cảm ơn mọi người!");
  await expect(ask).toBeEnabled(); // the AI run has settled
  await expect(page.getByRole("button", { name: "Gửi", exact: true })).toBeEnabled(); // waiting for the user
  expect((await ctl("/state")).send_calls).toBe(calls);
});
