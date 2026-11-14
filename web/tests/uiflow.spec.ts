import { flowDataset, legacyDataset, malformedDataset } from "./uiflow-datasets";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The UI flow engine (web/public/uiflow.js) on a static fixture page, opened via file:// like an exported file.
type Item = { id: string; label: string; rect?: { x: number; y: number; w: number; h: number } | null };
type Screen = { id: string; title: string; kind: string; parent: string | null; x?: number | null; y?: number | null;
  zeplin: string; ac: string; note?: string; items: Item[] };
type Link = { src: string; to: string; act: string; when: string; ac: string };
type Flow = { v: number; start?: string | null; ticket: string; rev: number; device: string; screens: Screen[]; links: Link[] };
type Issue = { kind: string; screen?: string; item?: string; text: string };
type Api = { get(): Flow; set(f: Flow): void; goto(id: string): void; undo(): void; redo(): void; destroy(): void;
  mode(m: "map" | "play"): void };
const SCHEMA = new Set(["v", "ticket", "rev", "device", "screens", "links", "id", "title", "kind", "parent", "x", "y",
  "zeplin", "ac", "note", "items", "label", "rect", "w", "h", "src", "to", "act", "when", "start"]);
declare global {
  interface Window {
    UIFlow: { layout(f: Flow): Flow; check(f: Flow): Issue[]; paths(f: Flow, lang?: string): string; mount(el: Element, f: Flow, o: object): Api };
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
  // nosrc: every screen of the sample but "login" has no Zeplin link
  expect(rows.map((r) => r.kind).filter((k) => k !== "nosrc").sort()).toEqual(["dead", "noac", "noback", "orphan"]);
  expect(rows.filter((r) => r.kind === "nosrc").map((r) => r.screen).sort()).toEqual(["code", "home", "lost"]);
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  expect(by.orphan.screen).toBe("lost");
  expect([by.dead.screen, by.dead.item]).toEqual(["home", "out"]);
  expect(by.noback.screen).toBe("home");
  expect(by.noac.screen).toBe("code");
  expect(rows.every((r) => r.text.length > 0)).toBe(true);

  await page.getByRole("button", { name: "Soát luồng (5)" }).click(); // 3 gaps + 2 screens with no source
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

// ------------------------------------------------------------------ the exported file, as the backend builds it
/** The page `uiflow.build_html` writes to the ticket — its real SHELL (no CSS at all), the engine inline and the data
 *  block — produced by the backend function itself, so this test cannot drift from what users download. */
function exported(flow: Flow): string {
  const engine = path.join(__dirname, "../public/uiflow.js");
  return execFileSync("uv", ["run", "--quiet", "python", "-c",
    "import json, sys\nfrom telegram_dashboard import uiflow as u\nf = json.load(sys.stdin)\n" +
    "sys.stdout.write(u.build_html(u.clean(f, f['ticket']), open(sys.argv[1], encoding='utf-8').read()))", engine],
  { cwd: path.join(__dirname, "../.."), input: JSON.stringify(flow), encoding: "utf8" });
}

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

// ------------------------------------------------------------------ layout of real, loosely connected flows
const scr = (id: string, kind = "screen", parent: string | null = null, items: string[] = []): Screen =>
  ({ id, title: id, kind, parent, zeplin: "", ac: "", items: items.map((i) => ({ id: i, label: i })) });
const nav = (src: string, to: string): Link => ({ src, to, act: "navigate", when: "", ac: "" });
const flowOfShape = (screens: Screen[], links: Link[]): Flow => ({ v: 1, ticket: "VA-7", rev: 0, device: "mobile", screens, links });
const laid = async (page: Page, f: Flow) => Object.fromEntries(
  (await page.evaluate((f) => window.UIFlow.layout(f), f)).screens.map((s) => [s.id, s]));

/** Shaped like the VA-12584 flow: 15 screens + 2 popups, 11 links; only 5 screens reachable from the first. */
const VA12584 = flowOfShape([
  scr("S44", "screen", null, ["btn_ttts", "btn_phaply"]), scr("S44B", "screen", null, ["btn_vtda", "btn_vttd", "btn_cttd", "btn_httd"]),
  scr("S44C", "screen", null, ["a"]), scr("S44D"), scr("S44E"), scr("S44G"), scr("S45A", "screen", null, ["a"]),
  scr("S45B", "screen", null, ["a"]), scr("S47A", "screen", null, ["btn_gtpl"]), scr("S47C", "screen", null, ["a"]),
  scr("S56", "screen", null, ["btn_vtda", "btn_ttch"]), scr("S56A", "screen", null, ["a"]), scr("S56B", "screen", null, ["a"]),
  scr("S56B2", "screen", null, ["a"]), scr("S41"),
  scr("P_lostperm44", "popup", "S44", ["btn_vedanhsach"]), scr("P_lostperm56", "popup", "S56", ["btn_vedanhsach"]),
], [
  nav("S44.btn_ttts", "S44C"), nav("S44B.btn_vtda", "S44C"), nav("S44B.btn_vttd", "S44D"), nav("S44B.btn_cttd", "S45A"),
  nav("S44B.btn_httd", "S45B"), nav("S44.btn_phaply", "S47A"), nav("S47A.btn_gtpl", "S47C"), nav("S56.btn_vtda", "S56A"),
  nav("S56.btn_ttch", "S56B"), nav("P_lostperm44.btn_vedanhsach", "S41"), nav("P_lostperm56.btn_vedanhsach", "S41"),
]);

test("a 17-screen, loosely linked flow fits 1440x900 as a landscape map, not one tall column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const by = await laid(page, VA12584);
  const xs = new Set(Object.values(by).filter((s) => s.kind === "screen").map((s) => s.x));
  const rows = new Set(Object.values(by).filter((s) => s.kind === "screen").map((s) => s.y));
  expect(rows.size).toBeLessThanOrEqual(3); // the row cap for 15 screens; it used to be a column 10 tall
  expect(xs.size).toBeGreaterThanOrEqual(5);
  await page.evaluate((f) => window.__api.set(f), VA12584);
  const k = Number(/scale\(([\d.]+)\)/.exec(await layerTransform(page))![1]);
  // 15 phone frames (610 x 964 with their gaps) in a 1376 x 787 view cannot do better than ~0.28 even packed
  // perfectly, so 0.25 is the bar; the single-column layout gave 0.1 (the minimum zoom)
  expect(k).toBeGreaterThanOrEqual(0.25);
});

test("screens nothing links to or from form a grid, not a column", async ({ page }) => {
  await open(page);
  const lone = ["b", "c", "d", "e", "f", "g", "h"];
  const by = await laid(page, flowOfShape([scr("a"), ...lone.map((id) => scr(id))], []));
  const xs = new Set(lone.map((id) => by[id].x!)), ys = new Set(lone.map((id) => by[id].y!));
  expect(ys.size).toBe(3); // row cap max(3, ceil(sqrt(8 * 0.4))) = 3
  expect(xs.size).toBe(3); // 7 screens, 3 per column
  expect(Math.min(...xs)).toBeGreaterThan(by.a.x!); // to the right of the main flow
});

test("two groups that do not hang off the first screen are each laid out by BFS, in order", async ({ page }) => {
  await open(page);
  const by = await laid(page, flowOfShape(
    [scr("a", "screen", null, ["x"]), scr("b"), scr("c", "screen", null, ["x", "y"]), scr("d"), scr("e"),
      scr("f", "screen", null, ["x"]), scr("g")],
    [nav("a.x", "b"), nav("c.x", "d"), nav("c.y", "e"), nav("f.x", "g")]));
  expect(by.b.x! - by.a.x!).toBe(610); // main flow: a, then b
  expect([by.d.x! - by.c.x!, by.e.x! - by.c.x!]).toEqual([610, 610]); // c's group: c, then d and e in one column
  expect(by.e.y! - by.d.y!).toBe(964);
  expect(by.g.x! - by.f.x!).toBe(610); // f's group
  expect(by.c.x!).toBeGreaterThan(by.b.x!); // groups sit right of the main flow, by first appearance
  expect(by.f.x!).toBeGreaterThan(by.d.x!);
  expect([by.a.y, by.c.y, by.f.y]).toEqual([0, 0, 0]); // each group starts at the top
});

// ------------------------------------------------------------------ frame labels (readable names at any zoom)
test("at fit-all every frame has a readable label just above it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate((f) => window.__api.set(f), VA12584);
  const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".uf-flabel")].map((l) => {
    const t = l.querySelector<HTMLElement>(".uf-ltitle")!, card = l.parentElement!.getBoundingClientRect();
    const b = l.getBoundingClientRect();
    return { font: parseFloat(getComputedStyle(t).fontSize), shown: t.getBoundingClientRect().height,
      gap: card.top - b.bottom, dx: b.left - card.left, over: b.width - card.width, text: t.textContent };
  }));
  expect(rows).toHaveLength(17); // every screen and popup
  for (const r of rows) {
    expect(r.font).toBeGreaterThanOrEqual(12);
    expect(r.shown).toBeGreaterThanOrEqual(14); // on screen, not shrunk with the 0.26 zoom (a 17px title is 4px here)
    expect(Math.abs(r.gap)).toBeLessThan(1); // it sits on the frame's top edge...
    expect(Math.abs(r.dx)).toBeLessThan(1); // ...from its left edge...
    expect(r.over).toBeLessThan(1); // ...and never wider than the frame on screen (ellipsis)
  }
  expect(rows.map((r) => r.text)).toContain("S44B");
});

