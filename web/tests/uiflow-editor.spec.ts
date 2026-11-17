import { expect, test } from "@playwright/test";
import { type Flow, type Api, open, box, title, standalone, edit, addScreen, addScreensInPage, dirty, links, drag, centreOf, insp, flowOf, sized } from "./uiflow.helpers";

test("dragging an arrow head onto another screen retargets the link", async ({ page }) => {
  await open(page);
  await edit(page);
  await drag(page, '.uf-handle[data-link="login.otp>code"]', await centreOf(page, '.uf-screen[data-id="home"]'));
  expect((await links(page)).find((l) => l.src === "login.otp")!.to).toBe("home");
  expect(await dirty(page)).toBe(true);
  await expect(page.locator('.uf-handle[data-link="login.otp>home"]')).toHaveCount(1);
});

test("dropping the head on empty canvas keeps the old target", async ({ page }) => {
  await open(page);
  await edit(page);
  const view = await box(page, ".uf-view");
  await drag(page, '.uf-handle[data-link="login.otp>code"]', [view.x + 8, view.y + view.height - 8]);
  expect((await links(page)).find((l) => l.src === "login.otp")!.to).toBe("code");
  expect(await dirty(page)).toBe(false);
  await expect(page.locator('.uf-handle[data-link="login.otp>code"]')).toHaveCount(1);
});

test("dragging from a button's dot to a screen adds one link, twice adds none", async ({ page }) => {
  await open(page);
  await edit(page);
  const n = (await links(page)).length;
  await drag(page, '.uf-dot[data-src="home.out"]', await centreOf(page, '.uf-screen[data-id="login"]'));
  const added = (await links(page)).find((l) => l.src === "home.out");
  expect([added?.to, added?.act]).toEqual(["login", "navigate"]);
  expect((await links(page)).length).toBe(n + 1);
  await drag(page, '.uf-dot[data-src="home.out"]', await centreOf(page, '.uf-screen[data-id="login"]'));
  expect((await links(page)).length).toBe(n + 1); // the same link again: nothing added
  await drag(page, '.uf-dot[data-src="login.otp"]', await centreOf(page, '.uf-screen[data-id="err"]'));
  expect((await links(page)).find((l) => l.src === "login.otp" && l.to === "err")!.act).toBe("open"); // overlay
});

test("dragging a screen by its title bar moves it and its popup", async ({ page }) => {
  await open(page);
  await edit(page);
  const before = await page.evaluate(() => window.__api.get().screens.map((s) => [s.id, s.x, s.y]));
  const head = await box(page, '.uf-screen[data-id="code"] .uf-head');
  await page.evaluate(() => document.querySelectorAll(".uf-screen, path.uf-link")
    .forEach((n) => ((n as Element & { __k?: 1 }).__k = 1)));
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 20 + 120, head.y + head.height / 2 + 60, { steps: 6 });
  // mid-drag: the frame moved, but nothing was rebuilt — the same nodes, only transforms and path data changed
  expect(await page.evaluate(() => [...document.querySelectorAll(".uf-screen, path.uf-link")]
    .every((n) => (n as Element & { __k?: 1 }).__k === 1))).toBe(true);
  expect((await box(page, '.uf-screen[data-id="code"]')).x).toBeGreaterThan(head.x + 100);
  await page.mouse.up();
  const after = await page.evaluate(() => window.__api.get().screens.map((s) => [s.id, s.x, s.y]));
  const moved = Object.fromEntries(after.map(([id, x, y]) => [id, [x, y]]));
  const was = Object.fromEntries(before.map(([id, x, y]) => [id, [x, y]]));
  const k = await page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(
    (document.querySelector(".uf-layer") as HTMLElement).style.transform)![1]));
  expect((moved.code[0] as number) - (was.code[0] as number)).toBeCloseTo(120 / k, 0);
  expect((moved.err[1] as number) - (was.err[1] as number)).toBeCloseTo(60 / k, 0); // the popup follows its parent
  expect(moved.login).toEqual(was.login);
  expect(await dirty(page)).toBe(true);
});

