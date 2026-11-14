import { flowDataset, legacyDataset, malformedDataset } from "./uiflow-datasets";
import { expect, test } from "@playwright/test";
import { type Flow, open, box, layerTransform, edit, dirty } from "./uiflow.helpers";

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
