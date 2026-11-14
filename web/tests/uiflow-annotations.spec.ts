import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { type Item, type Flow, open, box, title, standalone, edit, dirty, PIC, remount, find, selectScreen } from "./uiflow.helpers";

test("tap area: drawn on the image as a new button, resized, typed, matched by text again; each one undo", async ({ page }) => {
  await open(page);
  await remount(page);
  await edit(page);
  await selectScreen(page, "login");
  await page.getByRole("button", { name: "+ Vùng bấm" }).click();
  await expect(page.locator(".uf-root")).toHaveClass(/uf-drawing/);
  const f = await box(page, '.uf-screen[data-id="login"]'), k = f.width / 390;
  const at = (x: number, y: number): [number, number] => [f.x + x * 390 * k, f.y + y * 844 * k];
  await page.mouse.move(...at(0.2, 0.4));
  await page.mouse.down();
  await page.mouse.move(...at(0.5, 0.45), { steps: 6 });
  await page.mouse.up();
  const item = await page.evaluate(() => window.__api.get().screens[0].items.at(-1)!);
  expect(item.label).toBe("Nút mới");
  for (const [got, want] of [[item.rect!.x, 0.2], [item.rect!.y, 0.4], [item.rect!.w, 0.3], [item.rect!.h, 0.05]]) expect(got).toBeCloseTo(want, 2);
  await expect(page.locator(".uf-root")).not.toHaveClass(/uf-drawing/);
  const hot = page.locator(`.uf-screen[data-id="login"] .uf-item[data-item="${item.id}"]`);
  await expect(hot).toHaveClass(/uf-rect/);
  await expect(hot).toHaveClass(/uf-sel/);
  // resize by its corner
  const r = await box(page, `.uf-screen[data-id="login"] .uf-item[data-item="${item.id}"] .uf-rsz`);
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 39 * k, r.y + r.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate((id) => window.__api.get().screens[0].items.find((i) => i.id === id)!.rect!.w, item.id)).toBeCloseTo(0.4, 2);
  // numbers in design px (780 × 1688 image)
  const x = page.getByRole("spinbutton", { name: "Vùng (px) X" });
  await x.fill("78");
  await x.press("Enter");
  expect(await page.evaluate((id) => window.__api.get().screens[0].items.find((i) => i.id === id)!.rect!.x, item.id)).toBeCloseTo(0.1, 3);
  await page.getByRole("button", { name: "Khớp theo chữ" }).click();
  expect(await page.evaluate((id) => "rect" in window.__api.get().screens[0].items.find((i) => i.id === id)!, item.id)).toBe(false);
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__api.undo());
  expect(await page.evaluate(() => window.__api.get().screens[0].items.length)).toBe(1);
  expect(await dirty(page)).toBe(false);
});

test("tap area: Esc leaves draw mode, a click without a drag draws nothing", async ({ page }) => {
  await open(page);
  await remount(page);
  await edit(page);
  await selectScreen(page, "login");
  await page.getByRole("button", { name: "+ Vùng bấm" }).click();
  const f = await box(page, '.uf-screen[data-id="login"]');
  await page.mouse.click(f.x + f.width * 0.7, f.y + f.height * 0.3); // clear of the properties panel
  await expect(page.locator(".uf-root")).toHaveClass(/uf-drawing/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".uf-root")).not.toHaveClass(/uf-drawing/);
  expect(await dirty(page)).toBe(false);
});

test("note: plain text kept on blur with a badge, Esc puts the old text back", async ({ page }) => {
  await open(page);
  await edit(page);
  await selectScreen(page, "home");
  const area = page.getByLabel("Ghi chú", { exact: true });
  await area.fill("<b>không</b> phải HTML\nhai dòng");
  await area.blur();
  expect(await page.evaluate(() => window.__api.get().screens.find((s) => s.id === "home")!.note)).toBe("<b>không</b> phải HTML\nhai dòng");
  await expect(page.locator('.uf-screen[data-id="home"] .uf-memo')).toHaveCount(1);
  await expect(page.locator('.uf-screen[data-id="home"] b')).toHaveCount(0);
  await page.getByLabel("Ghi chú", { exact: true }).fill("bỏ");
  await page.getByLabel("Ghi chú", { exact: true }).press("Escape");
  expect(await page.evaluate(() => window.__api.get().screens.find((s) => s.id === "home")!.note)).toBe("<b>không</b> phải HTML\nhai dòng");
  await page.evaluate(() => window.__api.undo());
  await expect(page.locator('.uf-screen[data-id="home"] .uf-memo')).toHaveCount(0);
});

