import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The UI flow engine (web/public/uiflow.js) on a static fixture page, opened via file:// like an exported file.
type Item = { id: string; label: string };
type Screen = { id: string; title: string; kind: string; parent: string | null; x?: number | null; y?: number | null;
  zeplin: string; ac: string; items: Item[] };
type Link = { src: string; to: string; act: string; when: string; ac: string };
type Flow = { v: 1; ticket: string; rev: number; device: string; screens: Screen[]; links: Link[] };
type Issue = { kind: string; screen: string; item?: string; text: string };
declare global {
  interface Window {
    UIFlow: { layout(f: Flow): Flow; check(f: Flow): Issue[] };
    SAMPLE: Flow;
    __api: { get(): Flow; set(f: Flow): void };
  }
}

const FIXTURE = pathToFileURL(path.join(__dirname, "uiflow-fixture.html")).href;
const open = (page: Page, hash = "") => page.goto(FIXTURE + hash);
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const centre = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2];

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
  expect(by.home.x! - by.code.x!).toBe(610);
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
  for (const b of await page.locator(".uf-bar button").all()) {
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

test("60 screens / 300 links: drag pans and wheel zooms around the cursor without redrawing", async ({ page }) => {
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
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await box(page, '.uf-screen[data-id="s0"]')).width).toBeGreaterThan(b.width * 1.2);
  const c = await box(page, '.uf-screen[data-id="s0"]');
  const f = c.width / b.width;
  expect(c.x - px).toBeCloseTo((b.x - px) * f, 0);
  expect(c.y - py).toBeCloseTo((b.y - py) * f, 0);

  // same DOM nodes: pan / zoom only touched the layer transform
  expect(await page.evaluate(() => [...document.querySelectorAll("path.uf-link, .uf-screen")]
    .every((n) => (n as Element & { __k?: 1 }).__k === 1))).toBe(true);
});