test("rename by double click, delete a screen removes its links and children, undo restores", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="login"] .uf-title').dblclick();
  await page.keyboard.type("Màn đầu tiên");
  await page.keyboard.press("Enter");
  await expect(page.locator('.uf-screen[data-id="login"] .uf-title')).toHaveText("Màn đầu tiên");
  expect(await page.evaluate(() => window.__api.get().screens[0].title)).toBe("Màn đầu tiên");

  await page.locator('.uf-screen[data-id="code"] .uf-title').click();
  await expect(page.locator('.uf-screen[data-id="code"]')).toHaveClass(/uf-sel/);
  await page.keyboard.press("Delete");
  const f = await page.evaluate(() => window.__api.get());
  expect(f.screens.map((s) => s.id)).toEqual(["login", "home"]); // the popup "err" went with its parent
  expect(f.links.map((l) => l.src)).toEqual([]); // every link touched code or err
  await page.keyboard.press("ControlOrMeta+z");
  const back = await page.evaluate(() => window.__api.get());
  expect(back.screens.map((s) => s.id)).toEqual(["login", "code", "err", "home"]);
  expect(back.links.length).toBe(4);
  expect(back.screens[0].title).toBe("Màn đầu tiên"); // undo steps back one edit, not all of them
});

test("undo back to the opened state clears dirty", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').dblclick();
  await page.keyboard.type("Nhà");
  await page.keyboard.press("Enter");
  expect(await dirty(page)).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.__api.get().screens.find((s) => s.id === "home")!.title)).toBe("Trang chủ");
  expect(await dirty(page)).toBe(false);
});

test("the toolbar adds a screen; the panel changes a link's act and a screen's kind", async ({ page }) => {
  await open(page);
  await edit(page);
  await addScreen(page);
  const added = await page.evaluate(() => window.__api.get().screens.at(-1)!);
  expect([added.kind, added.items.length]).toEqual(["screen", 0]);
  await expect(page.locator(`.uf-screen[data-id="${added.id}"]`)).toHaveClass(/uf-sel/);
  await page.locator(".uf-insp").getByRole("button", { name: "+ Nút" }).click();
  expect(await page.evaluate(() => window.__api.get().screens.at(-1)!.items.length)).toBe(1);
  await page.locator(".uf-insp").getByRole("button", { name: "Popup" }).click();
  expect(await page.evaluate(() => window.__api.get().screens.at(-1)!.kind)).toBe("popup");
  // the fill slides to the picked segment (2nd of 4) and the frame eases into its new shape
  await expect(page.locator(".uf-insp .uf-pill")).toHaveAttribute("style", /translateX\(100%\)/);
  await expect(page.locator(`.uf-screen[data-id="${added.id}"]`)).toHaveClass(/uf-morph/);

  await page.locator('.uf-handle[data-link="login.otp>code"]').click();
  await page.locator(".uf-insp").getByRole("button", { name: "Quay lại", exact: true }).click();
  expect((await links(page)).find((l) => l.src === "login.otp")!.act).toBe("back");
  await page.locator(".uf-insp").getByLabel("AC").fill("AC-7");
  await page.locator(".uf-insp").getByLabel("AC").press("Enter");
  expect((await links(page)).find((l) => l.src === "login.otp")!.ac).toBe("AC-7");
  await page.locator('.uf-handle[data-link="login.otp>code"]').click();
  await page.keyboard.press("Backspace");
  expect((await links(page)).some((l) => l.src === "login.otp")).toBe(false);
});

test("edit controls are absent when edit is off", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "ro";
    host.style.cssText = "position:fixed;inset:0;background:#fff";
    document.body.append(host);
    window.UIFlow.mount(host, window.SAMPLE, { lang: "vi" });
  });
  const ro = page.locator("#ro");
  await expect(ro.getByRole("button", { name: "Sửa" })).toHaveCount(0);
  await expect(ro.getByRole("button", { name: "+ Từ Zeplin" })).toHaveCount(0);
  await expect(ro.locator(".uf-dot, .uf-handle, .uf-insp")).toHaveCount(0);
  await ro.locator('.uf-screen[data-id="login"] .uf-title').dblclick();
  await expect(ro.locator("[contenteditable]")).toHaveCount(0);
});

