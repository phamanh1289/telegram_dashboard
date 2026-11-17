import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { type Item, type Flow, open, box, title, standalone, edit, addScreen, dirty, PIC, remount, find, selectScreen, withFlow } from "./uiflow.helpers";

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

test("arrow keys move a screen with its popup; Sắp xếp lại is one undo", async ({ page }) => {
  await open(page);
  await edit(page);
  const pos = () => page.evaluate(() => Object.fromEntries(window.__api.get().screens.map((s) => [s.id, [s.x, s.y]])));
  const start = await pos();
  await selectScreen(page, "code");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const now = await pos();
  expect(now.code).toEqual([start.code[0]! + 10, start.code[1]! + 100]);
  expect(now.err).toEqual([start.err[0]! + 10, start.err[1]! + 100]); // its popup comes along
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
  await expect(page.getByRole("button", { name: "Vẽ vùng bấm", exact: true })).toBeVisible();
});

test("redo: steps forward after undo, from the toolbar and the keyboard; a new edit clears it", async ({ page }) => {
  await open(page);
  await edit(page);
  const undo = page.getByRole("button", { name: "↶ Hoàn tác" }), redo = page.getByRole("button", { name: "↷ Làm lại" });
  await expect(undo).toBeDisabled();
  await addScreen(page);
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
  await addScreen(page); // a new edit: what undo took back is gone
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

test("tap areas stack four deep: the smaller one is on top whatever order they were made in, and takes the press", async ({ page }) => {
  await open(page);
  await remount(page);
  // made smallest first, the largest last: by order alone the last one would cover the three inside it
  await withFlow(page, `
    const r = (id, x, y, w, h) => ({ id, label: "Vùng " + id, rect: { x, y, w, h } });
    f.screens[0].items = [r("l4", 0.3, 0.3, 0.1, 0.05), r("l3", 0.25, 0.25, 0.3, 0.15), r("l2", 0.2, 0.2, 0.5, 0.25), r("l1", 0.1, 0.1, 0.8, 0.4)];
    f.links = [{ src: "login.l4", to: "home", act: "navigate", when: "", ac: "" }, { src: "login.l1", to: "code", act: "navigate", when: "", ac: "" }];`);
  const top = (id: string, dx: number) => page.locator(`.uf-screen[data-id="login"] .uf-item[data-item="${id}"]`).evaluate((el, dx) => {
    const b = el.getBoundingClientRect(); // a point just inside its left edge: on this area, outside the ones within it
    return (document.elementFromPoint(b.left + dx, b.top + b.height / 2) as HTMLElement).closest<HTMLElement>(".uf-item")?.dataset.item;
  }, dx);
  for (const id of ["l1", "l2", "l3", "l4"]) expect(await top(id, 3)).toBe(id);
  // Prototype: the press goes to the area on top, never to the one under it
  await page.getByRole("button", { name: "Prototype" }).click();
  const hot = (id: string) => page.locator(".uf-pshot").getByRole("button", { name: "Vùng " + id, exact: true });
  await hot("l4").click(); // Playwright refuses the click if another area covered it
  await expect(title(page)).toHaveText("Trang chủ"); // l4's link, not l1's ("Nhập OTP") under it
  await page.getByRole("button", { name: "Bắt đầu lại" }).click();
  await hot("l1").click({ position: { x: 4, y: 4 } });
  await expect(title(page)).toHaveText("Nhập OTP");
});

test("a screen is renamed in the panel's name field; an emptied box keeps the name", async ({ page }) => {
  await open(page);
  await remount(page);
  await edit(page);
  await selectScreen(page, "login");
  const name = page.locator(".uf-insp").getByRole("textbox", { name: "Tên màn" });
  await expect(name).toHaveValue("Đăng nhập");
  await name.fill("Đăng nhập bằng OTP");
  await name.press("Enter");
  expect(await page.evaluate(() => window.__api.get().screens[0].title)).toBe("Đăng nhập bằng OTP");
  await expect(page.locator('.uf-screen[data-id="login"] .uf-title')).toHaveText("Đăng nhập bằng OTP");
  const again = page.locator(".uf-insp").getByRole("textbox", { name: "Tên màn" });
  await again.fill("");
  await again.press("Enter");
  expect(await page.evaluate(() => window.__api.get().screens[0].title)).toBe("Đăng nhập bằng OTP");
  await page.evaluate(() => window.__api.undo());
  expect(await page.evaluate(() => window.__api.get().screens[0].title)).toBe("Đăng nhập");
});

test("the edit tools are icons: the words slide out beside the icon on hover", async ({ page }) => {
  await open(page);
  await remount(page);
  await edit(page);
  for (const label of ["+ Từ Zeplin", "Sắp xếp lại", "↶ Hoàn tác", "↷ Làm lại"]) {
    const b = page.locator(".uf-tools").getByRole("button", { name: label, exact: true });
    await expect(b).not.toHaveAttribute("title", /.*/);
    await expect(b.locator("svg")).toBeVisible();
    expect((await b.locator("span").boundingBox())!.width).toBe(0);
  }
  const zep = page.locator(".uf-tools").getByRole("button", { name: "+ Từ Zeplin", exact: true });
  await zep.hover();
  await expect(zep.locator("span")).toHaveText("Từ Zeplin");
  await expect.poll(async () => (await zep.locator("span").boundingBox())!.width).toBeGreaterThan(40);
});

/** The fixture's flow, changed by `tweak`, mounted editable with `shots` for the login screen's design. */
const mountWith = (page: import("@playwright/test").Page, shot: object, tweak = "") => page.evaluate(({ shot, tweak, pic }) => {
  const f = structuredClone(window.SAMPLE);
  if (tweak) new Function("f", tweak)(f);
  window.__api.destroy();
  window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, f, { edit: true, lang: "vi",
    shots: { "https://zpl.io/abc123": { src: pic, w: 780, hits: [], ...shot } } } as object);
}, { shot, tweak, pic: PIC });

test("a design that scrolls is drawn whole: its lower buttons sit on it, and nothing saved under it is covered", async ({ page }) => {
  await open(page);
  // 780 × 7000 at 390 wide: a frame 3500 high (4 phones). The fixture's "Nhập OTP" was saved right under it.
  const low = `f.screens[0].items.push({ id: "end", label: "Cập nhật", rect: { x: 0.1, y: 0.95, w: 0.8, h: 0.02 } });
    f.screens[0].x = 0; f.screens[0].y = 0; f.screens[1].x = 0; f.screens[1].y = 964; f.screens[3].x = 610; f.screens[3].y = 0;`;
  await mountWith(page, { h: 7000 }, low);
  const at = await page.evaluate(() => Object.fromEntries(window.__api.get().screens.map((s) => [s.id, [s.x, s.y]])));
  expect(at.login).toEqual([0, 0]);
  expect(at.code).toEqual([0, 3620]); // moved clear of the long design (3500 + the row gap), its popup with it
  expect(at.home).toEqual([610, 0]); // another column: untouched
  const frame = page.locator('.uf-screen[data-id="login"]');
  expect(await frame.evaluate((el) => (el as HTMLElement).style.height)).toBe("3500px");
  await expect(frame.locator('.uf-item[data-item="end"]')).toHaveClass(/uf-hot/); // on the design, not a row under a cut image
  expect((await page.evaluate(() => window.UIFlow.check(window.__api.get()))).filter((i) => i.kind === "offshot" && i.item === "end")).toEqual([]);
  // a fresh layout puts nothing under a long design, and "fit" counts it as two phones: the other frames stay
  // readable instead of shrinking to a dot
  await edit(page);
  await page.getByRole("button", { name: "Sắp xếp lại" }).click();
  const laid = await page.evaluate(() => window.__api.get().screens.filter((s) => s.kind === "screen").map((s) => [s.x, s.y]));
  expect(laid.filter(([x]) => x === laid[0][0])).toHaveLength(1); // the long design has its column to itself
  expect(Math.max(...laid.map(([, y]) => y as number))).toBeLessThan(844);
  await page.getByRole("button", { name: "Vừa màn hình" }).click();
  await expect.poll(async () => (await box(page, '.uf-screen[data-id="home"]')).width).toBeGreaterThan(100);
});

test("+ Vùng bấm: a click on a text of the design makes it the button, with its words and its place", async ({ page }) => {
  await open(page);
  await mountWith(page, { h: 1688, hits: [["Gửi OTP", 0, 0, 200, 50], ["Quên mật khẩu", 100, 800, 300, 60]] });
  await edit(page);
  await selectScreen(page, "login");
  await page.getByRole("button", { name: "+ Vùng bấm" }).click();
  await expect(page.locator('.uf-screen[data-id="login"] .uf-zl i')).toHaveCount(2); // the design's texts, outlined
  const f = await box(page, '.uf-screen[data-id="login"]'), k = f.width / 390;
  const at = (x: number, y: number): [number, number] => [f.x + x * 390 * k, f.y + y * 844 * k];
  await page.mouse.click(...at(0.8, 0.8)); // no text there: nothing made, still drawing
  expect(await page.evaluate(() => window.__api.get().screens[0].items.length)).toBe(1);
  await expect(page.locator(".uf-root")).toHaveClass(/uf-drawing/);
  await page.mouse.click(...at(0.3, 0.49));
  const item = await page.evaluate(() => window.__api.get().screens[0].items.at(-1)!);
  expect(item.label).toBe("Quên mật khẩu");
  for (const [got, want] of [[item.rect!.x, 100 / 780], [item.rect!.y, 800 / 1688], [item.rect!.w, 300 / 780], [item.rect!.h, 60 / 1688]]) expect(got).toBeCloseTo(want, 3);
  await expect(page.locator(".uf-root")).not.toHaveClass(/uf-drawing/);
  await expect(page.locator(".uf-zl")).toHaveCount(0);
  await page.evaluate(() => window.__api.undo()); // one step
  expect(await page.evaluate(() => window.__api.get().screens[0].items.length)).toBe(1);
});

test("a checklist path is walked by Prototype itself, a step at a time; Esc stops it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Soát luồng/ }).click();
  await page.getByRole("button", { name: "Checklist test" }).click();
  await page.locator(".uf-paths .uf-path").first().click(); // Đăng nhập → Gửi OTP → Nhập OTP → Xác nhận → Sai mã
  await expect(page.locator(".uf-root")).toHaveAttribute("data-mode", "play");
  await expect(page.locator(".uf-phone")).toHaveClass(/uf-walking/);
  await expect(title(page)).toHaveText("Đăng nhập");
  await expect(title(page)).toHaveText("Nhập OTP");
  await expect(page.locator(".uf-phone").getByRole("dialog", { name: "Sai mã" })).toBeVisible();
  await expect(page.locator(".uf-phone")).not.toHaveClass(/uf-walking/); // the path is done
  await page.getByRole("button", { name: "Toàn cục" }).click();
  await page.getByRole("button", { name: /Soát luồng/ }).click();
  await page.locator(".uf-paths .uf-path").first().click();
  await expect(page.locator(".uf-phone")).toHaveClass(/uf-walking/);
  await page.locator(".uf-phone").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".uf-phone")).not.toHaveClass(/uf-walking/);
  await page.waitForTimeout(1300);
  await expect(title(page)).toHaveText("Đăng nhập"); // it went no further
});