test("arrow keys and the position boxes move a screen with its popup; Sắp xếp lại is one undo", async ({ page }) => {
  await open(page);
  await edit(page);
  const pos = () => page.evaluate(() => Object.fromEntries(window.__api.get().screens.map((s) => [s.id, [s.x, s.y]])));
  const start = await pos();
  await selectScreen(page, "code");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  let now = await pos();
  expect(now.code).toEqual([start.code[0]! + 10, start.code[1]! + 100]);
  expect(now.err).toEqual([start.err[0]! + 10, start.err[1]! + 100]); // its popup comes along
  const x = page.getByRole("spinbutton", { name: "Vị trí X" });
  await x.fill(String(start.code[0]! - 500));
  await x.press("Enter");
  now = await pos();
  expect(now.code[0]).toBe(start.code[0]! - 500);
  expect(now.err[0]).toBe(start.err[0]! - 500);
  const moved = now;
  await page.getByRole("button", { name: "Sắp xếp lại" }).click();
  expect(await pos()).toEqual(start);
  await page.evaluate(() => window.__api.undo());
  expect(await pos()).toEqual(moved);
});

test("rect / note survive Lưu file of a standalone file without images", async ({ page }) => {
  await standalone(page, "", `
    f.screens[0].items[0].rect = { x: 0.1, y: 0.4, w: 0.3, h: 0.05 };
    f.screens[3].note = "ghi chú giữ lại";`);
  await edit(page);
  // no image in this file: the rect is kept, the button is a plain row (only an image places it)
  await expect(page.locator('.uf-screen[data-id="login"] .uf-rect')).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Lưu file" }).click()]);
  const saved = JSON.parse(/id="uiflow-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync((await dl.path())!, "utf8"))![1]) as Flow;
  expect(saved.v).toBe(2);
  expect(saved.screens[0].items[0].rect).toEqual({ x: 0.1, y: 0.4, w: 0.3, h: 0.05 });
  expect(saved.screens[3].note).toBe("ghi chú giữ lại");
});

test("a tap area drags inside its image and nudges with the arrow keys", async ({ page }) => {
  await open(page);
  await page.evaluate((pic) => {
    const f = structuredClone(window.SAMPLE);
    (f.screens[0].items[0] as Item).rect = { x: 0.1, y: 0.4, w: 0.3, h: 0.05 };
    window.__api.destroy();
    window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, f, { edit: true, lang: "vi",
      shots: { "https://zpl.io/abc123": { src: pic, w: 780, h: 1688, hits: [] } } } as object);
  }, PIC);
  await edit(page);
  const rect = () => page.evaluate(() => window.__api.get().screens[0].items[0].rect!);
  const b = await box(page, '.uf-screen[data-id="login"] .uf-rect');
  const k = (await box(page, '.uf-screen[data-id="login"]')).width / 390;
  await page.mouse.move(b.x + 10, b.y + 5);
  await page.mouse.down();
  await page.mouse.move(b.x + 10 + 39 * k, b.y + 5 + 1000 * k, { steps: 6 }); // far below: stays on the image
  await page.mouse.up();
  let r = await rect();
  expect(r.x).toBeCloseTo(0.2, 2);
  expect(r.y + r.h).toBeLessThanOrEqual(1);
  await expect(page.locator('.uf-screen[data-id="login"] .uf-rect')).toHaveClass(/uf-sel/);
  await page.keyboard.press("Shift+ArrowLeft"); // 10 frame px = 10/390 of the image width
  r = await rect();
  expect(r.x).toBeCloseTo(0.2 - 10 / 390, 3);
});

test("keyboard only: find a screen, edit it, place a tap area and move it without a pointer", async ({ page }) => {
  await open(page);
  await remount(page);
  await edit(page);
  await find(page).fill("dang nhap");
  await find(page).press("Enter");
  await expect(page.locator(".uf-insp h2")).toHaveText("Đăng nhập");
  await page.getByRole("button", { name: "+ Vùng bấm" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".uf-root")).toHaveClass(/uf-drawing/);
  await page.keyboard.press("Enter");
  const item = await page.evaluate(() => window.__api.get().screens[0].items.at(-1)!);
  expect(item.rect).toBeTruthy();
  await expect(page.locator(".uf-insp h2")).toHaveText("Nút: Nút mới");
  const x0 = item.rect!.x;
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => window.__api.get().screens[0].items.at(-1)!.rect!.x)).toBeCloseTo(x0 + 2 / 390, 3);
  await page.locator(".uf-view").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".uf-insp")).toBeHidden();
});

