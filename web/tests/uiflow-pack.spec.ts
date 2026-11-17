import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { UiFlow, FlowShot } from "../src/features/youtrack/lib/yt";

const source = fs.readFileSync(path.join(__dirname, "../src/features/youtrack/lib/uiflow.ts"), "utf8").split("export const zeplinUrls")[1];
const browserPack = ts.transpileModule(("const zeplinUrls" + source).replace(/export /g, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
type Shots = Record<string, FlowShot>;
declare global {
  interface Window {
    __pack(f: UiFlow, shots: Shots, onEach?: (done: number, total: number) => void): Promise<{ shots: Shots; failed: number }>;
    __packStats(): { size: number; bytes: number; active: number; inflight: number };
  }
}
const fixture = (count: number, prefix = "image") => {
  const screens = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, zeplin: `z${i}` }));
  const shots = Object.fromEntries(screens.map((s, i) => [s.zeplin, { src: `${prefix}-${i}`, w: 390, h: 844, hits: [] }]));
  return { flow: { v: 1, ticket: "SYNTHETIC", screens, links: [] } as unknown as UiFlow, shots };
};
async function setup(page: Page) {
  await page.route("http://pack.test/", (route) => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
  await page.goto("http://pack.test/");
  await page.addScriptTag({ content: browserPack + ";window.__pack=packShots;window.__packStats=()=>({size:packed.size,bytes:packedBytes,active:packActive,inflight:packing.size});" });
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="white"/></svg>';

test("simultaneous saves share three decode slots, deduplicate and report progress", async ({ page }) => {
  let active = 0, peak = 0, requests = 0;
  await page.route("**/api/yt/flow/image?**", async (route) => {
    requests++; peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await route.fulfill({ contentType: "image/svg+xml", body: svg });
    active--;
  });
  await setup(page);
  const data = fixture(10);
  const result = await page.evaluate(async ({ flow, shots }) => {
    const progress: number[][] = [];
    const results = await Promise.all([window.__pack(flow, shots, (done, total) => progress.push([done, total])), window.__pack(flow, shots)]);
    return { results, progress, stats: window.__packStats() };
  }, data);
  expect(peak).toBeLessThanOrEqual(3);
  expect(requests).toBe(10);
  expect(result.results.map((r) => r.failed)).toEqual([0, 0]);
  expect(result.progress).toEqual(Array.from({ length: 10 }, (_, i) => [i + 1, 10]));
  expect(result.stats.active).toBe(0);
  expect(result.stats.inflight).toBe(0);
  await page.evaluate(({ flow, shots }) => window.__pack(flow, shots), data);
  expect(requests).toBe(10);
});

test("failed images keep flow intact, finish progress and retry without poisoned cache", async ({ page }) => {
  let fail = true, requests = 0;
  await page.route("**/api/yt/flow/image?**", async (route) => {
    requests++;
    if (fail) await route.fulfill({ status: 502, body: "synthetic image error" });
    else await route.fulfill({ contentType: "image/svg+xml", body: svg });
  });
  await setup(page);
  const data = fixture(1);
  const result = await page.evaluate(async ({ flow, shots }) => {
    const before = JSON.stringify(flow), progress: number[] = [];
    const result = await window.__pack(flow, shots, (done) => progress.push(done));
    return { result, intact: JSON.stringify(flow) === before, progress, stats: window.__packStats() };
  }, data);
  expect(result).toMatchObject({ result: { shots: {}, failed: 1 }, intact: true, progress: [1], stats: { size: 0, active: 0, inflight: 0 } });
  fail = false;
  expect((await page.evaluate(({ flow, shots }) => window.__pack(flow, shots), data)).failed).toBe(0);
  expect(requests).toBe(2);
});

test("packed cache bounds entries and bytes; canvases release decoded backing stores", async ({ page }) => {
  await page.route("**/api/yt/flow/image?**", (route) => route.fulfill({ contentType: "image/svg+xml", body: svg }));
  await setup(page);
  const first = fixture(70);
  const stats = await page.evaluate(async ({ flow, shots }) => {
    await window.__pack(flow, shots);
    return window.__packStats();
  }, first);
  expect(stats.size).toBe(64);
  await page.evaluate(() => {
    const canvases: HTMLCanvasElement[] = [];
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      canvases.push(this);
      callback(new Blob([new Uint8Array(900_000)], { type: "image/webp" }));
    };
    (window as unknown as { __canvases: HTMLCanvasElement[] }).__canvases = canvases;
  });
  const second = fixture(20, "large");
  const bounded = await page.evaluate(async ({ flow, shots }) => {
    await window.__pack(flow, shots);
    return { stats: window.__packStats(), released: (window as unknown as { __canvases: HTMLCanvasElement[] }).__canvases.every((c) => c.width === 0 && c.height === 0) };
  }, second);
  expect(bounded.stats.bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(bounded.stats.size).toBeLessThan(20);
  expect(bounded.released).toBe(true);
});

test("oversized encoded images are not cached and can be retried", async ({ page }) => {
  await page.route("**/api/yt/flow/image?**", (route) => route.fulfill({ contentType: "image/svg+xml", body: svg }));
  await setup(page);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    let once = true;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (once) { once = false; args[0](new Blob([new Uint8Array(1_100_000)], { type: "image/webp" })); }
      else original.apply(this, args);
    };
  });
  const data = fixture(1);
  expect((await page.evaluate(({ flow, shots }) => window.__pack(flow, shots), data)).failed).toBe(1);
  expect((await page.evaluate(() => window.__packStats())).size).toBe(0);
  expect((await page.evaluate(({ flow, shots }) => window.__pack(flow, shots), data)).failed).toBe(0);
});