test("an exported file is view only: no editing, no save, no leave prompt", async ({ page }) => {
  await standalone(page);
  await expect(page.locator(".uf-screen")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Prototype" })).toBeVisible();
  await expect(page.locator(".uf-editbtn")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lưu file" })).toHaveCount(0);
  await page.locator('.uf-screen[data-id="home"] .uf-title').dblclick();
  await expect(page.locator(".uf-screen input, .uf-screen [contenteditable=true]")).toHaveCount(0);
  expect(await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  })).toBe(false);
});

test("a field never stores more than the backend keeps, and a bad Zeplin link is shown, not saved", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="code"] .uf-title').click();
  await expect(insp(page).getByLabel("AC")).toHaveCount(0); // a screen's panel: kind, Zeplin, note, its buttons
  await expect(insp(page).getByText("Vị trí")).toHaveCount(0);

  const zep = insp(page).getByLabel("Zeplin");
  await zep.fill("https://example.com/not-zeplin");
  await zep.press("Enter");
  expect((await flowOf(page)).screens.find((s) => s.id === "code")!.zeplin).toBe(""); // refused, not stored
  await expect(zep).toHaveAttribute("aria-invalid", "true");
  await expect(insp(page).locator(".uf-bad")).toBeVisible();
  await zep.fill("https://zpl.io/ok123");
  await zep.press("Enter");
  expect((await flowOf(page)).screens.find((s) => s.id === "code")!.zeplin).toBe("https://zpl.io/ok123");

  await page.locator('.uf-handle[data-link="login.otp>code"]').click();
  await insp(page).getByLabel("Điều kiện").fill("Đ".repeat(100));
  await insp(page).getByLabel("Điều kiện").press("Enter");
  expect((await flowOf(page)).links.find((l) => l.src === "login.otp")!.when).toHaveLength(80);
  await insp(page).getByLabel("AC").fill("A".repeat(60));
  await insp(page).getByLabel("AC").press("Enter");
  expect((await flowOf(page)).links.find((l) => l.src === "login.otp")!.ac).toHaveLength(40);
});

test("the editor refuses to pass the file's limits: 200 screens, 40 buttons, 1000 links", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.evaluate((f) => window.__api.set(f), sized(199, 1));
  await addScreen(page);
  expect((await flowOf(page)).screens).toHaveLength(200);
  await addScreen(page); // one more: refused, and the form says why
  await expect(page.locator(".uf-zmsg")).toHaveText("Tối đa 200 màn");
  expect((await flowOf(page)).screens).toHaveLength(200);

  await page.locator(".uf-zform").getByRole("button", { name: "Đóng" }).click(); // the popover sits over the map's corner
  await page.evaluate((f) => window.__api.set(f), sized(2, 40));
  await page.locator('.uf-screen[data-id="s0"] .uf-title').click();
  const addItem = insp(page).getByRole("button", { name: "+ Nút" });
  await expect(addItem).toBeDisabled();
  await expect(addItem).toHaveAttribute("title", "Tối đa 40 nút mỗi màn");

  await page.evaluate((f) => window.__api.set(f), sized(3, 1, 1000));
  await drag(page, '.uf-dot[data-src="s2.i0"]', await centreOf(page, '.uf-screen[data-id="s1"]'));
  expect((await flowOf(page)).links).toHaveLength(1000);
  await expect(page.locator(".uf-note")).toHaveText("Tối đa 1000 liên kết");
  await expect(page.locator(".uf-note")).toBeHidden({ timeout: 4000 });
});

test("a snapped-back arrow keeps its selection; a self link is refused", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-handle[data-link="login.otp>code"]').click();
  await expect(page.locator("path.uf-link.uf-sel")).toHaveCount(1);
  const view = await box(page, ".uf-view");
  await drag(page, '.uf-handle[data-link="login.otp>code"]', [view.x + 8, view.y + view.height - 8]);
  await expect(page.locator("path.uf-link.uf-sel")).toHaveCount(1); // the ring follows the redrawn arrow
  await expect(insp(page).locator(".uf-itag")).toHaveText("Mũi tên");

  const n = (await flowOf(page)).links.length;
  await drag(page, '.uf-dot[data-src="login"]', await centreOf(page, '.uf-screen[data-id="login"]'));
  expect((await flowOf(page)).links).toHaveLength(n);
});

