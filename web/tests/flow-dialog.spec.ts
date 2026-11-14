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
const aiCalls = async () => (await ctl("/state")).ai_calls as number;

// an edit: "Có thay đổi chưa lưu — …"; a fresh render: "AI vừa vẽ 4 màn, … — chưa lưu, …"
const BAR = /cập nhật file trên ticket\?$/;
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
  await ctl("/set", { yt: true, reset_jobs: true, flow: "file", flow_save: "ok", flow_posts: [], ai_ms: 0, ai_calls: 0, save_ms: 0, ticket_newer: false, ai_keep: null });
});
test.afterAll(async () => { await ctl("/set", { yt: false }); }); // the other specs keep the real YouTrack routes

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
  await d.getByRole("button", { name: "Thao tác UI flow" }).click();
  await page.getByRole("menuitem", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
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
  await d.getByRole("button", { name: "Thao tác UI flow" }).click();
  await page.getByRole("menuitem", { name: "Render lại bằng AI" }).click();
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
  await d.getByRole("button", { name: "Thao tác UI flow" }).click();
  await page.getByRole("menuitem", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
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
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
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

test("an edit made while the save is in flight survives it, unsaved, with the bar back", async ({ page }) => {
  await ctl("/set", { flow: "none", save_ms: 1500 });
  await openFlow(page);
  const d = dialog(page);
  await render(page);
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await d.getByRole("button", { name: "Sửa" }).click(); // the canvas stays editable during the upload
  await d.getByRole("button", { name: "+ Màn" }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(5);
  await expect(d.getByText("Đã cập nhật file trên ticket")).toBeVisible();
  await expect(d.locator(".uf-screen")).toHaveCount(5); // not replaced by the saved version
  await expect(d.getByText(BAR)).toBeVisible();
  const [first] = await posts();
  expect(first.flow.screens).toHaveLength(4);
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByText(BAR)).toHaveCount(0);
  const [, second] = await posts();
  expect(second).toMatchObject({ base: "1-2" }); // over the file just saved
  expect(second.flow.screens).toHaveLength(5);
});

// Recovery uses account-scoped server metadata and IndexedDB, never an unscoped browser job pointer.
const flowButton = (page: Page) => page.getByRole("button", { name: "UI flow", exact: true });

test("closing mid-render keeps it going and reopening restores the unsaved result", async ({ page }) => {
  await ctl("/set", { flow: "none", ai_ms: 1500 });
  await openFlow(page);
  await dialog(page).getByRole("button", { name: "Render bằng AI" }).click();
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

test("save locks render replacement until upload completes", async ({ page }) => {
  await ctl("/set", { flow: "none", save_ms: 1500 });
  await openFlow(page); await render(page);
  await dialog(page).getByRole("button", { name: "Cập nhật", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Thao tác UI flow" }).click();
  await expect(page.getByRole("menuitem", { name: "Render lại bằng AI" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog(page).getByText("Đã cập nhật file trên ticket", { exact: false })).toBeVisible();
  expect(await aiCalls()).toBe(1);
});

test("cancel network failure keeps the job recoverable", async ({ page }) => {
  await ctl("/set", { flow: "none", ai_ms: 8000 });
  await openFlow(page);
  await dialog(page).getByRole("button", { name: "Render bằng AI" }).click();
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
    error: null, cursor: 1, processed: false, needs_ai_retry: true, request: { note: "giữ luồng lỗi", deep: true },
  }] }));
  await openFlow(page);
  await expect(dialog(page).getByText("Render bị gián đoạn. Tiếp tục sẽ gọi AI lại.")).toBeVisible();
  expect(await aiCalls()).toBe(0);
  const request = page.waitForRequest((request) => request.url().endsWith("/api/yt/ai/flow") && request.method() === "POST");
  await dialog(page).getByRole("button", { name: "Tiếp tục", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ note: "giữ luồng lỗi", deep: true, base: null });
  await expect(dialog(page).locator(".uf-screen")).toHaveCount(4);
  expect(await aiCalls()).toBe(1);
});

test("rerender over an edited draft recovers the replacement job after close", async ({ page }) => {
  await ctl("/set", { ai_ms: 1800 });
  await openFlow(page);
  let d = dialog(page);
  await d.getByRole("button", { name: "Sửa", exact: true }).click();
  await d.getByRole("button", { name: "+ Màn", exact: true }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(5);
  await d.getByRole("button", { name: "Thao tác UI flow" }).click();
  await page.getByRole("menuitem", { name: "Render lại bằng AI" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Render lại", exact: true }).click();
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
  await scopeRequest;
  await dialog(page).getByRole("button", { name: "Dừng", exact: true }).click();
  await expect(dialog(page).getByRole("button", { name: "Dừng", exact: true })).toHaveCount(0);
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
  await d.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(d.getByRole("button", { name: "Cập nhật", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await d.getByRole("button", { name: "Thao tác UI flow" }).click();
  await expect(page.getByRole("menuitem", { name: "Render lại bằng AI" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(d.getByRole("button", { name: "Cập nhật", exact: true })).toBeDisabled();
  await expect(d.getByText("Đã cập nhật file trên ticket", { exact: false })).toBeVisible();
  expect(await posts()).toHaveLength(1);
  expect(await aiCalls()).toBe(1);
});

test("focus does not replace an edited saved flow with a newer attachment", async ({ page }) => {
  await openFlow(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Sửa", exact: true }).click();
  await d.getByRole("button", { name: "+ Màn", exact: true }).click();
  await expect(d.locator(".uf-screen")).toHaveCount(5);
  await expect(d.getByText("Đã lưu bản nháp", { exact: false })).toBeVisible();
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
  await expect(d.locator(".uf-screen")).toHaveCount(5);
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
  await expect(d.locator(".uf-zmsg")).toHaveText(/Không đọc được Zeplin: .*Token Zeplin bị từ chối/);
  fail = false;
  await d.getByRole("button", { name: "Thử lại" }).click();
  await expect(d.locator(".uf-screen", { hasText: "Thanh toán" })).toHaveCount(1);
  await expect(d.getByText(BAR)).toBeVisible(); // an unsaved edit: Cập nhật writes it, nothing was posted yet
  expect(await posts()).toEqual([]);
  expect(await aiCalls()).toBe(0);
});


test("Xem thay đổi lists what Cập nhật would write, posts nothing, and goes stale on the next edit", async ({ page }) => {
  let asked = 0;
  await page.route("**/api/yt/flow/diff", async (r) => {
    asked++;
    await r.fulfill({ json: { changes: ['Thêm ghi chú màn "Trang chủ"', 'Đặt màn bắt đầu "Nhập OTP"'], base_changed: false } });
  });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.locator(".uf-screen")).toHaveCount(4);
  await d.getByRole("button", { name: "Sửa" }).click();
  await d.getByRole("button", { name: "+ Màn" }).click();
  await d.getByRole("button", { name: "Xem thay đổi" }).click();
  await expect(d.getByText("Cập nhật sẽ ghi 2 thay đổi:")).toBeVisible();
  await expect(d.getByText('Đặt màn bắt đầu "Nhập OTP"')).toBeVisible();
  expect(asked).toBe(1);
  expect(await posts()).toEqual([]);
  await d.getByRole("button", { name: "+ Màn" }).click();
  await expect(d.getByText("Cập nhật sẽ ghi 2 thay đổi:")).toHaveCount(0);
});

test("a ticket edited after the file says how to pick it up; a render sends the flow on screen to keep its edits", async ({ page }) => {
  await ctl("/set", { ticket_newer: true });
  await openFlow(page);
  const d = dialog(page);
  await expect(d.getByText(/Ticket đã sửa sau lần cập nhật UI flow/)).toBeVisible();
  await d.getByRole("button", { name: "Thao tác UI flow" }).click();
  await page.getByRole("menuitem", { name: "Render lại bằng AI" }).click();
  await page.getByRole("button", { name: "Render lại", exact: true }).click();
  await expect(d.getByText(BAR)).toBeVisible();
  const keep = (await ctl("/state")).ai_keep as { screens: { id: string }[] } | null;
  expect(keep?.screens.length).toBe(4);
});
