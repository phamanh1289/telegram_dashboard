import { expect, type Page, test } from "@playwright/test";

// First run: a tab that is not signed in shows its own sign-in card in place (no jump to Cài đặt), and the mascot reacts
// to what is typed: eyes shut on a secret, a shake on an error.

async function loggedOut(page: Page) {
  await page.route("**/api/status", async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), state: "login_required", telegram_api_id: 1 } }));
}
const mood = (page: Page) => page.locator("[data-mood]");

test("telegram login_required: the tab shows the login card, no redirect", async ({ page }) => {
  await loggedOut(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kết nối Telegram" })).toBeVisible();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(mood(page)).toHaveAttribute("data-mood", "idle");
});

test("code step: boxes follow the length, paste keeps digits, eyes close on 2FA", async ({ page }) => {
  await loggedOut(page);
  await page.route("**/api/telegram/code", (r) => r.fulfill({ json: { via: "app", length: 6 } }));
  let sent = "";
  await page.route("**/api/telegram/sign-in", (r) => { sent = r.request().postData() ?? ""; return r.fulfill({ json: { password_required: true } }); });
  await page.goto("/");
  await page.getByLabel("Số điện thoại").fill("+84 900 000 000");
  await page.getByRole("button", { name: "Gửi mã" }).click();
  await expect(page.getByText("Mã gửi vào app Telegram")).toBeVisible();
  await expect(page.locator('[data-slot="code-cell"]')).toHaveCount(6);
  await page.getByLabel("Mã đăng nhập").fill("Code: 12 3456");
  await expect(page.getByLabel("Mật khẩu 2FA")).toBeVisible(); // filled up: sent on its own
  expect(JSON.parse(sent)).toEqual({ code: "123456" });
  await page.getByLabel("Mật khẩu 2FA").focus();
  await expect(mood(page)).toHaveAttribute("data-mood", "shy");
  await page.getByRole("button", { name: "Hiện / ẩn nội dung" }).click();
  await expect(mood(page)).toHaveAttribute("data-mood", "peek");
  await page.getByRole("button", { name: "Đổi số / gửi lại mã" }).click();
  await expect(mood(page)).toHaveAttribute("data-mood", "idle");
  await expect(page.getByLabel("Số điện thoại")).toBeVisible();
});

test("code of unknown length: up to 8 digits, nothing sends until Đăng nhập", async ({ page }) => {
  await loggedOut(page);
  await page.route("**/api/telegram/code", (r) => r.fulfill({ json: { via: "other", length: null } }));
  let sent = "";
  await page.route("**/api/telegram/sign-in", (r) => { sent = r.request().postData() ?? ""; return r.fulfill({ json: { password_required: true } }); });
  await page.goto("/");
  await page.getByLabel("Số điện thoại").fill("+84 900 000 000");
  await page.getByRole("button", { name: "Gửi mã" }).click();
  await page.getByLabel("Mã đăng nhập").fill("1234567");
  await expect(page.locator('[data-slot="code-cell"]')).toHaveCount(8);
  await page.getByLabel("Mã đăng nhập").fill("123456789");
  await expect(page.getByLabel("Mã đăng nhập")).toHaveValue("12345678");
  await page.getByLabel("Mã đăng nhập").press("9"); // a stray key on a full code keeps it
  await expect(page.getByLabel("Mã đăng nhập")).toHaveValue("12345678");
  expect(sent).toBe("");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByLabel("Mật khẩu 2FA")).toBeVisible();
  expect(JSON.parse(sent)).toEqual({ code: "12345678" });
});