test("a pan moves the labels without touching them; a zoom close in hides them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate((f) => window.__api.set(f), VA12584);
  await page.evaluate(() => document.querySelectorAll(".uf-flabel").forEach((n) => ((n as Element & { __k?: 1 }).__k = 1)));
  const a = await box(page, '.uf-screen[data-id="S44"] .uf-flabel');
  const view = await box(page, ".uf-view");
  await page.mouse.move(view.x + view.width - 10, view.y + view.height - 10);
  await page.mouse.wheel(0, 120); // plain wheel pans
  await expect.poll(async () => (await box(page, '.uf-screen[data-id="S44"] .uf-flabel')).y - a.y).toBeCloseTo(-120, 0);
  expect(await page.evaluate(() => [...document.querySelectorAll(".uf-flabel")]
    .every((n) => (n as Element & { __k?: 1 }).__k === 1 && !n.getAttribute("style")))).toBe(true); // same nodes, no writes

  const opacity = () => page.locator('.uf-screen[data-id="S44"] .uf-flabel').evaluate((e) => getComputedStyle(e).opacity);
  await expect.poll(opacity).toBe("1"); // faded in after set() refit from the fixture's closer zoom
  await page.evaluate(() => window.__api.goto("S44")); // one screen fills the view: its own title is readable
  await expect.poll(opacity).toBe("0");
});