test("the ticket's AC no screen or arrow carries are one row; the steps without a design copy as a message of three", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await withFlow(page, `f.acs = ["AC1", "AC2.1", "AC9", "AC10", "bad"];
    f.pending = ["Lỗi mạng", "Hết phiên", "Quên mật khẩu", "Khoá tài khoản"].map((title, n) => ({ title, ac: n ? "" : "AC7", src: n ? "" : "login.otp" }));`);
  expect(await page.evaluate(() => window.__api.get().acs)).toEqual(["AC1", "AC2.1", "AC9", "AC10"]); // kept by a save
  const rows = (await page.evaluate(() => window.UIFlow.check(window.__api.get()))).filter((i) => i.kind === "noflow");
  // AC-1 on a screen is AC1; AC-2 on a screen covers AC2.1; AC1 does not cover AC10
  expect(rows.map((r) => r.text)).toEqual(["2 AC của ticket chưa có trên màn, mũi tên hay bước chờ nào: AC9, AC10"]);
  await page.getByRole("button", { name: /Soát luồng/ }).click();
  await expect(page.locator(".uf-panel .uf-tag-noflow")).toHaveText("AC chưa lên sơ đồ");
  await page.getByRole("button", { name: "Chờ bổ sung (4)" }).click();
  await page.locator(".uf-panel").getByRole("button", { name: "Sao chép" }).click();
  await expect(page.locator(".uf-panel .uf-zmsg")).toHaveText("Đã sao chép");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe([
    "VA-1: các bước sau chưa có thiết kế trên Zeplin, nhờ bổ sung link màn:",
    "1. Lỗi mạng (sau nút “Gửi OTP” ở “Đăng nhập”) · AC7", "2. Hết phiên", "3. Quên mật khẩu", "4. Khoá tài khoản", // a lone fourth joins
  ].join("\n"));
});