test("flood_wait shows the error and shakes, not a normal state", async ({ page }) => {
  await loggedOut(page);
  await page.route("**/api/telegram/code", (r) => r.fulfill({ status: 429, json: { error: { code: "flood_wait", retry_after: 30, detail: null } } }));
  await page.goto("/");
  await page.getByLabel("Số điện thoại").fill("+84 900 000 000");
  await page.getByRole("button", { name: "Gửi mã" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Telegram tạm chặn" })).toBeVisible();
  await expect(mood(page)).toHaveAttribute("data-mood", "no");
});

test("youtrack with no token: the tab shows the token card, no redirect", async ({ page }) => {
  await page.route("**/api/yt/config", (r) => r.fulfill({ json: { base: "", mock: true, hint: null, t: { wip: 3, stale: 7, dead: 14 }, hist: 0, ai: false } }));
  await page.goto("/youtrack/");
  await expect(page.getByRole("heading", { name: "Kết nối YouTrack" })).toBeVisible();
  await expect(page).toHaveURL(/\/youtrack\/(\?.*)?$/);
  await page.getByLabel("Token YouTrack").focus();
  await expect(mood(page)).toHaveAttribute("data-mood", "shy");
});

test("signed in from the tab: the card stays while the mascot waves, even if status turns connected at once", async ({ page }) => {
  let state = "login_required";
  await page.route("**/api/status", async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), state, telegram_api_id: 1 } }));
  await page.route("**/api/telegram/code", (r) => r.fulfill({ json: { via: "app", length: 5 } }));
  await page.route("**/api/telegram/sign-in", (r) => { state = "connected"; return r.fulfill({ json: { password_required: false } }); });
  await page.goto("/");
  await page.getByLabel("Số điện thoại").fill("+84 900 000 000");
  await page.getByRole("button", { name: "Gửi mã" }).click();
  // the card polls status every 2 s: sign in ~1.5 s after a read, so the next read lands while the mascot waves
  await page.waitForRequest("**/api/status");
  await page.waitForTimeout(1500);
  await page.getByLabel("Mã đăng nhập").fill("12345");
  await expect(mood(page)).toHaveAttribute("data-mood", "happy");
  await page.waitForTimeout(800);
  await expect(page.getByRole("heading", { name: "Kết nối Telegram" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bạn làm vai trò nào?" })).toBeVisible({ timeout: 4000 });
});

test("a full code box: typing again starts over instead of slipping a digit in and resending", async ({ page }) => {
  await loggedOut(page);
  await page.route("**/api/telegram/code", (r) => r.fulfill({ json: { via: "app", length: 5 } }));
  let calls = 0;
  await page.route("**/api/telegram/sign-in", (r) => { calls++; return r.fulfill({ status: 400, json: { error: { code: "code_invalid", retry_after: null, detail: null } } }); });
  await page.goto("/");
  await page.getByLabel("Số điện thoại").fill("+84 900 000 000");
  await page.getByRole("button", { name: "Gửi mã" }).click();
  await page.getByLabel("Mã đăng nhập").fill("12345");
  await expect(page.getByRole("alert").filter({ hasText: "Mã không đúng" })).toBeVisible();
  await page.locator('[data-slot="code-cell"]').first().click({ force: true });
  await page.keyboard.type("6");
  await expect(page.getByLabel("Mã đăng nhập")).toHaveValue("6");
  expect(calls).toBe(1);
});

test("settings card: a sign-in that the server has not taken still shows the form, not 'Đã đăng nhập'", async ({ page }) => {
  await loggedOut(page);
  await page.route("**/api/telegram/code", (r) => r.fulfill({ json: { via: "app", length: 5 } }));
  await page.route("**/api/telegram/sign-in", (r) => r.fulfill({ json: { password_required: false } }));
  await page.goto("/settings/#telegram");
  await page.getByLabel("Số điện thoại").fill("+84 900 000 000");
  await page.getByRole("button", { name: "Gửi mã" }).click();
  await page.getByLabel("Mã đăng nhập").fill("12345");
  await page.waitForTimeout(500);
  await expect(page.getByText("Chưa đăng nhập Telegram")).toBeVisible();
  await expect(page.getByText("Đã đăng nhập")).toHaveCount(0);
});
