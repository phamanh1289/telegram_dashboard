import { flowDataset } from "./uiflow-datasets";
import { expect, test } from "@playwright/test";
import { open, box, edit, dirty, type Win, remount, find, selectScreen } from "./uiflow.helpers";

test("search: accents / case ignored, keyboard picks a result and focuses it, nothing becomes dirty", async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => JSON.stringify(window.__api.get()));
  await find(page).fill("NHAP");
  await expect(page.locator(".uf-count")).toHaveText("2 màn");
  await expect(page.locator(".uf-screen.uf-match")).toHaveCount(2);
  await find(page).press("ArrowDown");
  await find(page).press("ArrowDown");
  await expect(page.getByRole("option", { name: "Nhập OTP" })).toHaveAttribute("aria-selected", "true");
  await find(page).press("Enter");
  await expect(page.locator('.uf-screen[data-id="code"]')).toHaveClass(/uf-on/);
  await expect(page.locator(".uf-results")).toBeHidden();
  await find(page).fill("https://zpl.io/abc123");
  await expect(page.locator(".uf-screen.uf-match")).toHaveAttribute("data-id", "login");
  await find(page).fill("home");
  await expect(page.locator(".uf-screen.uf-match")).toHaveAttribute("data-id", "home");
  await find(page).fill("dang xuat"); // a button's words find its screen
  await expect(page.locator(".uf-screen.uf-match")).toHaveAttribute("data-id", "home");
  await find(page).fill("không có");
  await expect(page.locator(".uf-count")).toHaveText("Không thấy màn nào");
  await find(page).fill("sai");
  await find(page).press("Escape");
  await expect(page.locator(".uf-screen.uf-match")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(window.__api.get()))).toBe(before);
  expect(await dirty(page)).toBe(false);
});

test("+ Từ Zeplin: reads the screen once, adds it with its name and image, one undo removes it", async ({ page }) => {
  await open(page);
  await remount(page);
  await edit(page);
  await page.getByRole("button", { name: "+ Từ Zeplin" }).click();
  const url = "https://app.zeplin.io/project/aaaaaaaaaaaaaaaaaaaaaaaa/screen/bbbbbbbbbbbbbbbbbbbbbbbb";
  await page.keyboard.type(url); // keyboard only: the box has focus
  await page.keyboard.press("Enter");
  await expect(page.locator(".uf-screen", { hasText: "Thanh toán" })).toHaveCount(1);
  await expect(page.locator(".uf-screen", { hasText: "Thanh toán" }).locator(".uf-img")).toHaveCount(1);
  const added = await page.evaluate(() => window.__api.get().screens.at(-1)!);
  expect([added.title, added.zeplin]).toEqual(["Thanh toán", url]);
  expect(await page.evaluate(() => (window as unknown as Win).__calls)).toBe(1);
  await expect(page.locator(".uf-zform")).toBeHidden();
  await page.evaluate(() => window.__api.undo());
  await expect(page.locator(".uf-screen")).toHaveCount(4);
  expect(await dirty(page)).toBe(false);
});

test("+ Từ Zeplin: a bad link, a duplicate, a missing screen and an auth error each say so", async ({ page }) => {
  await open(page);
  await remount(page, "fail");
  await edit(page);
  await page.getByRole("button", { name: "+ Từ Zeplin" }).click();
  const box = page.getByLabel("Link màn Zeplin"), msg = page.locator(".uf-zmsg");
  await box.fill("https://example.com/x");
  await box.press("Enter");
  await expect(msg).toHaveText(/Link Zeplin không đúng/);
  await box.fill("https://zpl.io/abc123"); // already the login screen
  await box.press("Enter");
  await expect(msg).toHaveText(/Đã có màn này: “Đăng nhập”/);
  await expect(page.locator('.uf-screen[data-id="login"]')).toHaveClass(/uf-on/);
  expect(await page.evaluate(() => (window as unknown as Win).__calls)).toBe(0);
  await box.fill("https://zpl.io/new1");
  await box.press("Enter");
  await expect(msg).toHaveText("Không đọc được Zeplin: Token Zeplin bị từ chối"); // an error, not "not found"
  await page.evaluate(() => { (window as unknown as Win).__lookup = "missing"; });
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(msg).toHaveText(/chưa chia sẻ với tài khoản hoặc đã bị xoá/);
  await page.getByRole("button", { name: "Thêm màn chờ ảnh" }).click();
  await expect(page.locator(".uf-screen")).toHaveCount(5);
  const added = await page.evaluate(() => window.__api.get().screens.at(-1)!);
  expect([added.title, added.zeplin]).toEqual(["Màn mới", "https://zpl.io/new1"]);
  await page.evaluate(() => { (window as unknown as Win).__lookup = "ok"; });
  await page.getByRole("button", { name: "+ Từ Zeplin" }).click();
  await page.getByLabel("Link màn Zeplin").fill("https://zpl.io/abc123");
  await page.getByLabel("Link màn Zeplin").press("Enter");
  await page.getByRole("button", { name: "Vẫn thêm bản sao" }).click();
  await expect(page.locator(".uf-screen")).toHaveCount(6);
});

test("390px container: toolbar wraps, finder and inspector stay inside, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await open(page);
  await edit(page);
  await selectScreen(page, "home");
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll(".uf-bar > *, .uf-insp, .uf-find")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.left < -0.5 || r.right > vw + 0.5;
    });
    return { scroll: document.documentElement.scrollWidth > vw, out: out.length };
  });
  expect(over).toEqual({ scroll: false, out: 0 });
  const insp = await box(page, ".uf-insp"), main = await box(page, ".uf-main");
  expect(insp.y + insp.height).toBeLessThanOrEqual(main.y + main.height + 0.5);
});

test("60 screens: a search keystroke and its highlight stay under one 100 ms task", async ({ page }) => {
  await open(page);
  const { flow, shots } = flowDataset(60);
  const ms = await page.evaluate(({ flow, shots }) => {
    window.__api.destroy();
    window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, flow, { edit: true, shots });
    const box = document.querySelector<HTMLInputElement>(".uf-find input")!;
    let worst = 0;
    for (const q of ["m", "ma", "man", "màn 1", "https://", "s5"]) {
      box.value = q;
      const t0 = performance.now();
      box.dispatchEvent(new Event("input"));
      worst = Math.max(worst, performance.now() - t0);
    }
    return worst;
  }, { flow, shots });
  expect(ms).toBeLessThan(100);
});
