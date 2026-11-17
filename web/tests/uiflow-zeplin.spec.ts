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
  const box = page.getByLabel("Link màn Zeplin"), report = page.locator(".uf-zreport");
  await box.fill("https://example.com/x");
  await box.press("Enter");
  await expect(report).toContainText("Link Zeplin không đúng");
  await box.fill("https://zpl.io/abc123"); // already the login screen
  await box.press("Enter");
  await expect(report).toContainText("Đã có màn này: “Đăng nhập”");
  await expect(page.locator('.uf-screen[data-id="login"]')).toHaveClass(/uf-on/);
  expect(await page.evaluate(() => (window as unknown as Win).__calls)).toBe(0);
  await box.fill("https://zpl.io/new1");
  await box.press("Enter");
  await expect(report).toContainText("Không đọc được Zeplin: Token Zeplin bị từ chối"); // an error, not "not found"
  await page.evaluate(() => { (window as unknown as Win).__lookup = "missing"; });
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(report).toContainText("chưa chia sẻ với tài khoản hoặc đã bị xoá");
  // nothing went in, and nothing but Thử lại is offered (no link was fine)
  await expect(page.locator(".uf-screen")).toHaveCount(4);
  await expect(page.locator(".uf-zform .uf-acts button")).toHaveText(["Thử lại"]);
  await page.evaluate(() => { (window as unknown as Win).__lookup = "ok"; });
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(page.locator(".uf-screen")).toHaveCount(5);
  await expect(page.locator(".uf-zform")).toBeHidden();
});