test("a label rides along with its screen while it is dragged", async ({ page }) => {
  await open(page);
  await edit(page);
  const lab = await box(page, '.uf-screen[data-id="code"] .uf-flabel');
  const head = await box(page, '.uf-screen[data-id="code"] .uf-head');
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 140, head.y + head.height / 2 + 50, { steps: 6 });
  await expect.poll(async () => (await box(page, '.uf-screen[data-id="code"] .uf-flabel')).x - lab.x).toBeCloseTo(120, 0);
  expect((await box(page, '.uf-screen[data-id="code"] .uf-flabel')).y - lab.y).toBeCloseTo(50, 0);
  await page.mouse.up();
});

test("a narrow label shows what tells screens apart: no shared title prefix, no AC chip", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate((f) => {
    const g = structuredClone(f);
    g.screens.forEach((s) => { if (s.kind === "screen") s.title = `Ban-TSCNY ${s.id.slice(1)} - Màn ${s.id}`; s.ac = "AC4.5"; });
    window.__api.set(g);
  }, VA12584);
  const s44b = page.locator('.uf-screen[data-id="S44B"]');
  await expect(s44b.locator(".uf-ltitle")).toHaveText("44B - Màn S44B"); // "Ban-TSCNY " is on every screen
  await expect(s44b.locator(".uf-title")).toHaveText("Ban-TSCNY 44B - Màn S44B"); // the frame keeps the full title
  await expect(s44b.locator(".uf-lac")).toBeHidden(); // ~100px on screen: the chip would only push the name out
  await expect(page.locator('.uf-screen[data-id="P_lostperm44"] .uf-ltitle')).toHaveText("P_lostperm44"); // not a screen title
  await page.evaluate(() => window.__api.goto("S44B")); // close in, the label has room again... and steps aside anyway
  await expect.poll(() => s44b.locator(".uf-flabel").evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
});

