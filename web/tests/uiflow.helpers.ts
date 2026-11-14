import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Shared fixture controls for the standalone UI flow engine specs.
export type Item = { id: string; label: string; rect?: { x: number; y: number; w: number; h: number } | null };

export type Screen = { id: string; title: string; kind: string; parent: string | null; x?: number | null; y?: number | null;
  zeplin: string; ac: string; note?: string; items: Item[] };

export type Link = { src: string; to: string; act: string; when: string; ac: string };

export type Flow = { v: number; start?: string | null; ticket: string; rev: number; device: string; screens: Screen[]; links: Link[] };

export type Issue = { kind: string; screen?: string; item?: string; text: string };

export type Api = { get(): Flow; set(f: Flow): void; goto(id: string): void; undo(): void; redo(): void; destroy(): void;
  mode(m: "map" | "play"): void };

export const SCHEMA = new Set(["v", "ticket", "rev", "device", "screens", "links", "id", "title", "kind", "parent", "x", "y",
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

export const FIXTURE = pathToFileURL(path.join(__dirname, "uiflow-fixture.html")).href;

export const open = (page: Page, hash = "") => page.goto(FIXTURE + hash);

export const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

export const centre = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2];

export const offCentre = async (page: Page, id: string) => {
  const [sx, sy] = centre(await box(page, `.uf-screen[data-id="${id}"]`));
  const [vx, vy] = centre(await box(page, ".uf-view"));
  return Math.max(Math.abs(sx - vx), Math.abs(sy - vy));
};

export const layerTransform = (page: Page) => page.locator(".uf-layer").evaluate((l) => (l as HTMLElement).style.transform);

export function bigFlow(n: number, extra = 0): Flow {
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

export const title = (page: Page) => page.locator(".uf-nav .uf-title");

export const tapIn = (page: Page, text: string) => page.locator(".uf-phone").getByRole("button", { name: text, exact: true }).click();

export const withFlow = (page: Page, edit: string) => page.evaluate((edit) => {
  const f = structuredClone(window.SAMPLE);
  new Function("f", edit)(f);
  window.__api.set(f);
}, edit);

export async function standalone(page: Page, hash = "", tweak = "") {
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

export const edit = async (page: Page) => page.getByRole("button", { name: "Sửa" }).click();

export const dirty = (page: Page) => page.evaluate(() => window.__dirty);

export const links = (page: Page) => page.evaluate(() => window.__api.get().links);

export const drag = async (page: Page, from: string, to: [number, number]) => {
  const b = await box(page, from);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
};

export const centreOf = async (page: Page, sel: string): Promise<[number, number]> => {
  const [x, y] = centre(await box(page, sel));
  return [x, y];
};

export const insp = (page: Page) => page.locator(".uf-insp");

export const flowOf = (page: Page) => page.evaluate(() => window.__api.get());

export function sized(n: number, items: number, extraLinks = 0): Flow {
  const screens: Screen[] = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, title: `Màn ${i}`, kind: "screen", parent: null, zeplin: "", ac: "AC",
    items: Array.from({ length: items }, (_, j) => ({ id: `i${j}`, label: `Nút ${j}` })),
  }));
  const links: Link[] = Array.from({ length: extraLinks }, () =>
    ({ src: "s0.i0", to: "s1", act: "navigate", when: "", ac: "AC" }));
  return { v: 1, ticket: "VA-9", rev: 0, device: "mobile", screens, links };
}

export function exported(flow: Flow): string {
  const engine = path.join(__dirname, "../public/uiflow.js");
  return execFileSync("uv", ["run", "--quiet", "python", "-c",
    "import json, sys\nfrom telegram_dashboard.youtrack import flow as u\nf = json.load(sys.stdin)\n" +
    "sys.stdout.write(u.build_html(u.clean(f, f['ticket']), open(sys.argv[1], encoding='utf-8').read()))", engine],
  { cwd: path.join(__dirname, "../.."), input: JSON.stringify(flow), encoding: "utf8" });
}

export const scr = (id: string, kind = "screen", parent: string | null = null, items: string[] = []): Screen =>
  ({ id, title: id, kind, parent, zeplin: "", ac: "", items: items.map((i) => ({ id: i, label: i })) });

export const nav = (src: string, to: string): Link => ({ src, to, act: "navigate", when: "", ac: "" });

export const flowOfShape = (screens: Screen[], links: Link[]): Flow => ({ v: 1, ticket: "VA-7", rev: 0, device: "mobile", screens, links });

export const laid = async (page: Page, f: Flow) => Object.fromEntries(
  (await page.evaluate((f) => window.UIFlow.layout(f), f)).screens.map((s) => [s.id, s]));

export const VA12584 = flowOfShape([
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

export type Win = Window & { __lookup: string; __calls: number };

export const PIC = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1688"><rect width="780" height="1688" fill="#ddd"/></svg>');

export async function remount(page: Page, mode = "ok") {
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

export const find = (page: Page) => page.getByRole("combobox", { name: /Tìm màn/ });

export const selectScreen = async (page: Page, id: string) => {
  await page.locator(`.uf-screen[data-id="${id}"] .uf-title`).click();
  await expect(page.locator(".uf-insp")).toBeVisible();
};