test("+ Từ Zeplin: many links at once (comma, space, new line) are one undo; the ones that fail stay listed in the box", async ({ page }) => {
  await open(page);
  await remount(page);
  await page.evaluate(() => {
    const w = window as unknown as Win & { __bad: string };
    w.__bad = "https://zpl.io/gone";
  });
  // the fixture's lookup: "missing" for the one link named __bad, a screen for the others
  await page.evaluate((pic) => {
    const w = window as unknown as Win & { __bad: string };
    window.__api.destroy();
    window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, window.SAMPLE, {
      edit: true, lang: "vi", onChange: (_: unknown, d: boolean) => { window.__dirty = d; },
      lookup: async (url: string) => { w.__calls++; return url === w.__bad ? null : { src: pic, w: 780, h: 1688, hits: [], title: "Màn " + url.split("/").pop() }; },
    } as object);
  }, "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1688"/>'));
  await edit(page);
  const zep = page.locator(".uf-tools").getByRole("button", { name: "+ Từ Zeplin" });
  await zep.click();
  // the popover opens beside its button on the rail, level with it, not across the map
  const [b, f] = [await zep.boundingBox(), await page.locator(".uf-zform").boundingBox()];
  expect(Math.abs(f!.y - b!.y)).toBeLessThan(10);
  expect(f!.x).toBeGreaterThan(b!.x + b!.width - 1);
  const box = page.getByLabel("Link màn Zeplin");
  await box.fill("https://zpl.io/a1, https://zpl.io/a2 https://zpl.io/gone\nhttps://example.com/x,https://zpl.io/abc123 https://zpl.io/a1");
  await expect(page.getByRole("button", { name: "Thêm 5 màn" })).toBeVisible(); // a link twice counts once
  await box.press("Enter");
  // something went wrong: nothing added yet; only the wrong links are listed (a1, a2 were fine: not shown)
  const report = page.locator(".uf-zreport");
  await expect(report).toContainText("3 link lỗi");
  await expect(report.locator("li")).toHaveText([/zpl\.io\/gone.*chưa chia sẻ/, /example\.com\/x.*Link Zeplin không đúng/, /zpl\.io\/abc123.*Đã có màn này/]);
  await expect(page.locator(".uf-screen")).toHaveCount(4);
  await expect(page.locator(".uf-zform .uf-acts button")).toHaveText(["Thử lại", "Thêm 2 màn hình"]);
  await page.getByRole("button", { name: "Thêm 2 màn hình" }).click(); // the fine ones, read already: no new read
  await expect(page.locator(".uf-screen")).toHaveCount(6);
  expect(await page.evaluate(() => (window as unknown as Win).__calls)).toBe(3);
  await expect(box).toHaveValue("https://zpl.io/gone\nhttps://example.com/x\nhttps://zpl.io/abc123"); // left to fix
  await expect(page.locator(".uf-zmsg")).toHaveText("Đã thêm 2 màn.");
  await expect(page.locator(".uf-zform .uf-acts button")).toHaveText(["Thử lại"]);
  expect(await page.evaluate(() => window.__api.get().screens.slice(-2).map((s) => s.title))).toEqual(["Màn a1", "Màn a2"]);
  await page.evaluate(() => window.__api.undo()); // both, one step
  await expect(page.locator(".uf-screen")).toHaveCount(4);
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

test("a screen added from Zeplin never lands on another: the others stay clickable, and ▶ goes to the one picked", async ({ page }) => {
  await open(page);
  await remount(page);
  await edit(page);
  await page.getByRole("button", { name: "+ Từ Zeplin" }).click();
  await page.getByLabel("Link màn Zeplin").fill("https://zpl.io/pay");
  await page.getByLabel("Link màn Zeplin").press("Enter");
  await expect(page.locator(".uf-screen", { hasText: "Thanh toán" })).toHaveCount(1);
  const f = await page.evaluate(() => window.__api.get());
  const added = f.screens.at(-1)!;
  for (const s of f.screens.slice(0, -1)) // 390 × 844 frames: no two rectangles meet
    expect(Math.abs(s.x! - added.x!) >= 390 || Math.abs(s.y! - added.y!) >= 844, `${s.id} is under the new screen`).toBe(true);
  await page.getByRole("button", { name: "Vừa màn hình" }).click();
  // the middle of the map, where the new screen used to be dropped: "Nhập OTP" is still the one a click selects
  await page.locator('.uf-screen[data-id="code"] .uf-title').click();
  await expect(page.locator(".uf-insp h2")).toHaveText("Nhập OTP");
  await page.locator(".uf-insp").getByRole("button", { name: "▶ Màn bắt đầu" }).click();
  expect((await page.evaluate(() => window.__api.get())).start).toBe("code");
  // Prototype begins at the start screen just chosen, not at the screen that was added last
  await page.getByRole("button", { name: "Prototype" }).click();
  await expect(page.locator(".uf-trail .uf-crumb")).toHaveText(["Nhập OTP"]);
  // and a start screen changed on the map later moves it again, over the walk it had kept
  await page.getByRole("button", { name: "Toàn cục" }).click();
  await page.locator('.uf-screen[data-id="home"] .uf-title').click();
  await page.locator(".uf-insp").getByRole("button", { name: "▶ Màn bắt đầu" }).click();
  await page.getByRole("button", { name: "Prototype" }).click();
  await expect(page.locator(".uf-trail .uf-crumb")).toHaveText(["Trang chủ"]);
});

test("a long list folds at its cut: by itself when added from Zeplin, and with the fold button", async ({ page }) => {
  await open(page);
  await page.evaluate((pic) => {
    const long = { src: pic, w: 780, h: 5000, hits: [], cut: 0.2 }; // cut: where the dashboard found the list to fold
    window.__api.destroy();
    window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, window.SAMPLE, {
      edit: true, lang: "vi", onChange: (_: unknown, d: boolean) => { window.__dirty = d; },
      shots: { "https://zpl.io/abc123": long },
      lookup: async () => ({ ...long, title: "Danh sách" }),
    } as object);
  }, "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="5000"/>'));
  await edit(page);
  // a screen the flow already had stays whole until its fold button: then the list's cut, not one phone (844 / 2500)
  expect(await page.evaluate(() => "fold" in window.__api.get().screens[0])).toBe(false);
  await page.locator('.uf-screen[data-id="login"]').getByRole("button", { name: "Thu gọn" }).click();
  expect(await page.evaluate(() => window.__api.get().screens[0].fold)).toBe(0.2);
  await page.locator(".uf-tools").getByRole("button", { name: "+ Từ Zeplin" }).click();
  await page.getByLabel("Link màn Zeplin").fill("https://zpl.io/list1");
  await page.getByLabel("Link màn Zeplin").press("Enter");
  await expect(page.locator(".uf-screen")).toHaveCount(5);
  const added = await page.evaluate(() => window.__api.get().screens.find((s) => s.zeplin === "https://zpl.io/list1"));
  expect(added!.fold).toBe(0.2); // folded as it lands, not 2500 px of repeated items
});