test("start screen: chosen in the panel, marked, used by Prototype and the flow check; unknown ids are dropped", async ({ page }) => {
  await open(page);
  await edit(page);
  await selectScreen(page, "code");
  await page.getByRole("button", { name: "▶ Màn bắt đầu" }).click();
  expect(await page.evaluate(() => window.__api.get().start)).toBe("code");
  await expect(page.locator('.uf-screen[data-id="code"] .uf-startb')).toHaveCount(1);
  await expect(page.locator(".uf-startb")).toHaveCount(1);
  const orphans = (start: string | null) => page.evaluate((start) => {
    const f = { ...window.SAMPLE, start, links: window.SAMPLE.links.filter((l) => l.act !== "back") };
    return window.UIFlow.check(f).filter((i) => i.kind === "orphan").map((i) => i.screen);
  }, start);
  expect(await orphans(null)).toEqual([]);
  expect(await orphans("code")).toEqual(["login"]); // nothing leads back to the old first screen
  await page.getByRole("button", { name: "Prototype" }).click();
  await expect(title(page)).toHaveText("Nhập OTP");
  await page.getByRole("button", { name: "Toàn cục" }).click();
  await page.evaluate(() => window.__api.undo());
  expect(await page.evaluate(() => window.__api.get().start)).toBeNull();
  await page.evaluate(() => window.__api.set({ ...window.SAMPLE, start: "ghost" }));
  expect(await page.evaluate(() => window.__api.get().start)).toBeNull();
});

test("Cần rà soát: buttons not on the design and screens with no source, filtered by kind", async ({ page }) => {
  await open(page);
  await remount(page); // login has an image whose only text is "Gửi OTP"
  await page.evaluate(() => {
    const f = window.__api.get();
    f.screens[0].items.push({ id: "ghost", label: "Không có trên ảnh" });
    window.__api.set(f);
  });
  await page.getByRole("button", { name: /Soát luồng/ }).click();
  await expect(page.locator(".uf-issue", { hasText: "“Không có trên ảnh” chưa thấy trên ảnh màn “Đăng nhập”" })).toHaveCount(1);
  await expect(page.locator(".uf-issue", { hasText: "“Nhập OTP” chưa có link Zeplin" })).toHaveCount(1);
  await page.getByRole("button", { name: "Chưa khớp ảnh (1)", exact: true }).click();
  await expect(page.locator(".uf-issue")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Chưa khớp ảnh (1)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Tất cả/ }).click();
  expect(await page.locator(".uf-issue").count()).toBeGreaterThan(3);
  await edit(page); // editing: a row opens the button it is about, ready to draw its area (the panel stays open)
  await page.locator(".uf-issue", { hasText: "Không có trên ảnh" }).first().click();
  await expect(page.locator(".uf-insp h2")).toHaveText("Nút: Không có trên ảnh");
  await expect(page.getByRole("button", { name: "Vùng bấm", exact: true })).toBeVisible();
});

test("redo: steps forward after undo, from the toolbar and the keyboard; a new edit clears it", async ({ page }) => {
  await open(page);
  await edit(page);
  const undo = page.getByRole("button", { name: "↶ Hoàn tác" }), redo = page.getByRole("button", { name: "↷ Làm lại" });
  await expect(undo).toBeDisabled();
  await page.getByRole("button", { name: "+ Màn" }).click();
  await expect(page.locator(".uf-screen")).toHaveCount(5);
  await undo.click();
  await expect(page.locator(".uf-screen")).toHaveCount(4);
  await redo.click();
  await expect(page.locator(".uf-screen")).toHaveCount(5);
  await page.locator(".uf-view").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".uf-screen")).toHaveCount(4);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".uf-screen")).toHaveCount(5);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(redo).toBeEnabled();
  await page.getByRole("button", { name: "+ Màn" }).click(); // a new edit: what undo took back is gone
  await expect(redo).toBeDisabled();
  await undo.click();
  expect(await dirty(page)).toBe(false);
});

test("a run of arrow-key moves is one undo step", async ({ page }) => {
  await open(page);
  await edit(page);
  const x = () => page.evaluate(() => window.__api.get().screens.find((s) => s.id === "home")!.x!);
  const x0 = await x();
  await selectScreen(page, "home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  expect(await x()).toBe(x0 + 50);
  await page.evaluate(() => window.__api.undo());
  expect(await x()).toBe(x0);
});

test("test checklist: paths from the start screen cover every reachable link; copy puts the text on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  const text = await page.evaluate(() => window.UIFlow.paths(window.SAMPLE, "vi"));
  const lines = text.split("\n");
  expect(lines[0]).toBe("Checklist test UI flow VA-1: 3 đường, phủ 4/4 liên kết");
  expect(lines).toContain("1. Đăng nhập → bấm “Gửi OTP” → Nhập OTP → bấm “Xác nhận” (khi Mã sai) → Sai mã");
  expect(text).toContain("bấm “Để sau” → Trang chủ");
  expect(text).toContain("quay lại → Đăng nhập");
  // from another start, what cannot be reached is listed
  expect(await page.evaluate(() => window.UIFlow.paths({ ...window.SAMPLE, start: "home" }, "vi"))).toContain("Chưa đi tới từ màn bắt đầu");
  await page.getByRole("button", { name: /Soát luồng/ }).click();
  await page.getByRole("button", { name: "Checklist test" }).click();
  await expect(page.locator(".uf-paths li")).toHaveCount(3);
  await page.getByRole("button", { name: "Sao chép" }).click();
  await expect(page.locator(".uf-panel .uf-zmsg")).toHaveText("Đã sao chép");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
});