test("a frame label is hidden from screen readers; the frame's accessible text has the title once", async ({ page }) => {
  await open(page);
  const s = page.locator('.uf-screen[data-id="code"]');
  await expect(s.locator(".uf-flabel")).toHaveAttribute("aria-hidden", "true");
  const title = await s.locator(".uf-title").innerText();
  const heard = await s.evaluate((e) => {
    const c = e.cloneNode(true) as HTMLElement;
    c.querySelectorAll("[aria-hidden=true]").forEach((n) => n.remove());
    return c.textContent ?? "";
  });
  expect(heard.split(title).length - 1).toBe(1);
});

test("a leftover root that only leads to an already taken screen is laid out with the groups, not the grid", async ({ page }) => {
  await open(page);
  const by = await laid(page, flowOfShape(
    [scr("r1"), scr("r2"), scr("X"), scr("U"), scr("V")], [nav("r1", "X"), nav("r2", "X")]));
  expect(by.r2.x).toBeGreaterThanOrEqual(by.X.x!); // with the groups: not left of the main flow
  expect(by.U.x).toBe(by.V.x); // unlinked screens share the grid
  expect(by.U.x).toBeGreaterThan(by.r2.x!); // the grid comes after every group
});

test("a label never ends up empty when the shared title prefix is stripped", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const g = structuredClone(window.SAMPLE);
    g.screens.forEach((s) => { if (s.kind === "screen") s.title = `Ban ${s.id}`; });
    g.screens.find((s) => s.kind !== "screen")!.title = "Ban ";
    window.__api.set(g);
  });
  const t = await page.locator(".uf-ltitle").allInnerTexts();
  expect(t.every((x) => x.trim() !== "")).toBe(true);
});

for (const interruption of ["pointercancel", "mode", "shots", "escape"] as const) {
  test(`interrupted screen drag rolls back without dirty/undo: ${interruption}`, async ({ page }) => {
    await open(page);
    await edit(page);
    const before = await page.evaluate(() => window.__api.get());
    const head = await box(page, '.uf-screen[data-id="code"] .uf-head');
    await page.mouse.move(head.x + 20, head.y + 10);
    await page.mouse.down();
    await page.mouse.move(head.x + 100, head.y + 70, { steps: 4 });
    await page.waitForTimeout(40);
    await page.evaluate((kind) => {
      if (kind === "pointercancel") document.querySelector(".uf-layer")!.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
      else if (kind === "mode") window.__api.mode("play");
      else if (kind === "shots") (window.__api as unknown as { shots(s: object): void }).shots({});
      else document.querySelector(".uf-view")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }, interruption);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__api.get())).toEqual(before);
    expect(await dirty(page)).toBe(false);
    await page.evaluate(() => window.__api.undo());
    expect(await page.evaluate(() => window.__api.get())).toEqual(before);
  });
}

test("successful screen gesture commits once and one undo restores family", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__api.destroy();
    (window as unknown as { __changes: number }).__changes = 0;
    window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, window.SAMPLE, { edit: true,
      onChange: () => { (window as unknown as { __changes: number }).__changes++; } });
  });
  await edit(page);
  const before = await page.evaluate(() => window.__api.get());
  const head = await box(page, '.uf-screen[data-id="code"] .uf-head');
  await page.mouse.move(head.x + 20, head.y + 10);
  await page.mouse.down();
  await page.mouse.move(head.x + 100, head.y + 70, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { __changes: number }).__changes)).toBe(1);
  await page.evaluate(() => window.__api.undo());
  expect(await page.evaluate(() => window.__api.get())).toEqual(before);
});