test("turning an overlay into a screen clears its parent", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="err"] .uf-title').click();
  await insp(page).getByRole("button", { name: "Màn", exact: true }).click();
  const err = (await flowOf(page)).screens.find((s) => s.id === "err")!;
  expect([err.kind, err.parent]).toEqual(["screen", null]);
});

test("undo is ignored while a drag is in flight", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="login"] .uf-title').dblclick();
  await page.keyboard.type("Màn đầu");
  await page.keyboard.press("Enter");
  const head = await box(page, '.uf-screen[data-id="code"] .uf-head');
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 120, head.y + head.height / 2 + 40, { steps: 5 });
  await page.keyboard.press("ControlOrMeta+z"); // mid-gesture: must not re-render under the pointer
  expect((await flowOf(page)).screens[0].title).toBe("Màn đầu");
  await page.mouse.up();
  const f = await flowOf(page);
  expect(f.screens[0].title).toBe("Màn đầu");
  expect(f.screens.find((s) => s.id === "code")!.x).toBeGreaterThan(610); // the move still landed
  await page.keyboard.press("ControlOrMeta+z"); // and undo works again once the pointer is up
  expect((await flowOf(page)).screens.find((s) => s.id === "code")!.x).toBe(610);
});

test("undo remembers 50 steps, no more", async ({ page }) => {
  await open(page);
  await edit(page);
  const adds = await addScreensInPage(page, 51);
  expect(adds).toBe(55); // 4 + 51, under the 60 cap
  await page.evaluate(() => { for (let i = 0; i < 60; i++) window.__api.undo(); });
  expect((await flowOf(page)).screens).toHaveLength(5); // 50 steps back, the 51st is gone for good
  expect(await dirty(page)).toBe(true);
});

test("destroy() of an exported file empties its host", async ({ page }) => {
  await standalone(page);
  await page.evaluate(() => (document.getElementById("uiflow") as HTMLElement & { uiflow: Api }).uiflow.destroy());
  await expect(page.locator(".uf-root")).toHaveCount(0);
  expect(await page.evaluate(() => (document.getElementById("uiflow") as HTMLElement & { uiflow: Api | null }).uiflow))
    .toBe(null);
});

test("a flow change during a drag is refused, and the drag still finishes", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').click(); // something is selected: Delete has a target
  const head = await box(page, '.uf-screen[data-id="code"] .uf-head');
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 120, head.y + head.height / 2 + 40, { steps: 5 });
  await page.keyboard.press("Delete"); // would rebuild the frames the drag is holding
  await expect(page.locator(".uf-note")).toHaveText("Thả chuột xong rồi hãy sửa");
  await addScreensInPage(page, 1);
  await expect(page.locator(".uf-zmsg")).toHaveText("Thả chuột xong rồi hãy sửa"); // the form says why and stays open
  expect((await flowOf(page)).screens).toHaveLength(4);
  await expect(page.locator('.uf-screen[data-id="home"]')).toHaveClass(/uf-sel/); // a refusal keeps the selection
  await page.mouse.up();
  await page.locator(".uf-zform").getByRole("button", { name: "Đóng" }).click();
  const f = await flowOf(page);
  expect(f.screens).toHaveLength(4);
  expect(f.screens.find((s) => s.id === "code")!.x).toBeGreaterThan(610); // the move landed

  const next = await box(page, '.uf-screen[data-id="login"] .uf-head'); // the gesture really ended
  await page.mouse.move(next.x + 20, next.y + next.height / 2);
  await page.mouse.down();
  await page.mouse.move(next.x + 120, next.y + next.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await flowOf(page)).screens.find((s) => s.id === "login")!.x).toBeGreaterThan(0);
  await page.locator('.uf-screen[data-id="home"] .uf-title').click();
  await page.keyboard.press("Delete"); // and editing works again
  expect((await flowOf(page)).screens).toHaveLength(3);
});

