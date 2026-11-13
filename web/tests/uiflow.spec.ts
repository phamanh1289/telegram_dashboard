import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The UI flow engine (web/public/uiflow.js) on a static fixture page, opened via file:// like an exported file.
type Item = { id: string; label: string };
type Screen = { id: string; title: string; kind: string; parent: string | null; x?: number | null; y?: number | null;
  zeplin: string; ac: string; items: Item[] };
type Link = { src: string; to: string; act: string; when: string; ac: string };
type Flow = { v: 1; ticket: string; rev: number; device: string; screens: Screen[]; links: Link[] };
type Issue = { kind: string; screen?: string; item?: string; text: string };
type Api = { get(): Flow; set(f: Flow): void; goto(id: string): void; undo(): void; destroy(): void;
  mode(m: "map" | "play"): void };
const SCHEMA = new Set(["v", "ticket", "rev", "device", "screens", "links", "id", "title", "kind", "parent", "x", "y",
  "zeplin", "ac", "items", "label", "src", "to", "act", "when"]);
declare global {
  interface Window {
    UIFlow: { layout(f: Flow): Flow; check(f: Flow): Issue[]; mount(el: Element, f: Flow, o: object): Api };
    SAMPLE: Flow;
    __api: Api;
    __dirty: boolean;
    __live: Set<number>;
  }
}

const FIXTURE = pathToFileURL(path.join(__dirname, "uiflow-fixture.html")).href;
const open = (page: Page, hash = "") => page.goto(FIXTURE + hash);
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const centre = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2];
/** Distance between the centre of a screen frame and the centre of the canvas view. */
const offCentre = async (page: Page, id: string) => {
  const [sx, sy] = centre(await box(page, `.uf-screen[data-id="${id}"]`));
  const [vx, vy] = centre(await box(page, ".uf-view"));
  return Math.max(Math.abs(sx - vx), Math.abs(sy - vy));
};
const layerTransform = (page: Page) => page.locator(".uf-layer").evaluate((l) => (l as HTMLElement).style.transform);

/** n screens in a chain with long Vietnamese / emoji labels, plus `extra` links so the map gets dense. */
function bigFlow(n: number, extra = 0): Flow {
  const long = "Xác nhận thanh toán đơn hàng ưu đãi đặc biệt 🎉🚀 cho khách hàng thân thiết Việt Nam";
  const screens: Screen[] = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, title: `${i} · Màn hình rất dài tiếng Việt có dấu ✨ ${long}`, kind: "screen", parent: null,
    zeplin: "", ac: `AC-${i} rất dài để thử cắt chữ`, items: Array.from({ length: 5 }, (_, j) => ({ id: `i${j}`, label: `${j} ${long}` })),
  }));
  const links: Link[] = screens.slice(1).map((s, i) => ({ src: `s${i}.i0`, to: s.id, act: "navigate", when: long, ac: "AC-1" }));
  for (let k = 0; links.length < n - 1 + extra; k++)
    links.push({ src: `s${k % n}.i${1 + (k % 4)}`, to: `s${(k * 7 + 3) % n}`, act: k % 3 ? "navigate" : "back", when: "", ac: "" });
  return { v: 1, ticket: "VA-2", rev: 0, device: "mobile", screens, links };
}

test("layout puts screens in columns by depth and popups beside their parent", async ({ page }) => {
  await open(page);
  const f = await page.evaluate(() => window.UIFlow.layout(window.SAMPLE));
  const by = Object.fromEntries(f.screens.map((s) => [s.id, s]));
  expect(by.code.x! - by.login.x!).toBe(610);
  expect(by.home.x! - by.code.x!).toBe(670); // code's column grows by the 60 its popup sticks out
  expect([by.err.x! - by.code.x!, by.err.y! - by.code.y!]).toEqual([60, 60]);
  expect(await page.evaluate(() => window.SAMPLE.screens[0].x ?? null)).toBeNull(); // not modified in place
});