for (const count of [5, 20, 60] as const) {
  test(`baseline shaped dataset ${count} mounts with images, loops and missing labels`, async ({ page }) => {
    await open(page);
    const dataset = flowDataset(count);
    const actual = await page.evaluate(({ flow, shots }) => {
      window.__api.destroy();
      window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, flow, { edit: true, shots });
      return window.__api.get();
    }, dataset);
    expect(actual.screens).toHaveLength(count);
    expect(actual.links.length).toBeLessThanOrEqual(300);
    await expect(page.locator(".uf-screen")).toHaveCount(count);
    await expect(page.locator(".uf-img").first()).toBeVisible();
  });
}

for (const [name, fixture] of [["legacy", legacyDataset], ["malformed", malformedDataset]] as const) {
  test(`baseline ${name} fixture remains recoverable`, async ({ page }) => {
    await open(page);
    const count = await page.evaluate((fixture) => {
      window.__api.set(fixture as unknown as Flow);
      return window.__api.get().screens.length;
    }, fixture);
    expect(count).toBeGreaterThan(0);
    await expect(page.locator(".uf-root")).toHaveCount(1);
  });
}

test("partial mount failure disposes camera and player observers", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    window.__api.destroy();
    const Original = window.ResizeObserver;
    let live = 0;
    window.ResizeObserver = class extends Original {
      constructor(callback: ResizeObserverCallback) { super(callback); live++; }
      disconnect() { live--; super.disconnect(); }
    };
    const original = Element.prototype.addEventListener;
    Element.prototype.addEventListener = function (...args: Parameters<typeof original>) {
      if (args[0] === "keydown" && this.classList.contains("uf-root")) throw new Error("mount regression");
      return original.apply(this, args);
    };
    let error = "";
    try { window.UIFlow.mount(document.getElementById("uiflow")!, window.SAMPLE, { edit: true }); }
    catch (e) { error = (e as Error).message; }
    finally { Element.prototype.addEventListener = original; window.ResizeObserver = Original; }
    return { error, live, children: document.getElementById("uiflow")!.childElementCount };
  });
  expect(result).toEqual({ error: "mount regression", live: 0, children: 0 });
});

test("property commit preserves unaffected screen and link nodes", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('.uf-screen[data-id="home"], .uf-handle[data-link="code.later>home"]')) {
      (node as Element & { __preserved?: boolean }).__preserved = true;
    }
  });
  await page.locator('.uf-screen[data-id="login"] .uf-title').dblclick();
  await page.keyboard.type("Màn mở đầu");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => [...document.querySelectorAll('.uf-screen[data-id="home"], .uf-handle[data-link="code.later>home"]')]
    .every((node) => (node as Element & { __preserved?: boolean }).__preserved))).toBe(true);
  await expect(page.locator('.uf-screen[data-id="login"] .uf-title')).toHaveText("Màn mở đầu");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('.uf-screen[data-id="login"] .uf-title')).toHaveText("Đăng nhập");
});

