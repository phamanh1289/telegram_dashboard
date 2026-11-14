import { expect, test } from "@playwright/test";
import { open, box, centre, title, tapIn, withFlow, standalone, exported } from "./uiflow.helpers";

test("prototype walks a path, opens and closes a popup, and goes back", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Prototype" }).click();
  await expect(page.locator(".uf-nav .uf-title")).toHaveText("Đăng nhập");
  await page.locator(".uf-phone").getByText("Gửi OTP").click();
  await expect(page.locator(".uf-nav .uf-title")).toHaveText("Nhập OTP");
  await expect(page.locator(".uf-trail")).toContainText("Đăng nhập›Nhập OTP");
  await page.locator(".uf-phone").getByText("Xác nhận").click();
  await expect(page.locator(".uf-overlay .uf-title")).toHaveText("Sai mã");
  await page.locator(".uf-backdrop").click();
  await expect(page.locator(".uf-overlay")).toHaveCount(0);
  await page.getByRole("button", { name: "Quay lại" }).click();
  await expect(page.locator(".uf-nav .uf-title")).toHaveText("Đăng nhập");
  await expect(page.getByRole("button", { name: "Quay lại" })).toHaveCount(0); // first screen: no back
  await expect(page.locator(".uf-pscreen")).toHaveCount(1); // only the shown screen is rendered
});

test("a button without a target flashes and stays", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Prototype" }).click();
  await tapIn(page, "Gửi OTP");
  await tapIn(page, "Để sau");
  await expect(title(page)).toHaveText("Trang chủ");
  const out = page.locator(".uf-phone").getByRole("button", { name: "Đăng xuất" });
  await out.click();
  await expect(out).toHaveClass(/uf-flash/);
  await expect(title(page)).toHaveText("Trang chủ");
  await page.waitForTimeout(300); // tapped again mid-flash: the flash restarts instead of ending early
  await out.click();
  expect(await page.evaluate(() => document.getAnimations().map((a) => Number(a.currentTime)))).toEqual([0]);
  await page.waitForTimeout(400);
  await expect(out).toHaveClass(/uf-flash/);
  await expect(out).not.toHaveClass(/uf-flash/, { timeout: 1500 });
  await expect(title(page)).toHaveText("Trang chủ");
});

test("phone frame is centred and fits a 375x667 viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page);
  await page.getByRole("button", { name: "Prototype" }).click();
  await expect(title(page)).toHaveText("Đăng nhập");
  await expect.poll(() => page.locator(".uf-phone").evaluate((e) => (e as HTMLElement).style.getPropertyValue("--k")))
    .not.toBe(""); // scaled by a ResizeObserver: before the first paint, but maybe after this read
  const [px, py] = centre(await box(page, ".uf-phone"));
  const [sx, sy] = centre(await box(page, ".uf-stage"));
  expect(Math.max(Math.abs(px - sx), Math.abs(py - sy))).toBeLessThan(2);
  const p = await box(page, ".uf-phone"), s = await box(page, ".uf-stage");
  expect(p.y).toBeGreaterThanOrEqual(s.y);
  expect(p.y + p.height).toBeLessThanOrEqual(s.y + s.height);
  expect(p.x).toBeGreaterThanOrEqual(s.x);
  expect(p.x + p.width).toBeLessThanOrEqual(s.x + s.width);
  expect(p.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]))
    .toEqual([375, 667]);
  await expect(page.locator(".uf-trail")).toBeInViewport({ ratio: 1 });
});

test("a button with two conditions asks which one", async ({ page }) => {
  await open(page);
  await withFlow(page, 'f.links.push({ src: "code.ok", to: "home", act: "navigate", when: "Mã đúng", ac: "AC-3" });');
  await page.getByRole("button", { name: "Prototype" }).click();
  await tapIn(page, "Gửi OTP");
  await tapIn(page, "Xác nhận");
  const pick = page.locator(".uf-overlay");
  await expect(pick.locator(".uf-title")).toHaveText("Chọn trường hợp");
  await expect(pick.getByRole("button")).toHaveText(["Mã sai", "Mã đúng"]);
  await pick.getByRole("button", { name: "Mã đúng" }).click();
  await expect(title(page)).toHaveText("Trang chủ");
  await expect(page.locator(".uf-overlay")).toHaveCount(0);
});