test("values the backend model would reject are clamped on the way in", async ({ page }) => {
  await open(page);
  const f = await page.evaluate(() => {
    const g = structuredClone(window.SAMPLE) as Omit<Flow, "v"> & { v: unknown };
    g.v = "9";
    g.device = "tablet"; // not a frame the model knows ("web" is one now)
    g.rev = 1.5;
    g.screens[0].title = "";
    window.__api.set(g as unknown as Flow);
    return window.__api.get();
  });
  expect([f.v, f.device, f.rev]).toEqual([2, "mobile", 1]);
  expect(f.screens[0].title).toBe("login"); // an empty title would fail the model's min_length
});

test("a too long Zeplin link is wrong, not silently cut, and clears what was stored", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="login"] .uf-title').click();
  await expect(insp(page).getByLabel("Zeplin")).toHaveValue("https://zpl.io/abc123");
  const long = "https://zpl.io/" + "a".repeat(400); // matches the pattern, but far over the field's cap
  await insp(page).getByLabel("Zeplin").fill(long);
  await insp(page).getByLabel("Zeplin").press("Enter");
  expect((await flowOf(page)).screens[0].zeplin).toBe(""); // not a cut-down link that still looks valid
  await expect(insp(page).getByLabel("Zeplin")).toHaveValue(long); // shown and stored agree: nothing is kept
  await expect(insp(page).getByLabel("Zeplin")).toHaveAttribute("aria-invalid", "true");
  await expect(insp(page).locator(".uf-bad")).toBeVisible();
  await page.evaluate(() => window.__api.undo()); // undo brings the old link back: the box must show it
  expect((await flowOf(page)).screens[0].zeplin).toBe("https://zpl.io/abc123");
  await expect(insp(page).getByLabel("Zeplin")).toHaveValue("https://zpl.io/abc123");
  await expect(insp(page).locator(".uf-bad")).toBeHidden();
  await insp(page).getByLabel("Zeplin").fill("https://zpl.io/ok");
  await insp(page).getByLabel("Zeplin").press("Enter");
  expect((await flowOf(page)).screens[0].zeplin).toBe("https://zpl.io/ok");
  await expect(insp(page).locator(".uf-bad")).toBeHidden();
});

test("an edit still in the box is kept when the next gesture starts", async ({ page }) => {
  await open(page);
  await edit(page);
  // a rename that was never confirmed with Enter: clicking another screen's handle must keep it
  await page.locator('.uf-screen[data-id="login"] .uf-title').dblclick();
  await page.keyboard.type("Màn mở đầu");
  const head = await box(page, '.uf-screen[data-id="home"] .uf-head');
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 140, head.y + head.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  const f = await flowOf(page);
  expect(f.screens[0].title).toBe("Màn mở đầu");
  expect(f.screens.find((s) => s.id === "home")!.x).toBeGreaterThan(1280); // and the drag still happened

  // the same for a panel field left unconfirmed
  await page.locator('.uf-screen[data-id="code"] .uf-title').click();
  await insp(page).getByLabel("Zeplin").fill("https://zpl.io/kept99");
  const dot = await box(page, '.uf-dot[data-src="home.out"]');
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(dot.x + 60, dot.y + 60, { steps: 4 });
  await page.mouse.up();
  expect((await flowOf(page)).screens.find((s) => s.id === "code")!.zeplin).toBe("https://zpl.io/kept99");
});

test("switching to Prototype mid-drag ends the gesture instead of stranding it", async ({ page }) => {
  await open(page);
  await edit(page);
  const head = await box(page, '.uf-screen[data-id="code"] .uf-head');
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 120, head.y + head.height / 2, { steps: 5 });
  await page.evaluate(() => window.__api.mode("play")); // the app may switch modes under the pointer
  await page.mouse.up();
  await expect(title(page)).toHaveText("Đăng nhập"); // the prototype runs
  await page.getByRole("button", { name: "Toàn cục" }).click();
  // the map still takes edits: the gesture did not survive the mode switch
  await page.locator('.uf-screen[data-id="home"] .uf-title').click();
  await page.keyboard.press("Delete");
  expect((await flowOf(page)).screens.map((s) => s.id)).toEqual(["login", "code", "err"]);
});

