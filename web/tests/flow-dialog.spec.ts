import { expect, type Page, test } from "@playwright/test";
import fs from "node:fs";

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
const aiCalls = async () => (await ctl("/state")).ai_calls as number;

// an edit: "Có thay đổi chưa lưu — …"; a fresh render: "AI vừa vẽ 4 màn, … — chưa lưu, …"
const BAR = /cập nhật file trên ticket\?$/;
const dialog = (page: Page) => page.getByRole("dialog", { name: "UI flow VA-1" });

/** Every AI render now asks first: the pre-render dialog's confirm (it counts tokens when it opens). */
async function confirmRender(page: Page) {
  await page.getByRole("alertdialog").getByRole("button", { name: /^Render (bằng AI|kèm phần đã làm rõ)$/ }).click();
}

async function openFlow(page: Page) {
  await page.addInitScript(() => { localStorage.setItem("ytMode", "dev"); localStorage.setItem("uiflowMode", "flow"); }); // role asked once; AI mode (default: screens)
  await page.goto("/youtrack?ticket=VA-1");
  await page.getByRole("button", { name: "UI flow", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

/** An edit by hand that needs no Zeplin read: select the last screen and delete it (4 screens become 3). */
async function dropScreen(page: Page) {
  await dialog(page).locator('.uf-screen[data-id="home"] .uf-title').click();
  await page.keyboard.press("Delete");
}

/** No file yet: run the AI from the start panel, wait for its flow on the map. */
async function render(page: Page) {
  const d = dialog(page);
  await d.getByRole("button", { name: "Render bằng AI", exact: true }).click();
  await confirmRender(page);
  await expect(d.locator(".uf-screen")).toHaveCount(4);
}

test.beforeEach(async () => {
  await ctl("/set", { yt: true, reset_jobs: true, flow: "file", flow_save: "ok", flow_posts: [], ai_ms: 0, ai_calls: 0, save_ms: 0, ticket_newer: false, ai_keep: null, flow_check: null, owner: null });
});
test.afterAll(async () => { await ctl("/set", { yt: false }); }); // the other specs keep the real YouTrack routes

test("ticket detail opens the saved UI flow, from the button and from its file row", async ({ page }) => {
  await openFlow(page);
  const d = dialog(page);
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await expect(d.getByText(BAR)).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Render bằng AI", exact: true })).toHaveCount(0); // a saved flow: no start panel
  await d.locator(".uf-screen").first().click();
  await page.keyboard.press("Escape"); // the engine's: drops the selection, never closes the dialog
  await expect(dialog(page)).toBeVisible();
  await d.getByRole("button", { name: "Đóng" }).click(); // only ✕ closes it; the ticket stays open
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Đăng nhập bằng OTP" })).toBeVisible();
  await page.getByRole("button", { name: /uiflow-VA-1\.html/ }).click();
  await expect(dialog(page).locator(".uf-screen")).toHaveCount(4);
});

test("no file yet: start panel with the run button, AI result is unsaved until Cập nhật, which posts it", async ({ page }) => {
  await ctl("/set", { flow: "none", ai_ms: 600 });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.getByText("Ticket này chưa có UI flow")).toBeVisible();
  await expect(d.getByRole("radio", { name: /Màn \+ liên kết/ })).toHaveAttribute("aria-checked", "true");
  await d.getByRole("button", { name: "Render bằng AI", exact: true }).click();
  await confirmRender(page);
  await expect(d.getByRole("button", { name: "Dừng render" })).toBeVisible(); // running: one stop button in the footer
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await expect(d.getByText(BAR)).toBeVisible();
  expect(await posts()).toEqual([]);
  await d.getByRole("button", { name: "Lưu lên ticket", exact: true }).click();
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
  await d.getByRole("button", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
  await confirmRender(page);
  await expect(d.getByText(BAR)).toBeVisible();
  await d.getByRole("button", { name: "Không", exact: true }).click();
  await expect(d.getByText(BAR)).toHaveCount(0);
  expect(await posts()).toEqual([]);
  // with no further edit the change can still be saved: the hint line brings the bar back
  await d.getByRole("button", { name: "Cập nhật lên ticket" }).click();
  await expect(d.getByText(BAR)).toBeVisible();
  await d.getByRole("button", { name: "Không", exact: true }).click();
  // Closing keeps the draft; reopening restores it without uploading.
  await d.getByRole("button", { name: "Đóng" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "UI flow", exact: true }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  // the same change, saved over the opened file
  await d.getByRole("button", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
  await confirmRender(page);
  await expect(d.getByText(BAR)).toBeVisible();
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByText(BAR)).toHaveCount(0);
  const [p] = await posts();
  expect(p).toMatchObject({ id: "VA-1", base: "1-1" });
  // the comment the server posts names the file in plain text: its row must stay in Tệp đính kèm, not be hidden
  await expect(d.getByText("Đã cập nhật file trên ticket")).toBeVisible();
  await d.getByRole("button", { name: "Đóng" }).click();
  await expect(page.getByText("UI flow cập nhật (rev 1)")).toBeVisible(); // the AI flow is rev 0, saved as rev 1
  await expect(page.getByRole("button", { name: /uiflow-VA-1\.html/ })).toBeVisible();
});

test("Render lại with unsaved changes warns first; Hủy changes nothing", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await openFlow(page);
  const d = dialog(page);
  await render(page); // the AI flow on screen is unsaved
  expect(await aiCalls()).toBe(1);
  await d.getByRole("button", { name: "Render lại bằng AI" }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("sửa khác chưa lưu sẽ mất");
  await ask.getByRole("button", { name: "Hủy" }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await expect(d.getByText(BAR)).toBeVisible(); // my unsaved flow is still there
  expect(await aiCalls()).toBe(1); // nothing ran
  expect(await posts()).toEqual([]);
});

test("a render hides the bar while it runs; Dừng leaves the flow and posts nothing", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await openFlow(page);
  const d = dialog(page);
  await render(page);
  await expect(d.getByText(BAR)).toBeVisible();
  await ctl("/set", { ai_ms: 5000 }); // long enough to catch it running
  await d.getByRole("button", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
  await confirmRender(page);
  // while it runs nothing can be saved: the engine (and the edits it held) is gone with the old flow
  await expect(d.getByRole("button", { name: "Cập nhật", exact: true })).toHaveCount(0);
  await expect(d.getByText(BAR)).toHaveCount(0);
  await d.getByRole("button", { name: "Dừng" }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await page.waitForTimeout(500);
  expect(await posts()).toEqual([]);
});

test("409 shows the conflict message and keeps my edit until Xem bản mới", async ({ page }) => {
  await ctl("/set", { flow: "none", flow_save: "409" });
  await openFlow(page);
  const d = dialog(page);
  await render(page);
  await d.getByRole("button", { name: "Lưu lên ticket", exact: true }).click();
  await expect(d.getByText("UI flow vừa được người khác cập nhật")).toBeVisible();
  await expect(d.getByText(BAR)).toBeVisible(); // my change is still there to save
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await ctl("/set", { flow: "file" });
  // it throws my change away: asked first, and Hủy keeps it
  await d.getByRole("button", { name: "Xem bản mới" }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Xem bản mới trên ticket sẽ mất các thay đổi chưa lưu của bạn.");
  await ask.getByRole("button", { name: "Hủy" }).click();
  await expect(d.getByText(BAR)).toBeVisible();
  await d.getByRole("button", { name: "Xem bản mới" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Xem bản mới" }).click();
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
  await d.getByRole("button", { name: "Lưu lên ticket", exact: true }).click();
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
  await expect(d.getByRole("button", { name: "Render bằng AI", exact: true })).toHaveCount(0); // no render here: what it would replace is unknown
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
  await confirmRender(page); // every AI render asks first
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await expect(d.getByText(BAR)).toBeVisible();
});

test("an edit made while the save is in flight survives it, unsaved, with the bar back", async ({ page }) => {
  await ctl("/set", { flow: "none", save_ms: 1500 });
  await openFlow(page);
  const d = dialog(page);
  await render(page);
  await d.getByRole("button", { name: "Lưu lên ticket", exact: true }).click();
  await d.getByRole("button", { name: "Sửa" }).click(); // the canvas stays editable during the upload
  await dropScreen(page);
  await expect(d.locator(".uf-screen")).toHaveCount(3);
  await expect(d.getByText("Đã cập nhật file trên ticket")).toBeVisible();
  await expect(d.locator(".uf-screen")).toHaveCount(3); // not replaced by the saved version
  await expect(d.getByText(BAR)).toBeVisible();
  const [first] = await posts();
  expect(first.flow.screens).toHaveLength(4);
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByText(BAR)).toHaveCount(0);
  const [, second] = await posts();
  expect(second).toMatchObject({ base: "1-2" }); // over the file just saved
  expect(second.flow.screens).toHaveLength(3);
});

// Recovery uses account-scoped server metadata and IndexedDB, never an unscoped browser job pointer.
const flowButton = (page: Page) => page.getByRole("button", { name: "UI flow", exact: true });

test("closing mid-render keeps it going and reopening restores the unsaved result", async ({ page }) => {
  await ctl("/set", { flow: "none", ai_ms: 1500 });
  await openFlow(page);
  await dialog(page).getByRole("button", { name: "Render bằng AI" }).click();
  await confirmRender(page);
  await expect(dialog(page).getByRole("button", { name: "Dừng" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Đóng" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await flowButton(page).click();
  await expect(dialog(page).locator(".uf-screen")).toHaveCount(4);
  await expect(dialog(page).getByText(BAR)).toBeVisible();
  expect(await aiCalls()).toBe(1);
  expect(await posts()).toEqual([]);
});

test("reload restores the draft without another AI call or upload", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await openFlow(page);
  await render(page);
  await expect(dialog(page).getByText("Đã lưu bản nháp", { exact: false })).toBeVisible();
  page.once("dialog", (guard) => guard.accept());
  await page.reload();
  // The ticket sheet URL is consumed by the page; reopen that ticket after a real reload.
  await page.goto("/youtrack?ticket=VA-1");
  await flowButton(page).click();
  await expect(dialog(page).locator(".uf-screen")).toHaveCount(4);
  await expect(dialog(page).getByText("Đã khôi phục bản nháp", { exact: false })).toBeVisible();
  expect(await aiCalls()).toBe(1);
  expect(await posts()).toEqual([]);
});

test("a draft lives for its day: the next day it is gone, with the unsaved render the server kept", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await openFlow(page);
  await render(page);
  await expect(dialog(page).getByText("Đã lưu bản nháp", { exact: false })).toBeVisible();
  page.once("dialog", (guard) => guard.accept());
  await page.reload();
  await page.clock.setSystemTime(Date.now() + 86_400_000); // the next day (only the date: timers run as they do)
  await page.goto("/youtrack?ticket=VA-1");
  await flowButton(page).click();
  const d = dialog(page);
  await expect(d.getByRole("button", { name: "Render bằng AI", exact: true })).toBeVisible(); // nothing left: the start panel
  await expect(d.getByText("Đã khôi phục bản nháp", { exact: false })).toHaveCount(0);
  await expect(d.locator(".uf-screen")).toHaveCount(0);
  expect(await page.evaluate(() => new Promise((ok) => { // and the draft is out of the browser too
    const r = indexedDB.open("uiflow-drafts", 1);
    r.onsuccess = () => { const q = r.result.transaction("drafts").objectStore("drafts").count(); q.onsuccess = () => { ok(q.result); r.result.close(); }; };
  }))).toBe(0);
  expect(await aiCalls()).toBe(1);
});

test("someone else's file: edited freely as a draft, but only its author updates or removes it", async ({ page }) => {
  await ctl("/set", { owner: { id: "1-2", login: "an", name: "An" } });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.getByText("Của An")).toBeVisible(); // said on opening, before any work
  await expect(d.getByRole("button", { name: "Xoá UI flow" })).toBeDisabled();
  await d.getByRole("button", { name: "Sửa" }).click();
  await dropScreen(page);
  await expect(d.locator(".uf-screen")).toHaveCount(3); // the edit itself is allowed
  await expect(d.getByText("Bản sửa của bạn được giữ làm nháp trên máy; chỉ An cập nhật được file trên ticket.")).toBeVisible();
  await expect(d.getByRole("button", { name: "Cập nhật", exact: true })).toBeDisabled();
  expect(await posts()).toEqual([]);
});

test("Dừng: a download stops at any point, quietly; a save cannot be stopped once its upload has started", async ({ page }) => {
  await openFlow(page);
  const d = dialog(page);
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  let downloads = 0;
  page.on("download", () => { downloads++; });
  await page.route("**/api/yt/flow/html", async (r) => { await new Promise((ok) => setTimeout(ok, 3000)); await r.continue().catch(() => {}); });
  await d.getByRole("button", { name: "Tải xuống" }).click();
  await page.getByRole("menuitem", { name: "File HTML (xem offline)" }).click();
  const pack = page.getByRole("status", { name: "Tải file HTML" });
  await pack.getByRole("button", { name: "Dừng" }).click();
  await expect(pack).toHaveCount(0);
  await expect(d.getByText("Không tải được file HTML", { exact: false })).toHaveCount(0); // stopped, not failed
  await page.waitForTimeout(3500);
  expect(downloads).toBe(0);

  await ctl("/set", { save_ms: 1500 });
  await d.getByRole("button", { name: "Sửa" }).click();
  await dropScreen(page);
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  const busy = page.getByRole("status", { name: "Cập nhật" });
  await expect(busy.getByRole("button", { name: "Dừng" })).toBeDisabled(); // the upload is under way
  await expect(busy.getByText("dừng giữa chừng sẽ không rõ đã lưu hay chưa", { exact: false })).toBeVisible();
  await expect(d.getByText("Đã cập nhật file trên ticket", { exact: false })).toBeVisible();
});

test("save locks render replacement until upload completes", async ({ page }) => {
  await ctl("/set", { flow: "none", save_ms: 1500 });
  await openFlow(page); await render(page);
  await dialog(page).getByRole("button", { name: "Lưu lên ticket", exact: true }).click();
  await expect(dialog(page).getByRole("button", { name: "Render lại bằng AI" })).toBeDisabled();
  const busy = page.getByRole("status", { name: "Lưu lên ticket" }); // the save's card, with its scene, until it is done
  await expect(busy).toBeVisible();
  await expect(busy).toContainText(/Đang (nhúng ảnh|tải file)/);
  await expect(busy).toHaveCount(0);
  await expect(dialog(page).getByText("Đã cập nhật file trên ticket", { exact: false })).toBeVisible();
  expect(await aiCalls()).toBe(1);
});

test("cancel network failure keeps the job recoverable", async ({ page }) => {
  await ctl("/set", { flow: "none", ai_ms: 8000 });
  await openFlow(page);
  await dialog(page).getByRole("button", { name: "Render bằng AI" }).click();
  await confirmRender(page);
  await expect(dialog(page).getByRole("button", { name: "Dừng" })).toBeVisible();
  await page.route("**/api/yt/flow/jobs/*", async (route) => {
    if (route.request().method() === "DELETE") await route.abort(); else await route.continue();
  });
  await dialog(page).getByRole("button", { name: "Dừng" }).click();
  await expect(dialog(page).getByText(/Chưa xác nhận dừng render:/)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Dừng" })).toBeVisible();
  expect(await aiCalls()).toBe(1);
});

test("draft read failure blocks replacement and offers retry", async ({ page }) => {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    let fail = true;
    indexedDB.open = (...args: Parameters<IDBFactory["open"]>) => {
      if (fail) { fail = false; throw new DOMException("storage unavailable", "QuotaExceededError"); }
      return original(...args);
    };
  });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.getByText(/Không khôi phục được bản nháp:/)).toBeVisible();
  await d.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  expect(await aiCalls()).toBe(0);
});

test("job metadata failure still restores an existing draft", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await openFlow(page); await render(page);
  await expect(dialog(page).getByText("Đã lưu bản nháp", { exact: false })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Đóng" }).click();
  await page.route("**/api/yt/flow/jobs?issue=*", (route) => route.fulfill({ status: 503, json: { error: "jobs unavailable" } }));
  await flowButton(page).click();
  await expect(dialog(page).locator(".uf-screen")).toHaveCount(4);
  await expect(dialog(page).getByText("Đã khôi phục bản nháp", { exact: false })).toBeVisible();
  await expect(dialog(page).getByText(/jobs unavailable/)).toBeVisible();
});

test("scope lookup failure never displays a cached flow", async ({ page }) => {
  await page.route("**/api/yt/flow/scope", (route) => route.fulfill({ status: 503, json: { error: "scope unavailable" } }));
  await openFlow(page);
  await expect(dialog(page).getByRole("alert")).toContainText("scope unavailable");
  await expect(dialog(page).locator(".uf-screen")).toHaveCount(0);
});

test("interrupted AI waits for explicit Continue and preserves its request", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await page.route("**/api/yt/flow/jobs?issue=*", (route) => route.fulfill({ json: [{
    id: "interrupted-1234", issue: "VA-1", status: "interrupted", stage: "ai", base: null, result: null,
    error: null, cursor: 1, processed: false, needs_ai_retry: true, request: { note: "giữ luồng lỗi", mode: "flow", split: false },
  }] }));
  await openFlow(page);
  await expect(dialog(page).getByRole("button", { name: "Tiếp tục render" })).toBeVisible(); // one warn button, under the run button
  expect(await aiCalls()).toBe(0);
  const request = page.waitForRequest((request) => request.url().endsWith("/api/yt/ai/flow") && request.method() === "POST");
  await dialog(page).getByRole("button", { name: "Tiếp tục render" }).click();
  expect((await request).postDataJSON()).toMatchObject({ note: "giữ luồng lỗi", mode: "flow", split: false, base: null });
  await expect(dialog(page).locator(".uf-screen")).toHaveCount(4);
  expect(await aiCalls()).toBe(1);
});

test("rerender over an edited draft recovers the replacement job after close", async ({ page }) => {
  await ctl("/set", { ai_ms: 1800 });
  await openFlow(page);
  let d = dialog(page);
  await d.getByRole("button", { name: "Sửa", exact: true }).click();
  await dropScreen(page);
  await expect(d.locator(".uf-screen")).toHaveCount(3);
  await d.getByRole("button", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
  await confirmRender(page);
  await expect(d.getByRole("button", { name: "Dừng" })).toBeVisible();
  await d.getByRole("button", { name: "Đóng" }).click();
  await expect(d).toHaveCount(0);
  await flowButton(page).click();
  d = dialog(page);
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await expect(d.getByText(BAR)).toBeVisible();
  expect(await aiCalls()).toBe(1);
  expect(await posts()).toEqual([]);
});

test("stop during the pre-start scope check prevents the AI request", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await openFlow(page);
  await expect(dialog(page).getByRole("button", { name: "Render bằng AI" })).toBeVisible();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/yt/flow/scope", async (route) => {
    await delayed;
    await route.fulfill({ json: { scope: "fixture-account-server" } });
  });
  const scopeRequest = page.waitForRequest("**/api/yt/flow/scope");
  await dialog(page).getByRole("button", { name: "Render bằng AI" }).click();
  await confirmRender(page);
  await scopeRequest;
  await dialog(page).getByRole("button", { name: "Dừng render" }).click();
  await expect(dialog(page).getByRole("button", { name: "Dừng render" })).toHaveCount(0);
  const scopeResponse = page.waitForResponse("**/api/yt/flow/scope");
  release();
  await scopeResponse;
  await page.waitForTimeout(100); // Let the suspended mutation continue after its scope response.
  await expect(dialog(page).getByRole("button", { name: "Render bằng AI" })).toBeVisible();
  expect(await aiCalls()).toBe(0);
  expect(await posts()).toEqual([]);
});

test("focus and reconnect preserve the in-flight save lock", async ({ page }) => {
  await ctl("/set", { flow: "none", save_ms: 1800 });
  await openFlow(page); await render(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Lưu lên ticket", exact: true }).click();
  await expect(d.getByRole("button", { name: /^(Lưu lên ticket|Cập nhật)$/ })).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(d.getByRole("button", { name: "Render lại bằng AI" })).toBeDisabled();
  await expect(d.getByRole("button", { name: /^(Lưu lên ticket|Cập nhật)$/ })).toBeDisabled();
  await expect(d.getByText("Đã cập nhật file trên ticket", { exact: false })).toBeVisible();
  expect(await posts()).toHaveLength(1);
  expect(await aiCalls()).toBe(1);
});

test("focus does not replace an edited saved flow with a newer attachment", async ({ page }) => {
  await openFlow(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Sửa", exact: true }).click();
  await dropScreen(page);
  await expect(d.locator(".uf-screen")).toHaveCount(3);
  await expect(d.getByText(BAR)).toBeVisible(); // over a saved file the draft line is not shown: only "Cập nhật"
  await expect(d.getByRole("button", { name: "Bỏ bản nháp" })).toHaveCount(0);
  await page.waitForTimeout(800); // the 500 ms draft autosave
  let reads = 0;
  await page.route("**/api/yt/flow?issue=*", async (route) => {
    reads++;
    const response = await route.fetch();
    const latest = await response.json();
    await route.fulfill({ json: { ...latest, att: "newer-attachment", flow: { ...latest.flow, rev: latest.flow.rev + 1 } } });
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(150); // Allow automatic query refetches to run if reintroduced.
  await expect(d.locator(".uf-screen")).toHaveCount(3);
  await expect(d.getByText(BAR)).toBeVisible();
  expect(reads).toBe(0);
  expect(await posts()).toEqual([]);
  expect(await aiCalls()).toBe(0);
});

test("draft quota failure keeps the flow and retries without AI or upload", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    let fail = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === "drafts" && fail) {
        fail = false;
        throw new DOMException("Synthetic draft quota exceeded", "QuotaExceededError");
      }
      return original.apply(this, args);
    };
  });
  await openFlow(page); await render(page);
  const d = dialog(page);
  await expect(d.getByText(/Không lưu được bản nháp:/)).toBeVisible();
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await d.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(d.getByText("Đã lưu bản nháp", { exact: false })).toBeVisible();
  expect(await aiCalls()).toBe(1);
  expect(await posts()).toEqual([]);
});

test("+ Từ Zeplin in the dialog reads the screen through /flow/shots; a Zeplin error is shown, not 'not found'", async ({ page }) => {
  const pic = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"/>');
  let fail = true;
  await page.route("**/api/yt/flow/shots", async (r) => {
    const { urls } = r.request().postDataJSON() as { urls: string[] };
    if (fail && urls.includes("https://zpl.io/pay")) return r.fulfill({ status: 502, json: { error: "Token Zeplin bị từ chối" } });
    await r.fulfill({ json: { shots: Object.fromEntries(urls.map((u) => [u, { src: pic, w: 390, h: 844, hits: [], title: "Thanh toán" }])), missing: [] } });
  });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await d.getByRole("button", { name: "Sửa" }).click();
  await d.getByRole("button", { name: "+ Từ Zeplin" }).click();
  await d.getByLabel("Link màn Zeplin").fill("https://zpl.io/pay");
  await d.getByLabel("Link màn Zeplin").press("Enter");
  await expect(d.locator(".uf-zreport")).toContainText(/Không đọc được Zeplin: .*Token Zeplin bị từ chối/); // listed with its link
  fail = false;
  await d.getByRole("button", { name: "Thử lại" }).click();
  await expect(d.locator(".uf-screen", { hasText: "Thanh toán" })).toHaveCount(1);
  await expect(d.getByText(BAR)).toBeVisible(); // an unsaved edit: Cập nhật writes it, nothing was posted yet
  expect(await posts()).toEqual([]);
  expect(await aiCalls()).toBe(0);
});


test("reopened over an old Zeplin read: each screen updates the moment it is read; one read again unchanged is not redrawn", async ({ page }) => {
  const [A, B] = ["https://zpl.io/a", "https://zpl.io/b"];
  const exp = Math.floor(Date.now() / 1000) + 30 * 86_400; // Zeplin signs each read's image links anew, for 30 days
  const link = (n: string, read: number) => `https://img.zeplin.io/p/x/screens/${n}.png?key=h.${btoa(JSON.stringify({ iat: read, exp }))}.s`;
  const shot = (n: string, read: number, h = 844) => ({ src: link(n, read), w: 390, h, hits: [], ver: "v-" + n + h, cut: 0 });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"/>';
  await page.route("https://img.zeplin.io/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: svg }));
  await page.route("**/api/yt/flow?*", async (r) => { // the saved flow, its first two screens linked to Zeplin
    const res = await r.fetch(), j = await res.json();
    j.flow.screens[0].zeplin = A;
    j.flow.screens[1].zeplin = B;
    await r.fulfill({ response: res, json: j });
  });
  let release = () => {}, releaseA = () => {}, aRead = false;
  const held = new Promise<void>((ok) => { release = ok; }), heldA = new Promise<void>((ok) => { releaseA = ok; });
  await page.route("**/api/yt/flow/shots", async (r) => {
    const { urls, stale } = r.request().postDataJSON() as { urls: string[]; stale?: boolean };
    if (stale) return r.fulfill({ json: { shots: { [A]: shot("a", 1), [B]: shot("b", 1) }, missing: [], stale: true } }); // the old read, at once
    if (urls[0] === A) { // read again, unchanged: only its link signed anew (held until the old read is checked)
      await heldA;
      await r.fulfill({ json: { shots: { [A]: shot("a", 2) }, missing: [] } });
      aRead = true;
      return;
    }
    await held; // B: slow, and redesigned (longer)
    await r.fulfill({ json: { shots: { [B]: shot("b", 2, 1800) }, missing: [] } });
  });
  await openFlow(page);
  const d = dialog(page), img = (id: string) => d.locator(`.uf-screen[data-id="${id}"] .uf-img`);
  await expect(img("login")).toHaveAttribute("src", link("a", 1));
  await expect(img("code")).toHaveAttribute("src", link("b", 1));
  await img("login").evaluate((e) => { e.dataset.mark = "1"; });
  releaseA();
  await expect.poll(() => aRead).toBe(true);
  await page.waitForTimeout(300); // A is in, B still being read: nothing redrawn, the old image stays
  await expect(img("login")).toHaveAttribute("data-mark", "1");
  await expect(img("login")).toHaveAttribute("src", link("a", 1));
  release();
  await expect(img("code")).toHaveAttribute("src", link("b", 2)); // B's new design, the moment it is read
  await expect(img("login")).toHaveAttribute("data-mark", "1"); // and A still untouched
});

test("Markdown cho AI: its size told on opening, copy and download use that build; a changed choice counts again", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let builds = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/yt/flow/md")) builds++; });
  await openFlow(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Tải xuống" }).click();
  await page.getByRole("menuitem", { name: "Markdown cho AI…" }).click();
  const md = page.getByRole("dialog", { name: "Markdown cho AI" });
  await expect(md.getByRole("checkbox", { name: "Kèm dữ liệu sơ đồ (JSON)" })).not.toBeChecked(); // the tables say it
  await expect(md.getByText(/Khoảng [\d.,]+ token/)).toBeVisible(); // counted on opening, before any copy
  expect(builds).toBe(1);
  await md.getByRole("button", { name: "Sao chép" }).click();
  await expect(md.getByRole("button", { name: "Đã sao chép" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("# UI flow VA-1");
  expect(copied).not.toContain("## Dữ liệu sơ đồ");
  const file = page.waitForEvent("download");
  await md.getByRole("button", { name: "Tải file .md" }).click();
  await expect(md.getByRole("checkbox", { name: "Kèm dữ liệu sơ đồ (JSON)" })).toBeVisible(); // no wait scene: nothing asked
  expect((await file).suggestedFilename()).toBe("uiflow-VA-1.md");
  expect(builds).toBe(1); // the opening's build, copied and downloaded as is
  await md.getByRole("checkbox", { name: "Kèm dữ liệu sơ đồ (JSON)" }).click();
  await expect.poll(() => builds).toBe(2); // another choice: counted again, in place
  await expect(md.getByText(/Khoảng [\d.,]+ token/)).toBeVisible();
  await md.getByRole("button", { name: "Sao chép" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("## Dữ liệu sơ đồ");
  expect(builds).toBe(2);
});

test("a ticket edited after the file says how to pick it up; a render sends the flow on screen to keep its edits", async ({ page }) => {
  await ctl("/set", { ticket_newer: true });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.getByText(/Ticket đã sửa sau lần cập nhật UI flow/)).toBeVisible();
  await d.getByRole("button", { name: "Render lại bằng AI" }).click();
  await page.getByRole("button", { name: "Render lại", exact: true }).click();
  await confirmRender(page);
  await expect(d.getByText(BAR)).toBeVisible();
  const keep = (await ctl("/state")).ai_keep as { screens: { id: string }[] } | null;
  expect(keep?.screens.length).toBe(4);
});

test("Xoá UI flow asks first, Hủy keeps the dialog, Xóa removes only the file seen", async ({ page }) => {
  await ctl("/set", { att: "1-1", flow_deleted: null });
  await openFlow(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Xoá UI flow" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Hủy" }).click();
  await expect(d).toBeVisible(); // a press in the confirm never closes the flow under it
  expect((await ctl("/state")).flow_deleted ?? null).toBeNull();
  await d.getByRole("button", { name: "Xoá UI flow" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Xóa" }).click();
  await expect(d.getByText("Ticket này chưa có UI flow")).toBeVisible();
  expect((await ctl("/state")).flow_deleted).toBe("1-1");
});

test("Tải file HTML saves the flow on screen, draft included, and posts nothing; a draft is saved by Lưu lên ticket", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await openFlow(page);
  const d = dialog(page);
  await render(page);
  await expect(d.getByRole("button", { name: "Lưu lên ticket", exact: true })).toBeVisible();
  await expect(d.getByRole("button", { name: "Bỏ bản nháp" })).toBeVisible();
  await expect(d.getByRole("button", { name: "Cập nhật", exact: true })).toHaveCount(0);
  await d.getByRole("button", { name: "Tải xuống" }).click(); // one download button: a menu, HTML or Markdown for AI
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "File HTML (xem offline)" }).click()]);
  expect(file.suggestedFilename()).toBe("uiflow-VA-1.html");
  const packing = page.getByRole("status", { name: "Tải file HTML" }); // its scene, held long enough to be seen
  await expect(packing).toBeVisible();
  await expect(packing).toHaveCount(0);
  expect(fs.readFileSync(await file.path(), "utf8")).toMatch(/<style>:root\{[^<]*--color-hl:[^;<]+;/); // the app's colours go along
  // the file stays as a real link: a browser that dropped the script-started save still gets it on a press
  await expect(d.locator("a[download]", { hasText: "Tải xuống" })).toHaveAttribute("download", "uiflow-VA-1.html");
  expect(await posts()).toEqual([]);
});

test("deleting a draft also settles the failed re-render over it: no old error card on the start panel", async ({ page }) => {
  await ctl("/set", { flow: "none" });
  await openFlow(page);
  await render(page);
  await expect(dialog(page).getByText("Đã lưu bản nháp", { exact: false })).toBeVisible();
  // a re-render over that draft failed: the newest job on reopen, while the draft still names the one that drew it
  const done: string[] = [];
  const failed = { id: "failed-12345678", issue: "VA-1", status: "failed", stage: "ai", base: null, result: null, error: { detail: "vượt ngân sách" }, cursor: 1, processed: false, needs_ai_retry: false, request: null };
  await page.route("**/api/yt/flow/jobs?issue=*", (route) => route.fulfill({ json: done.includes(failed.id) ? [] : [failed] }));
  await page.route(`**/api/yt/flow/jobs/${failed.id}/processed`, (route) => { done.push(failed.id); return route.fulfill({ json: { ...failed, processed: true } }); });
  page.once("dialog", (guard) => guard.accept());
  await page.reload();
  await page.goto("/youtrack?ticket=VA-1");
  await flowButton(page).click();
  const d = dialog(page);
  await expect(d.getByText("Lượt render trước không thành công")).toBeVisible();
  await d.getByRole("button", { name: "Bỏ bản render" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Bỏ bản render" }).click();
  await expect(d.getByText("Ticket này chưa có UI flow")).toBeVisible();
  await expect(d.getByText("Lượt render trước không thành công")).toHaveCount(0);
  expect(done).toEqual([failed.id]);
});

test("unclear flow lines start unticked: the render leaves them out unless ticked", async ({ page }) => {
  const line = (no: number, text: string) => ({ no, line: text, why: "unknown", name: "X", hint: "", urls: [] });
  await ctl("/set", { flow: "none", flow_check: { tokens: 12400, parts: { ticket: 900 }, screens: 2, links: 1, warnings: [], model: "m", cost_usd: 0.007, cost_runs: 4, chunks: 1,
    risks: [{ code: "ambiguous", text: "2 dòng luồng màn chưa rõ: không vẽ trừ khi bạn tick", lines: [line(1, "Màn A sang màn lạ"), line(2, "Màn B sang màn khác")] }] } });
  await openFlow(page);
  await dialog(page).getByRole("button", { name: "Render bằng AI", exact: true }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask.getByRole("checkbox", { name: "Vẽ dòng #1" })).not.toBeChecked();
  await expect(ask.getByText("vẽ 0/2")).toBeVisible();
  await ask.getByRole("checkbox", { name: "Vẽ dòng #2" }).check(); // opt in to one
  const request = page.waitForRequest((r) => r.url().endsWith("/api/yt/ai/flow") && r.method() === "POST");
  await confirmRender(page);
  // only the ticked ones go: the server writes the leave-out list itself, every line of it (no cut note)
  const body = (await request).postDataJSON();
  expect(body.draw).toEqual(["Màn B sang màn khác"]);
  expect(body.note).not.toContain("Màn A sang màn lạ");
});

test("a Zeplin redesign that keeps every text is told by its version; a file saved before versions is not flagged for it", async ({ page }) => {
  const z = "https://app.zeplin.io/project/67b2d78bf0a65b348c2550f7/screen/69df58b7254a6ed20c9933f5";
  const pic = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1688"><rect width="780" height="1688" fill="#ddd"/></svg>');
  let saved = ["780x1688", "Gửi OTP"]; // the signature in the file: first without a version
  await page.route(/\/api\/yt\/flow\?/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const j = await (await route.fetch()).json();
    j.flow.screens[0].zeplin = z;
    j.flow.design = { [z]: saved };
    await route.fulfill({ json: j });
  });
  await page.route(/\/api\/yt\/flow\/shots/, (route) => route.fulfill({ json: { missing: [], shots: {
    [z]: { title: "Đăng nhập", ver: "bbb", src: pic, w: 780, h: 1688, hits: [["Gửi OTP", 60, 1400, 660, 120]] } } } }));
  await openFlow(page);
  await expect(dialog(page).locator(".uf-screen.uf-shot")).toHaveCount(1);
  await expect(dialog(page).getByText(/Thiết kế Zeplin của/)).toHaveCount(0); // same size and texts, no version on file
  saved = [...saved, "v:aaa"]; // saved with version aaa; Zeplin now serves bbb with the same texts
  await page.goto("/youtrack?ticket=VA-1");
  await flowButton(page).click();
  await expect(dialog(page).getByText(/Thiết kế Zeplin của 1 màn đã đổi/)).toBeVisible();
});

test("a folded long design is saved with the file and opens folded; the save sends Zeplin's version", async ({ page }) => {
  const z = "https://app.zeplin.io/project/67b2d78bf0a65b348c2550f7/screen/69df58b7254a6ed20c9933f5";
  const pic = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="5000"><rect width="780" height="5000" fill="#ddd"/></svg>');
  await page.route(/\/api\/yt\/flow\?/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const j = await (await route.fetch()).json();
    if (j.flow) j.flow.screens[0].zeplin = z;
    await route.fulfill({ json: j });
  });
  await page.route(/\/api\/yt\/flow\/shots/, (route) => route.fulfill({ json: { missing: [], shots: {
    [z]: { title: "Danh sách", ver: "v42", src: pic, w: 780, h: 5000, hits: [["Gửi OTP", 60, 300, 660, 120]] } } } }));
  // the save packs each image through the same-origin proxy (a Zeplin URL in real use)
  await page.route(/\/api\/yt\/flow\/image/, (route) => route.fulfill({ contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="780" height="5000"><rect width="780" height="5000" fill="#ddd"/></svg>' }));
  await openFlow(page);
  const d = dialog(page), frame = d.locator(".uf-screen.uf-shot");
  await d.getByRole("button", { name: "Sửa", exact: true }).click();
  await frame.getByRole("button", { name: "Thu gọn" }).click();
  await expect(frame).toHaveClass(/uf-folded/);
  await expect(d.getByText(BAR)).toBeVisible();
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByText("Đã cập nhật file trên ticket")).toBeVisible();
  const [p] = (await ctl("/state")).flow_posts as { flow: { screens: { fold?: number }[] }; shots: Record<string, { ver?: string }> }[];
  expect(p.flow.screens[0].fold).toBeCloseTo(844 / 2500, 3);
  expect(p.shots[z].ver).toBe("v42"); // the server records it in the file's design signature
  // opened again: the file draws it folded
  await d.getByRole("button", { name: "Đóng" }).click();
  await page.goto("/youtrack?ticket=VA-1");
  await flowButton(page).click();
  await expect(dialog(page).locator(".uf-screen.uf-shot")).toHaveClass(/uf-folded/);
});