test("a toast hides itself; Esc closes the top overlay; the trail goes back", async ({ page }) => {
  await open(page);
  await withFlow(page, `
    f.screens[0].items.push({ id: "save", label: "Lưu" });
    f.screens.push({ id: "saved", title: "Đã lưu", kind: "toast", parent: "login", zeplin: "", ac: "", items: [] });
    f.links.push({ src: "login.save", to: "saved", act: "open", when: "", ac: "" });`);
  await page.getByRole("button", { name: "Prototype" }).click();
  await tapIn(page, "Lưu");
  await expect(page.locator(".uf-overlay .uf-title")).toHaveText("Đã lưu");
  await page.waitForTimeout(1000);
  await expect(page.locator(".uf-overlay")).toHaveCount(1); // still up after 1s
  await expect(page.locator(".uf-overlay")).toHaveCount(0, { timeout: 2000 }); // gone after 2s
  await tapIn(page, "Gửi OTP");
  await tapIn(page, "Xác nhận");
  await expect(page.locator(".uf-overlay")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".uf-overlay")).toHaveCount(0);
  await page.locator(".uf-trail").getByRole("button", { name: "Đăng nhập" }).click();
  await expect(title(page)).toHaveText("Đăng nhập");
  await tapIn(page, "Gửi OTP");
  await page.getByRole("button", { name: "Bắt đầu lại" }).click();
  await expect(title(page)).toHaveText("Đăng nhập");
});

test("reduced motion: prototype swaps screens at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.getByRole("button", { name: "Prototype" }).click();
  await expect(title(page)).toHaveText("Đăng nhập");
  const after = await page.evaluate(() => {
    [...document.querySelectorAll<HTMLButtonElement>(".uf-phone button")].find((b) => b.textContent === "Gửi OTP")!.click();
    return [document.querySelectorAll(".uf-pscreen").length, document.querySelector(".uf-nav .uf-title")!.textContent,
      document.getAnimations().length];
  });
  expect(after).toEqual([1, "Nhập OTP", 0]);
});

test("hash #s=code&m=play opens Prototype on that screen", async ({ page }) => {
  await open(page, "#s=code&m=play");
  await expect(title(page)).toHaveText("Nhập OTP");
  await expect(page.getByRole("button", { name: "Prototype" })).toHaveAttribute("aria-pressed", "true");
});

test("standalone file: navigation in Prototype keeps the hash", async ({ page }) => {
  await standalone(page, "#s=code&m=play");
  await expect(title(page)).toHaveText("Nhập OTP");
  await tapIn(page, "Để sau");
  await expect(title(page)).toHaveText("Trang chủ");
  await expect(page).toHaveURL(/#s=home&m=play$/);
});

test("Back falls back to the path walked when the screen has no back link", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Prototype" }).click();
  await tapIn(page, "Gửi OTP");
  await tapIn(page, "Để sau");
  await expect(title(page)).toHaveText("Trang chủ"); // home declares no back link
  await page.getByRole("button", { name: "Quay lại" }).click();
  await expect(title(page)).toHaveText("Nhập OTP");
  await expect(page.locator(".uf-trail")).not.toContainText("Trang chủ");
});

test("nested overlays: close drops the top one, the rows behind it are inert", async ({ page }) => {
  await open(page);
  await withFlow(page, `
    f.screens[2].items.push({ id: "more", label: "Mở thêm" });
    f.screens.push({ id: "p2", title: "Lớp hai", kind: "sheet", parent: "err", zeplin: "", ac: "",
      items: [{ id: "x", label: "Đóng lớp hai" }] });
    f.links.push({ src: "err.more", to: "p2", act: "open", when: "", ac: "" });
    f.links.push({ src: "p2.x", to: "err", act: "close", when: "", ac: "" });`);
  await page.getByRole("button", { name: "Prototype" }).click();
  await tapIn(page, "Gửi OTP");
  await tapIn(page, "Xác nhận");
  await expect(page.locator(".uf-overlay")).toHaveCount(1);
  // the screen behind the popup is out of reach: inert, so it takes neither focus nor taps
  expect(await page.locator(".uf-pbody").evaluate((e) => (e as HTMLElement).inert)).toBe(true);
  expect(await page.locator(".uf-nav").evaluate((e) => (e as HTMLElement).inert)).toBe(true);
  expect(await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>(".uf-pbody button")!;
    b.focus();
    return document.activeElement === b;
  })).toBe(false);
  await tapIn(page, "Mở thêm");
  await expect(page.locator(".uf-overlay")).toHaveCount(2);
  await tapIn(page, "Đóng lớp hai");
  await expect(page.locator(".uf-overlay")).toHaveCount(1);
  await expect(page.locator(".uf-overlay .uf-title")).toHaveText("Sai mã");
  await page.keyboard.press("Escape");
  await expect(page.locator(".uf-overlay")).toHaveCount(0);
  expect(await page.locator(".uf-pbody").evaluate((e) => (e as HTMLElement).inert)).toBe(false);
});

