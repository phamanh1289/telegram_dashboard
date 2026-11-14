import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { type Flow, type Api, SCHEMA, open, box, title, standalone, edit, dirty, links, drag, centreOf, insp, flowOf, sized } from "./uiflow.helpers";

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
  await page.getByRole("button", { name: "+ Màn" }).click();
  const added = await page.evaluate(() => window.__api.get().screens.at(-1)!);
  expect([added.kind, added.items.length]).toEqual(["screen", 0]);
  await expect(page.locator(`.uf-screen[data-id="${added.id}"]`)).toHaveClass(/uf-sel/);
  await page.locator(".uf-insp").getByRole("button", { name: "+ Nút" }).click();
  expect(await page.evaluate(() => window.__api.get().screens.at(-1)!.items.length)).toBe(1);
  await page.locator(".uf-insp").getByRole("button", { name: "Popup" }).click();
  expect(await page.evaluate(() => window.__api.get().screens.at(-1)!.kind)).toBe("popup");

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
  await expect(ro.getByRole("button", { name: "+ Màn" })).toHaveCount(0);
  await expect(ro.locator(".uf-dot, .uf-handle, .uf-insp")).toHaveCount(0);
  await ro.locator('.uf-screen[data-id="login"] .uf-title').dblclick();
  await expect(ro.locator("[contenteditable]")).toHaveCount(0);
});

test("editing in Map leaves the hash and the prototype alone", async ({ page }) => {
  await standalone(page, "#s=code");
  await edit(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').dblclick();
  await page.keyboard.type("Nhà");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__api?.get === undefined)).toBe(true); // standalone: no test api
  await expect(page).toHaveURL(/#s=code$/);
  await expect(page.locator(".uf-pscreen")).toHaveCount(0); // the player did not render
  await page.getByRole("button", { name: "Prototype" }).click();
  await expect(title(page)).toHaveText("Nhập OTP");
});

test("saved file reopens with the edit and still has exactly one data block", async ({ page }) => {
  await standalone(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="login"] .uf-title').dblclick();
  await page.keyboard.type("Màn đăng nhập mới");
  await page.keyboard.press("Enter");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Lưu file" }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe("uiflow-VA-1.html");
  const html = fs.readFileSync((await dl.path())!, "utf8");
  expect(html.split('id="uiflow-data"').length - 1).toBe(1);
  const data = /id="uiflow-data">([\s\S]*?)<\/script>/.exec(html)![1];
  expect(data).not.toContain("<"); // "<" is escaped, so the JSON cannot close its own block
  expect(JSON.parse(data).screens[0].title).toBe("Màn đăng nhập mới");
  await page.setContent(html);
  await expect(page.locator('.uf-screen[data-id="login"] .uf-title')).toHaveText("Màn đăng nhập mới");
  await expect(page.locator(".uf-screen")).toHaveCount(4);
});

test("Lưu file writes only Flow-schema fields, dropping what a hand-edited file added", async ({ page }) => {
  await standalone(page, "", `
    f.note = "thêm tay";
    f.screens[0].img = "data:image/png;base64,xx";
    f.screens[0].items[0].rect = [1, 2, 3, 4];
    f.links[0].note = "thêm tay";`);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Lưu file" }).click(),
  ]);
  const html = fs.readFileSync((await dl.path())!, "utf8");
  const saved = JSON.parse(/id="uiflow-data">([\s\S]*?)<\/script>/.exec(html)![1]) as Flow;
  const keys = [Object.keys(saved), ...saved.screens.map(Object.keys),
    ...saved.screens.flatMap((s) => s.items.map(Object.keys)), ...saved.links.map(Object.keys)].flat();
  expect([...new Set(keys.filter((k) => !SCHEMA.has(k)))]).toEqual([]);
  expect(html).not.toContain("thêm tay"); // the extras are gone from the file, not just from api.get()
});