test("check reports orphan, dead button, missing back and missing AC; a row goes to its screen", async ({ page }) => {
  await open(page);
  const rows = await page.evaluate(() => {
    const f = structuredClone(window.SAMPLE);
    f.screens.push({ id: "lost", title: "Màn lạc", kind: "screen", parent: null, zeplin: "", ac: "AC-9", items: [] });
    return window.UIFlow.check(f);
  });
  expect(rows.map((r) => r.kind).sort()).toEqual(["dead", "noac", "noback", "orphan"]);
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  expect(by.orphan.screen).toBe("lost");
  expect([by.dead.screen, by.dead.item]).toEqual(["home", "out"]);
  expect(by.noback.screen).toBe("home");
  expect(by.noac.screen).toBe("code");
  expect(rows.every((r) => r.text.length > 0)).toBe(true);

  await page.getByRole("button", { name: "Soát luồng (3)" }).click();
  await page.locator(".uf-issue", { hasText: "Đăng xuất" }).click();
  await expect(page.locator('.uf-screen[data-id="home"]')).toHaveClass(/uf-on/);
  await expect(page.locator('.uf-screen[data-id="login"]')).not.toHaveClass(/uf-on/);
  await expect.poll(async () => {
    const [sx, sy] = centre(await box(page, '.uf-screen[data-id="home"]'));
    const [vx, vy] = centre(await box(page, ".uf-view"));
    return Math.max(Math.abs(sx - vx), Math.abs(sy - vy));
  }).toBeLessThan(2);
});

test("map draws one frame per screen and one arrow per link, back dashed", async ({ page }) => {
  await open(page);
  await expect(page.locator(".uf-screen")).toHaveCount(4);
  await expect(page.locator("path.uf-link")).toHaveCount(4);
  await expect(page.locator("path.uf-link.uf-back")).toHaveCount(1);
  await expect(page.locator(".uf-screen.uf-ov")).toHaveCount(1); // the popup
  await expect(page.locator(".uf-label", { hasText: "Mã sai · AC-2" })).toHaveCount(1);
  await expect(page.locator('.uf-screen[data-id="login"] a.uf-zeplin')).toHaveAttribute("href", "https://zpl.io/abc123");
  await expect(page.locator('.uf-screen[data-id="login"] .uf-ac')).toHaveText("AC-1");
});

test("labels are text, never markup", async ({ page }) => {
  await open(page);
  const bad = '<img src=x onerror="window.__xss=1">';
  await page.evaluate((bad) => {
    const f = structuredClone(window.SAMPLE);
    f.screens[0].title = bad;
    f.screens[0].ac = bad;
    f.screens[0].items[0].label = bad;
    f.screens[0].zeplin = "javascript:window.__xss=1";
    f.links[0].when = bad;
    window.__api.set(f);
  }, bad);
  await expect(page.locator('.uf-screen[data-id="login"] .uf-title')).toHaveText(bad);
  await expect(page.locator(".uf-root img")).toHaveCount(0);
  await expect(page.locator('.uf-screen[data-id="login"] a.uf-zeplin')).not.toHaveAttribute("href", /.*/);
  expect(await page.evaluate(() => "__xss" in window)).toBe(false);
});