test("a web flow is drawn in browser windows at the design's own width, and switches frame when a flow of the other device comes", async ({ page }) => {
  await open(page);
  // a 1440 × 900 page and a long one (1440 × 3600), both in a 1280-wide window; the fixture's other screens have no design
  await page.evaluate((pic) => {
    const f = structuredClone(window.SAMPLE);
    f.device = "web";
    f.screens[1].zeplin = "https://zpl.io/long1";
    window.__api.destroy();
    window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, f, { edit: true, lang: "vi", shots: {
      "https://zpl.io/abc123": { src: pic, w: 1440, h: 900, hits: [["Gửi OTP", 720, 450, 144, 45]] },
      "https://zpl.io/long1": { src: pic, w: 1440, h: 3600, hits: [] } } } as object);
  }, PIC);
  const root = page.locator(".uf-root");
  await expect(root).toHaveAttribute("data-device", "web");
  expect(await page.evaluate(() => window.__api.get().device)).toBe("web"); // kept: a save writes it back
  const size = (id: string) => page.locator(`.uf-screen[data-id="${id}"]`).evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight]);
  expect(await size("login")).toEqual([1280, 800]); // 900 × 1280 / 1440: the window is as high as its page
  expect(await size("code")).toEqual([1280, 3200]);
  expect(await size("home")).toEqual([1280, 800]); // no design: the plain window
  expect(await page.locator('.uf-screen[data-id="login"]').evaluate((el) => getComputedStyle(el).borderRadius)).toBe("12px"); // no phone corners
  // the button sits where the design has it, in window units (720 / 1440 × 1280)
  const hot = await page.locator('.uf-screen[data-id="login"] .uf-item[data-item="otp"]').evaluate((el) => [(el as HTMLElement).offsetLeft, (el as HTMLElement).offsetTop]);
  expect(hot).toEqual([640, 400]);
  // columns step by the window's width: nothing overlaps
  const at = await page.evaluate(() => window.__api.get().screens.filter((s) => s.kind === "screen").map((s) => [s.x, s.y]));
  const xs = [...new Set(at.map(([x]) => x as number))].sort((a, b) => a - b);
  expect(xs.length).toBeGreaterThan(1);
  for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(1500); // a window + the gap
  // Prototype: a window, not a phone; scaled to fit the stage
  await page.getByRole("button", { name: "Prototype" }).click();
  expect(await page.locator(".uf-phone").evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight])).toEqual([1280, 800]);
  await expect(page.locator(".uf-status")).toBeHidden();
  const shown = await box(page, ".uf-phone"), stage = await box(page, ".uf-stage");
  expect(shown.width).toBeLessThanOrEqual(stage.width);
  // the same mount gets a phone flow: every frame is a phone again
  await page.getByRole("button", { name: "Toàn cục" }).click();
  await page.evaluate(() => window.__api.set(structuredClone(window.SAMPLE)));
  await expect(root).toHaveAttribute("data-device", "mobile");
  expect(await size("home")).toEqual([390, 844]);
});