test("deleting the last screen is refused with a note", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const f = structuredClone(window.SAMPLE);
    f.screens = f.screens.filter((s) => s.id === "login").map((s) => ({ ...s, parent: null }));
    f.links = [];
    window.__api.set(f);
  });
  await edit(page);
  await page.locator('.uf-screen[data-id="login"] .uf-title').click();
  await page.locator(".uf-insp").getByRole("button", { name: "Xoá" }).click();
  await expect(page.locator(".uf-note")).toHaveText("Sơ đồ cần ít nhất một màn");
  expect(await page.evaluate(() => window.__api.get().screens.length)).toBe(1);
  expect(await dirty(page)).toBe(false);
});

test("selecting in edit mode dims the map around what is selected; Esc clears it", async ({ page }) => {
  await open(page);
  await edit(page);
  const b = await box(page, '.uf-screen[data-id="home"] .uf-head');
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator(".uf-root")).toHaveClass(/uf-focus/);
  await expect(page.locator('.uf-screen[data-id="home"]')).toHaveClass(/uf-on/);
  expect(await page.locator(".uf-link.uf-on").count()).toBeGreaterThan(0);
  expect(await page.locator(".uf-link:not(.uf-on)").count()).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".uf-root")).not.toHaveClass(/uf-focus/);
});

test("a button picked from its screen's panel is highlighted, lights only its own arrows, and has a way back", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="code"] .uf-title').click();
  await expect(insp(page).locator("h2")).toHaveText("Nhập OTP");
  await insp(page).getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(insp(page).locator("h2")).toHaveText("Xác nhận");
  const item = page.locator('.uf-screen[data-id="code"] .uf-item.uf-sel');
  await expect(item).toHaveCount(1);
  expect(await item.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("2px");
  const lit = await page.evaluate(() => [...document.querySelectorAll(".uf-link.uf-on")].map((p) => window.__api.get().links[Number((p as SVGElement).dataset.i)].src));
  expect(lit.length).toBeGreaterThan(0);
  expect(new Set(lit).size).toBe(1); // only this button's arrows
  await insp(page).getByRole("button", { name: "Về màn “Nhập OTP”" }).click();
  await expect(insp(page).locator("h2")).toHaveText("Nhập OTP");
  await expect(page.locator('.uf-screen[data-id="code"]')).toHaveClass(/uf-sel/);
});

test("a new arrow back to the screen that opened this one is a Quay lại; from a popup to its parent, Đóng", async ({ page }) => {
  await open(page);
  await edit(page);
  // code.later goes forward to home: an arrow from home to code goes back
  await drag(page, '.uf-dot[data-src="home.out"]', await centreOf(page, '.uf-screen[data-id="code"] .uf-title')); // its popup sits mid-frame
  expect((await links(page)).find((l) => l.src === "home.out" && l.to === "code")!.act).toBe("back");
  // nothing leads from home to login: forward
  await drag(page, '.uf-dot[data-src="home"]', await centreOf(page, '.uf-screen[data-id="login"]'));
  expect((await links(page)).find((l) => l.src === "home" && l.to === "login")!.act).toBe("navigate");
  // the popup "Sai mã" over "Nhập OTP": closing it
  await drag(page, '.uf-dot[data-src="err"]', await centreOf(page, '.uf-screen[data-id="code"] .uf-title'));
  expect((await links(page)).find((l) => l.src === "err" && l.to === "code")!.act).toBe("close");
});

test("the panel header's icons say what they do on hover, without the slow title tooltip", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="login"] .uf-title').click();
  const x = page.locator(".uf-insp").getByRole("button", { name: "Bỏ chọn (Esc)" });
  await expect(x).not.toHaveAttribute("title", /.*/);
  await x.hover();
  await expect.poll(() => x.evaluate((b) => getComputedStyle(b, "::after").opacity)).toBe("1");
  expect(await x.evaluate((b) => getComputedStyle(b, "::after").content)).toBe('"Bỏ chọn (Esc)"');
});