test("arriving images preserve camera, selected screen and flow positions", async ({ page }) => {
  await open(page);
  await edit(page);
  await page.locator('.uf-screen[data-id="home"] .uf-title').click();
  const before = await page.evaluate(() => ({ flow: window.__api.get(), transform: (document.querySelector(".uf-layer") as HTMLElement).style.transform }));
  await page.evaluate(() => {
    (window.__api as unknown as { shots(s: object): void }).shots({
      "https://zpl.io/abc123": { src: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="4000"/>'), w: 390, h: 4000, hits: [] },
    });
  });
  await expect(page.locator('.uf-screen[data-id="home"]')).toHaveClass(/uf-sel/);
  expect(await page.evaluate(() => window.__api.get())).toEqual(before.flow);
  expect(await layerTransform(page)).toBe(before.transform);
  expect(await dirty(page)).toBe(false);
});

test("schema v2: a v1 flow reads as v2, rect / note survive get() and a bad rect is dropped", async ({ page }) => {
  await open(page);
  const f = await page.evaluate(() => {
    const f = structuredClone(window.SAMPLE) as Flow & { screens: { note?: string; items: { rect?: unknown }[] }[] };
    f.screens[0].note = "x".repeat(4100);
    f.screens[0].items[0].rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    f.screens[1].items[0].rect = { x: 0.9, y: 0, w: 0.2, h: 0.1 }; // past the right edge
    f.screens[1].items[1].rect = { x: 0, y: 0, w: 0, h: 0.1 };
    window.__api.set(f as Flow);
    return window.__api.get();
  });
  expect(f.v).toBe(2);
  expect(f.screens[0].note).toHaveLength(4000);
  expect(f.screens[0].items[0].rect).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
  expect(f.screens[1].items.map((i) => "rect" in i)).toEqual([false, false]);
});

test("schema v2: a hand-drawn rect places the button over the text match", async ({ page }) => {
  await open(page);
  const box = await page.evaluate(() => {
    const f = structuredClone(window.SAMPLE) as Flow;
    f.screens[0].items[0].rect = { x: 0.5, y: 0.25, w: 0.25, h: 0.05 };
    window.__api.destroy();
    window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, f, { edit: true, shots: {
      "https://zpl.io/abc123": { src: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1688"/>'),
        w: 780, h: 1688, hits: [["Gửi OTP", 0, 0, 200, 50]] },
    } });
    const el = document.querySelector('.uf-screen[data-id="login"] .uf-item[data-item="otp"]') as HTMLElement;
    return { hot: el.classList.contains("uf-hot"), left: el.style.left, top: el.style.top, width: el.style.width };
  });
  expect(box).toEqual({ hot: true, left: "195px", top: "211px", width: "97.5px" });
});

test("schema v2: a newer file is refused, not edited", async ({ page }) => {
  await open(page);
  const err = await page.evaluate(() => {
    try { window.__api.set({ ...structuredClone(window.SAMPLE), v: 3 }); return null; } catch (e) { return String(e); }
  });
  expect(err).toContain("v3");
});

// ------------------------------------------------------------------ phase 6: search, + Từ Zeplin
type Win = Window & { __lookup: string; __calls: number };
const PIC = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1688"><rect width="780" height="1688" fill="#ddd"/></svg>');
/** Remount the sample with an image on "login" and a fake lookup (`mode`: ok | missing | fail). */
async function remount(page: Page, mode = "ok") {
  await page.evaluate(({ pic, mode }) => {
    const w = window as unknown as Win;
    w.__lookup = mode;
    w.__calls = 0;
    window.__api.destroy();
    window.__dirty = false;
    window.__api = window.UIFlow.mount(document.getElementById("uiflow")!, window.SAMPLE, {
      edit: true, lang: "vi",
      shots: { "https://zpl.io/abc123": { src: pic, w: 780, h: 1688, hits: [["Gửi OTP", 0, 0, 200, 50]] } },
      onChange: (_: Flow, d: boolean) => { window.__dirty = d; },
      lookup: async () => {
        w.__calls++;
        if (w.__lookup === "fail") throw new Error("Token Zeplin bị từ chối");
        return w.__lookup === "missing" ? null : { src: pic, w: 780, h: 1688, hits: [], title: "Thanh toán" };
      },
    } as object);
  }, { pic: PIC, mode });
}
const find = (page: Page) => page.getByRole("combobox", { name: /Tìm màn/ });

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

// ------------------------------------------------------------------ phase 7: tap areas, note, keys, re-arrange
const selectScreen = async (page: Page, id: string) => {
  await page.locator(`.uf-screen[data-id="${id}"] .uf-title`).click();
  await expect(page.locator(".uf-insp")).toBeVisible();
};

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

// ------------------------------------------------------------------ phase 8: keyboard only, narrow container
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


// ------------------------------------------------------------------ backlog: start screen, review filter, redo, checklist
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