test("40 screens with long Vietnamese / emoji labels: no horizontal page scroll at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.evaluate((f) => window.__api.set(f), bigFlow(40));
  await expect(page.locator(".uf-screen")).toHaveCount(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // too wide to fit even at the minimum zoom: the map starts at the first screen instead of its middle
  const [first, view] = [await box(page, '.uf-screen[data-id="s0"]'), await box(page, ".uf-view")];
  expect(first.x).toBeGreaterThanOrEqual(view.x);
  expect(first.x + first.width).toBeLessThanOrEqual(view.x + view.width);
  for (const b of await page.locator(".uf-bar button:visible").all()) {
    const r = (await b.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(390);
  }
  // titles, items and AC chips stay on one line and are cut, not wrapped
  const cut = await page.evaluate(() => [".uf-title", ".uf-item", ".uf-ac"].map((sel) => {
    const el = document.querySelector<HTMLElement>(`.uf-screen ${sel}`)!;
    return [getComputedStyle(el).textOverflow, getComputedStyle(el).whiteSpace, el.scrollWidth > el.clientWidth];
  }));
  expect(cut).toEqual([["ellipsis", "nowrap", true], ["ellipsis", "nowrap", true], ["ellipsis", "nowrap", true]]);
});

test("hash #s=code opens centred on that screen", async ({ page }) => {
  await open(page, "#s=code");
  const [sx, sy] = centre(await box(page, '.uf-screen[data-id="code"]'));
  const [vx, vy] = centre(await box(page, ".uf-view"));
  expect(Math.abs(sx - vx)).toBeLessThan(2);
  expect(Math.abs(sy - vy)).toBeLessThan(2);
});

test("clicking a screen dims the unrelated ones, clicking the canvas clears it", async ({ page }) => {
  await open(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').click();
  await expect(page.locator(".uf-root")).toHaveClass(/uf-focus/);
  await expect(page.locator(".uf-screen.uf-on")).toHaveCount(2); // home + code (code.later -> home)
  await expect(page.locator("path.uf-link.uf-on")).toHaveCount(1);
  const login = await box(page, '.uf-screen[data-id="login"]');
  const code = await box(page, '.uf-screen[data-id="code"]');
  await page.mouse.click((login.x + login.width + code.x) / 2, login.y + 20); // the gap between two columns
  await expect(page.locator(".uf-root")).not.toHaveClass(/uf-focus/);
});

test("60 screens / 300 links: drag pans and ctrl + wheel zooms around the cursor without redrawing", async ({ page }) => {
  await open(page);
  const t0 = await page.evaluate((f) => { const t = performance.now(); window.__api.set(f); return performance.now() - t; },
    bigFlow(60, 241));
  await expect(page.locator("path.uf-link")).toHaveCount(300);
  expect(t0).toBeLessThan(500);
  await page.evaluate(() => document.querySelectorAll("path.uf-link, .uf-screen").forEach((n) => ((n as Element & { __k?: 1 }).__k = 1)));

  // drag on empty canvas (top-left corner of the view, outside fitted content) moves the layer by the same amount
  const view = await box(page, ".uf-view");
  const a = await box(page, '.uf-screen[data-id="s0"]');
  await page.mouse.move(view.x + 6, view.y + 6);
  await page.mouse.down();
  await page.mouse.move(view.x + 46, view.y + 36, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await box(page, '.uf-screen[data-id="s0"]')).x - a.x).toBeCloseTo(40, 0);
  const b = await box(page, '.uf-screen[data-id="s0"]');
  expect(b.y - a.y).toBeCloseTo(30, 0);

  // zoom in around a point: the distance from it to the frame scales with the frame
  const [px, py] = [view.x + view.width / 2, view.y + view.height / 2];
  await page.mouse.move(px, py);
  await page.keyboard.down("Control"); // ctrl / ⌘ + wheel zooms (a trackpad pinch arrives the same way)
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await box(page, '.uf-screen[data-id="s0"]')).width).toBeGreaterThan(b.width * 1.2);
  const c = await box(page, '.uf-screen[data-id="s0"]');
  const f = c.width / b.width;
  expect(c.x - px).toBeCloseTo((b.x - px) * f, 0);
  expect(c.y - py).toBeCloseTo((b.y - py) * f, 0);

  // same DOM nodes: pan / zoom only touched the layer transform
  expect(await page.evaluate(() => [...document.querySelectorAll("path.uf-link, .uf-screen")]
    .every((n) => (n as Element & { __k?: 1 }).__k === 1))).toBe(true);
});

test("plain wheel / two-finger scroll pans instead of zooming", async ({ page }) => {
  await open(page);
  const a = await box(page, '.uf-screen[data-id="login"]');
  const view = await box(page, ".uf-view");
  await page.mouse.move(view.x + 10, view.y + 10);
  await page.mouse.wheel(30, 40);
  await expect.poll(async () => (await box(page, '.uf-screen[data-id="login"]')).y - a.y).toBeCloseTo(-40, 0);
  const b = await box(page, '.uf-screen[data-id="login"]');
  expect(b.x - a.x).toBeCloseTo(-30, 0);
  expect(b.width).toBeCloseTo(a.width, 1);
});