test("a screen turned into a popup takes its arrows along: in Đi tới → Mở, out Quay lại → Đóng, and back again", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { const f = window.__api.get(); f.links.push({ src: "home", to: "code", act: "back", when: "", ac: "AC-9" }); window.__api.set(f); });
  await edit(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').click();
  const acts = () => page.evaluate(() => window.__api.get().links.filter((l) => l.to === "home" || l.src.split(".")[0] === "home").map((l) => `${l.src}>${l.to}:${l.act}:${l.ac}`));
  await page.locator(".uf-insp").getByRole("button", { name: "Popup", exact: true }).click();
  expect(await acts()).toEqual(["code.later>home:open:AC-3", "home>code:close:AC-9"]);
  expect(await page.evaluate(() => window.__api.get().screens.find((s) => s.id === "home")!.parent)).toBe("code"); // the screen that opens it
  await page.locator(".uf-insp").getByRole("button", { name: "Sheet", exact: true }).click(); // overlay to overlay: no change
  expect(await acts()).toEqual(["code.later>home:open:AC-3", "home>code:close:AC-9"]);
  await page.locator(".uf-insp").getByRole("button", { name: "Màn", exact: true }).click();
  expect(await acts()).toEqual(["code.later>home:navigate:AC-3", "home>code:back:AC-9"]);
  expect(await page.evaluate(() => window.__api.get().screens.find((s) => s.id === "home")!.parent)).toBeNull();
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__api.undo());
  expect(await acts()).toEqual(["code.later>home:navigate:AC-3", "home>code:back:AC-9"]);
});

test("every screen picked to edit is zoomed onto, the first and every one after; on its title the move waits out a double click", async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 1000 }); // wide: the next screen is whole and readable beside it
  await open(page);
  await edit(page);
  const cam = () => page.locator(".uf-layer").evaluate((l) => { const m = new DOMMatrix(getComputedStyle(l).transform); return [m.a, m.e, m.f]; });
  let last = [0, 0, 0]; // the zoom animates: wait until it rests
  const rest = () => expect.poll(async () => { const now = await cam(), still = now.join() === last.join(); last = now; return still; }).toBe(true);
  const off = async (id: string) => {
    const [c, v] = [await box(page, `.uf-screen[data-id="${id}"] .uf-card`), await box(page, ".uf-view")];
    return Math.abs(c.x + c.width / 2 - (v.x + v.width / 2));
  };
  const centred = (id: string) => expect.poll(() => off(id)).toBeLessThan(4);
  for (const id of ["code", "home", "code"]) { // the next one too, readable already: the camera still comes to it
    const [c, v] = [await box(page, `.uf-screen[data-id="${id}"] .uf-card`), await box(page, ".uf-view")];
    const x0 = Math.max(c.x, v.x), x1 = Math.min(c.x + c.width, v.x + v.width); // its part in the view
    if (id === "home") expect([c.x >= v.x, c.x + c.width <= v.x + v.width, last[0] >= 0.6]).toEqual([true, true, true]);
    await page.mouse.click((x0 + x1) / 2, c.y + c.height * 0.38); // the body, under its buttons, above popup and panel
    await expect(page.locator(`.uf-screen[data-id="${id}"]`)).toHaveClass(/uf-sel/);
    await rest();
    expect(last[0]).toBeGreaterThanOrEqual(0.6);
    await centred(id);
  }
  const t = await box(page, '.uf-screen[data-id="home"] .uf-title'), v = await box(page, ".uf-view");
  const was = await cam();
  await page.mouse.click(Math.min(t.x + t.width - 8, v.x + v.width - 8), t.y + t.height / 2); // its title's part in view
  expect(await cam()).toEqual(was); // not yet: a second click may follow to rename it
  await centred("home");
});

test("the flow's own name: one edit, one undo step; blank drops it; a file's name is read back clean", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__api.title("  Luồng\n đăng nhập  "));
  expect(await page.evaluate(() => [window.__api.get().title, window.__dirty])).toEqual(["Luồng đăng nhập", true]);
  await page.evaluate(() => window.__api.title(""));
  expect(await page.evaluate(() => "title" in window.__api.get())).toBe(false);
  await page.evaluate(() => window.__api.undo());
  expect(await page.evaluate(() => window.__api.get().title)).toBe("Luồng đăng nhập");
  await page.evaluate(() => window.__api.set({ ...window.SAMPLE, title: "x".repeat(300) }));
  expect(await page.evaluate(() => window.__api.get().title!.length)).toBe(120);
});