test("an exported file asks before leaving with unsaved edits; the dashboard mount does not", async ({ page }) => {
  const ask = () => page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  await standalone(page);
  expect(await ask()).toBe(false); // nothing changed yet
  await edit(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').dblclick();
  await page.keyboard.type("Nhà");
  await page.keyboard.press("Enter");
  expect(await ask()).toBe(true);

  await open(page); // the same edit inside the dashboard: the app owns leaving, not the engine
  await edit(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').dblclick();
  await page.keyboard.type("Nhà");
  await page.keyboard.press("Enter");
  expect(await dirty(page)).toBe(true);
  expect(await ask()).toBe(false);
});

test("a field never stores more than the backend keeps, and a bad Zeplin link is shown, not saved", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="code"] .uf-title').click();
  await insp(page).getByLabel("AC").fill("A".repeat(60));
  await insp(page).getByLabel("AC").press("Enter");
  expect((await flowOf(page)).screens.find((s) => s.id === "code")!.ac).toHaveLength(40);

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
});

test("the editor refuses to pass the file's limits: 60 screens, 20 buttons, 300 links", async ({ page }) => {
  await open(page);
  await edit(page);
  const add = page.getByRole("button", { name: "+ Màn" });
  await page.evaluate((f) => window.__api.set(f), sized(59, 1));
  await expect(add).toBeEnabled();
  await add.click();
  expect((await flowOf(page)).screens).toHaveLength(60);
  await expect(add).toBeDisabled();
  await expect(add).toHaveAttribute("title", "Tối đa 60 màn");

  await page.evaluate((f) => window.__api.set(f), sized(2, 20));
  await page.locator('.uf-screen[data-id="s0"] .uf-title').click();
  const addItem = insp(page).getByRole("button", { name: "+ Nút" });
  await expect(addItem).toBeDisabled();
  await expect(addItem).toHaveAttribute("title", "Tối đa 20 nút mỗi màn");

  await page.evaluate((f) => window.__api.set(f), sized(3, 1, 300));
  await drag(page, '.uf-dot[data-src="s2.i0"]', await centreOf(page, '.uf-screen[data-id="s1"]'));
  expect((await flowOf(page)).links).toHaveLength(300);
  await expect(page.locator(".uf-note")).toHaveText("Tối đa 300 liên kết");
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
  await expect(insp(page).locator("h2")).toContainText("Mũi tên");

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
  const adds = await page.evaluate(() => {
    for (let i = 0; i < 51; i++) document.querySelector<HTMLButtonElement>(".uf-add")!.click();
    return window.__api.get().screens.length;
  });
  expect(adds).toBe(55); // 4 + 51, under the 60 cap
  await page.evaluate(() => { for (let i = 0; i < 60; i++) window.__api.undo(); });
  expect((await flowOf(page)).screens).toHaveLength(5); // 50 steps back, the 51st is gone for good
  expect(await dirty(page)).toBe(true);
});

test("destroy() takes the leave-page guard with it", async ({ page }) => {
  const ask = () => page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  await standalone(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').dblclick();
  await page.keyboard.type("Nhà");
  await page.keyboard.press("Enter");
  expect(await ask()).toBe(true);
  await page.evaluate(() => (document.getElementById("uiflow") as HTMLElement & { uiflow: Api }).uiflow.destroy());
  expect(await ask()).toBe(false);
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
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".uf-add")!.click());
  expect((await flowOf(page)).screens).toHaveLength(4);
  await expect(page.locator('.uf-screen[data-id="home"]')).toHaveClass(/uf-sel/); // a refusal keeps the selection
  await page.mouse.up();
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
    g.device = "web";
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
  await insp(page).getByLabel("AC").fill("AC-99");
  const dot = await box(page, '.uf-dot[data-src="home.out"]');
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(dot.x + 60, dot.y + 60, { steps: 4 });
  await page.mouse.up();
  expect((await flowOf(page)).screens.find((s) => s.id === "code")!.ac).toBe("AC-99");
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

test("an edit clears the dropped-data rows of the loaded file", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const f = structuredClone(window.SAMPLE);
    f.screens.push({ ...f.screens[0] }); // duplicate id "login"
    window.__api.set(f);
  });
  await page.getByRole("button", { name: /Soát luồng/ }).click();
  const dup = page.locator(".uf-issue", { hasText: "Bỏ màn trùng id “login”" });
  await expect(dup).toHaveCount(1);
  await edit(page);
  await page.getByRole("button", { name: "+ Màn" }).click();
  await expect(dup).toHaveCount(0);
});