test("two touch pointers pinch-zoom around their midpoint", async ({ page }) => {
  await open(page);
  const view = await box(page, ".uf-view");
  const a = await box(page, '.uf-screen[data-id="code"]');
  const [mx, my] = [view.x + view.width / 2, view.y + view.height / 2];
  await page.locator(".uf-view").evaluate((v, [mx, my]) => {
    const ev = (type: string, id: number, x: number, y: number) => v.dispatchEvent(new PointerEvent(type,
      { pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
    ev("pointerdown", 1, mx - 50, my);
    ev("pointerdown", 2, mx + 50, my);
    ev("pointermove", 1, mx - 100, my);
    ev("pointermove", 2, mx + 100, my);
    ev("pointerup", 1, mx - 100, my);
    ev("pointerup", 2, mx + 100, my);
  }, [mx, my]);
  const b = await box(page, '.uf-screen[data-id="code"]');
  expect(b.width / a.width).toBeCloseTo(2, 1);
  expect(b.x - mx).toBeCloseTo((a.x - mx) * 2, 0);
});

test("reduced motion: fit and goto jump at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const before = await layerTransform(page);
  const [now, later] = await page.evaluate(async () => {
    window.__api.goto("home");
    const l = document.querySelector<HTMLElement>(".uf-layer")!;
    const now = l.style.transform;
    await new Promise((r) => setTimeout(r, 300));
    return [now, l.style.transform];
  });
  expect(now).not.toBe(before);
  expect(now).toBe(later);
});

test("Esc clears the focus", async ({ page }) => {
  await open(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').click();
  await expect(page.locator(".uf-root")).toHaveClass(/uf-focus/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".uf-root")).not.toHaveClass(/uf-focus/);
});

test("goto from the check panel while in Prototype is applied when Map is shown again", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Prototype" }).click();
  await page.getByRole("button", { name: /Soát luồng/ }).click();
  await page.locator(".uf-issue", { hasText: "Đăng xuất" }).click();
  await page.getByRole("button", { name: "Toàn cục" }).click();
  await expect.poll(() => offCentre(page, "home")).toBeLessThan(2);
});

test("goto right after mounting into a hidden host wins over the initial fit", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "late";
    host.style.cssText = "position:fixed;inset:0;display:none";
    document.body.append(host);
    window.__api = window.UIFlow.mount(host, window.SAMPLE, { lang: "vi" });
    window.__api.goto("home");
    host.style.display = "block";
  });
  await expect.poll(async () => {
    const [sx, sy] = centre(await box(page, '#late .uf-screen[data-id="home"]'));
    const [vx, vy] = centre(await box(page, "#late .uf-view"));
    return Math.max(Math.abs(sx - vx), Math.abs(sy - vy));
  }).toBeLessThan(2);
});

test("dropped data shows in the check panel; get() keeps the Flow shape", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const f = structuredClone(window.SAMPLE);
    f.screens.push({ ...f.screens[0] }); // duplicate id "login"
    f.links.push({ src: "code.ok", to: "ghost", act: "navigate", when: "", ac: "AC-1" });
    f.links.push({ src: "nope.x", to: "code", act: "navigate", when: "", ac: "AC-1" });
    window.__api.set(f);
  });
  await page.getByRole("button", { name: /Soát luồng/ }).click();
  await expect(page.locator(".uf-issue", { hasText: "Bỏ 2 liên kết hỏng" })).toHaveCount(1);
  await expect(page.locator(".uf-issue", { hasText: "Bỏ màn trùng id “login”" })).toHaveCount(1);
  const keys = await page.evaluate(() => {
    const f = window.__api.get();
    return [Object.keys(f), ...f.screens.map(Object.keys), ...f.screens.flatMap((s) => s.items.map(Object.keys)), ...f.links.map(Object.keys)];
  });
  expect(keys.flat().filter((k) => !SCHEMA.has(k))).toEqual([]);
});

test("a parent with 3 overlays: no frame overlaps a frame of another family", async ({ page }) => {
  await open(page);
  const f = await page.evaluate(() => window.UIFlow.layout({
    v: 1, ticket: "VA-3", rev: 0, device: "mobile",
    screens: [
      { id: "a", title: "A", kind: "screen", parent: null, zeplin: "", ac: "", items: [{ id: "b", label: "B" }, { id: "c", label: "C" }] },
      { id: "b", title: "B", kind: "screen", parent: null, zeplin: "", ac: "", items: [{ id: "d", label: "D" }] },
      { id: "p1", title: "P1", kind: "popup", parent: "b", zeplin: "", ac: "", items: [] },
      { id: "p2", title: "P2", kind: "sheet", parent: "b", zeplin: "", ac: "", items: [] },
      { id: "p3", title: "P3", kind: "toast", parent: "b", zeplin: "", ac: "", items: [] },
      { id: "c", title: "C", kind: "screen", parent: null, zeplin: "", ac: "", items: [] },
      { id: "d", title: "D", kind: "screen", parent: null, zeplin: "", ac: "", items: [] },
    ],
    links: [
      { src: "a.b", to: "b", act: "navigate", when: "", ac: "" },
      { src: "a.c", to: "c", act: "navigate", when: "", ac: "" },
      { src: "b.d", to: "d", act: "navigate", when: "", ac: "" },
    ],
  }));
  const by = Object.fromEntries(f.screens.map((s) => [s.id, s]));
  expect([by.p3.x! - by.b.x!, by.p3.y! - by.b.y!]).toEqual([180, 180]);
  const fam = (s: Screen) => s.parent ?? s.id;
  const hit = (a: Screen, b: Screen) => a.x! < b.x! + 390 && b.x! < a.x! + 390 && a.y! < b.y! + 844 && b.y! < a.y! + 844;
  const clashes = f.screens.flatMap((a) => f.screens.filter((b) => a.id < b.id && fam(a) !== fam(b) && hit(a, b)).map((b) => `${a.id}/${b.id}`));
  expect(clashes).toEqual([]);
});