test("destroy() clears the prototype timers", async ({ page }) => {
  await open(page);
  await withFlow(page, `
    f.screens[0].items.push({ id: "save", label: "Lưu" }, { id: "nowhere", label: "Chưa nối" });
    f.screens.push({ id: "saved", title: "Đã lưu", kind: "toast", parent: "login", zeplin: "", ac: "", items: [] });
    f.links.push({ src: "login.save", to: "saved", act: "open", when: "", ac: "" });`);
  await page.evaluate(() => {
    const live = new Set<number>(), st = window.setTimeout, ct = window.clearTimeout;
    window.__live = live;
    window.setTimeout = ((f: TimerHandler, ms?: number) => { const id = st(f, ms); live.add(id); return id; }) as typeof setTimeout;
    window.clearTimeout = ((id?: number) => { live.delete(id!); return ct(id); }) as typeof clearTimeout;
  });
  await page.getByRole("button", { name: "Prototype" }).click();
  await tapIn(page, "Chưa nối"); // flash timer
  await tapIn(page, "Lưu"); // toast timer
  const before = await page.evaluate(() => window.__live.size);
  await page.evaluate(() => window.__api.destroy());
  expect(await page.evaluate(() => window.__live.size)).toBeLessThanOrEqual(before - 2);
  await expect(page.locator(".uf-root")).toHaveCount(0);
});

for (const [w, hh] of [[390, 844], [1440, 900]]) {
  test(`an exported file fills a ${w}x${hh} screen: map, then a centred, tappable phone`, async ({ page }) => {
    await open(page);
    const html = exported(await page.evaluate(() => window.SAMPLE));
    expect(html).not.toMatch(/<style/i); // the point: the shell brings no layout of its own
    await page.setViewportSize({ width: w, height: hh });
    await page.route("http://uiflow.test/**", (r) => r.fulfill({ contentType: "text/html", body: html }));
    await page.goto("http://uiflow.test/uiflow-VA-1.html");

    const root = await box(page, ".uf-root");
    expect([root.x, root.y, root.width, root.height]).toEqual([0, 0, w, hh]); // the whole viewport, no body margin
    for (const id of ["login", "code", "home"]) {
      const f = await box(page, `.uf-screen[data-id="${id}"]`);
      expect(f.width).toBeGreaterThan(20);
      expect(f.height).toBeGreaterThan(40);
    }
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]))
      .toEqual([w, hh]);

    await page.getByRole("button", { name: "Prototype" }).click();
    await expect(title(page)).toHaveText("Đăng nhập");
    // the frame is scaled by a ResizeObserver, which runs before the first paint but may run after this read
    await expect.poll(() => page.locator(".uf-phone").evaluate((e) => (e as HTMLElement).style.getPropertyValue("--k")))
      .not.toBe("");
    const phone = await box(page, ".uf-phone"), stage = await box(page, ".uf-stage"), bar = await box(page, ".uf-bar");
    expect(phone.x).toBeGreaterThanOrEqual(0); // whole phone on screen
    expect(phone.y).toBeGreaterThanOrEqual(bar.y + bar.height); // below the real (possibly wrapped) toolbar
    expect(phone.x + phone.width).toBeLessThanOrEqual(w);
    expect(phone.y + phone.height).toBeLessThanOrEqual(hh);
    const [px, py] = centre(phone), [sx, sy] = centre(stage);
    expect(Math.max(Math.abs(px - sx), Math.abs(py - sy))).toBeLessThan(2);
    await tapIn(page, "Gửi OTP");
    await expect(title(page)).toHaveText("Nhập OTP");
  });
}
