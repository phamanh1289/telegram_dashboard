import { expect, test } from "@playwright/test";
import { type Screen, SCHEMA, open, box, centre, offCentre, layerTransform, bigFlow, edit, scr, nav, flowOfShape, laid, VA12584 } from "./uiflow.helpers";

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