// ------------------------------------------------------------------ prototype
const title = (page: Page) => page.locator(".uf-nav .uf-title"); // not .uf-phone .uf-title: overlay cards have one too
const tapIn = (page: Page, text: string) => page.locator(".uf-phone").getByRole("button", { name: text, exact: true }).click();
/** SAMPLE plus whatever `edit` adds, set through the api before entering Prototype. */
const withFlow = (page: Page, edit: string) => page.evaluate((edit) => {
  const f = structuredClone(window.SAMPLE);
  new Function("f", edit)(f);
  window.__api.set(f);
}, edit);

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

/** A page shaped like an exported uiflow-<ticket>.html (data block + the engine inline), served over http so the
 *  engine treats it as standalone: hash writing and "Lưu file" are on. */
async function standalone(page: Page, hash = "", tweak = "") {
  const engine = fs.readFileSync(path.join(__dirname, "../public/uiflow.js"), "utf8");
  await open(page);
  const flow = JSON.stringify(await page.evaluate((tweak) => {
    const f = structuredClone(window.SAMPLE);
    if (tweak) new Function("f", tweak)(f);
    return f;
  }, tweak)).replace(/</g, "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><title>uiflow</title>
<style>html,body{margin:0;height:100%}#uiflow{position:fixed;inset:0}</style>
<script type="application/json" id="uiflow-data">${flow}</script><script>${engine}</script>`;
  await page.route("http://uiflow.test/**", (r) => r.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://uiflow.test/uiflow-VA-1.html" + hash);
}

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

// ------------------------------------------------------------------ editing (Sửa)
const edit = async (page: Page) => page.getByRole("button", { name: "Sửa" }).click();
const dirty = (page: Page) => page.evaluate(() => window.__dirty);
const links = (page: Page) => page.evaluate(() => window.__api.get().links);
const drag = async (page: Page, from: string, to: [number, number]) => {
  const b = await box(page, from);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
};
const centreOf = async (page: Page, sel: string): Promise<[number, number]> => {
  const [x, y] = centre(await box(page, sel));
  return [x, y];
};

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

// ------------------------------------------------------------------ editing: the backend's limits
const insp = (page: Page) => page.locator(".uf-insp");
const flowOf = (page: Page) => page.evaluate(() => window.__api.get());
/** n screens, each with `items` buttons, plus `extraLinks` copies of one link. */
function sized(n: number, items: number, extraLinks = 0): Flow {
  const screens: Screen[] = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, title: `Màn ${i}`, kind: "screen", parent: null, zeplin: "", ac: "AC",
    items: Array.from({ length: items }, (_, j) => ({ id: `i${j}`, label: `Nút ${j}` })),
  }));
  const links: Link[] = Array.from({ length: extraLinks }, () =>
    ({ src: "s0.i0", to: "s1", act: "navigate", when: "", ac: "AC" }));
  return { v: 1, ticket: "VA-9", rev: 0, device: "mobile", screens, links };
}

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
    const g = structuredClone(window.SAMPLE) as Omit<Flow, "v"> & { v: number };
    g.v = 2;
    g.device = "web";
    g.rev = 1.5;
    g.screens[0].title = "";
    window.__api.set(g as unknown as Flow);
    return window.__api.get();
  });
  expect([f.v, f.device, f.rev]).toEqual([1, "mobile", 1]);
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
