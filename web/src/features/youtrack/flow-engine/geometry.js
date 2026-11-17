import { hotspots, layersOf, shotOf } from './shots.js';
import { MIN_FOLD, BOTTOM, CARD_HEAD, CARD_PAD, DEVICE, FOLD_SLACK, H, HEAD, PAD, ROW, STATUS, STEP, TALL, TOP, W, ZMAX, ZMIN } from './constants.js';
import { family, isOverlay } from './model.js';
import { clamp, itm, scr } from './values.js';

// ------------------------------------------------------------------ geometry (pure, canvas units)
/** The visible card inside a 390 × 844 frame: the whole phone for a screen, a dialog / sheet / toast otherwise.
 *  head / headH: the title bar; top / step: where item rows start and their pitch. */
/** How high a screen's frame is: the phone, or the whole design when it is a page that scrolls (a 375 × 3714
 *  list): its lower buttons are on the map where the design has them, not rows under a cut image. */
function frameH(s, whole = false) {
  const sh = shotOf(s), hh = sh ? (sh.h * W) / sh.w : 0;
  // a window is as high as its page, whatever that is
  const full = DEVICE === "web" ? (sh ? Math.max(MIN_FOLD, Math.round(hh)) : H) : hh > H * TALL ? Math.round(hh) : H;
  // folded by the user (`fold`: the part of the design shown, 0..1): the rest is cut, its buttons become rows
  return sh && s.fold && !whole ? Math.min(full, Math.max(MIN_FOLD, Math.round(hh * s.fold))) : full;
}
/** A design longer than one frame (a list that scrolls) can be folded to a part of it on the map. */
const canFold = (s) => !!shotOf(s) && frameH(s, true) > H;
/** Fold screen `id` of `f` to `fold` (0..1 of its design; null: whole), in place. Unfolding pushes down what sits
 *  under it in its column, as a long design always did. -> f */
function setFold(f, id, fold) {
  const s = f.screens.find((x) => x.id === id);
  if (fold && fold < 1) s.fold = Math.round(fold * 1e4) / 1e4;
  else delete s.fold;
  return clearTall(f);
}
/** The fold that shows the top of `s`: up to where its list of repeated items is cut (`cut`, from the dashboard:
 *  the items that fit one screenful, whole), else one phone of it. */
const oneFrame = (s) => { const sh = shotOf(s); return !sh ? null : sh.cut > 0 && sh.cut < 1 ? sh.cut : H / ((sh.h * W) / sh.w); };
function cardOf(s) {
  const n = s.items.length;
  if (shotOf(s)) return { x: 0, y: 0, w: W, h: frameH(s), head: 0, headH: STATUS, top: TOP, step: STEP }; // head: over the status bar
  if (!isOverlay(s))
    return { x: 0, y: 0, w: W, h: H, head: STATUS, headH: HEAD, top: TOP, step: n ? Math.min(STEP, (H - TOP - BOTTOM) / n) : STEP };
  const step = n ? Math.min(STEP, (H * 0.8 - CARD_HEAD - CARD_PAD) / n) : STEP;
  const h = Math.max(s.kind === "toast" ? CARD_HEAD + CARD_PAD : 140, CARD_HEAD + n * step + CARD_PAD);
  // a dialog / toast on a web page is a box of its own width, not the page's; a phone's are unchanged (320 / 342)
  const w = s.kind === "sheet" ? W : s.kind === "popup" ? Math.min(W - 70, 480) : Math.min(W - 48, 360);
  const y = s.kind === "popup" ? (H - h) / 2 : s.kind === "sheet" ? H - h : H - h - 56;
  return { x: (W - w) / 2, y, w, h, head: 0, headH: CARD_HEAD, top: CARD_HEAD, step };
}
/** Row i of a card, relative to the card. */
function rowOf(card, i) {
  return { x: 16, y: card.top + i * card.step, w: card.w - 32, h: card.step - Math.min(12, card.step * 0.22) };
}
const cardAbs = (s, c = cardOf(s)) => ({ x: s.x + c.x, y: s.y + c.y, w: c.w, h: c.h });
/** Each button's box in its card: on the Zeplin image where its label is (`hot`) when that is inside the frame,
 *  else a row stacked at the bottom; without an image, the plain rows. */
function rowsOf(s) {
  const c = cardOf(s), sh = shotOf(s);
  if (!sh) return s.items.map((_, i) => ({ r: rowOf(c, i), hot: false }));
  const { items } = hotspots(s, sh), fh = frameH(s), fold = fh - BOTTOM;
  // on the frame: the area ends inside it. A design 814 high scales to 846, its bottom button a few px past H:
  // FOLD_SLACK keeps it (the home bar overlaps a bottom button by design); past that is the next screenful
  const on = (r) => r && r.y + r.h <= fh + (r.manual ? 0.5 : FOLD_SLACK);
  const off = items.filter((r) => !on(r)).length;
  // the ones not on it are rows at its foot: up to OFF_ROWS, past that the last row stands for the rest ("+k
  // nút"), so a folded list with many buttons below the cut does not stack rows over its whole image
  const own = off > OFF_ROWS ? OFF_ROWS - 1 : off, rows = Math.min(off, OFF_ROWS);
  let n = 0;
  const z = layersOf(items.map((r) => (on(r) ? r : null)));
  return items.map((r, i) => {
    if (on(r)) return { r, hot: true, z: z[i] };
    const k = n++, row = { x: 16, y: fold - (rows - Math.min(k, own)) * 48, w: W - 32, h: 40 };
    return k < own ? { r: row, hot: false } : { r: row, hot: false, more: off - own, lead: k === own };
  });
}
const OFF_ROWS = 3;
/** Full-frame overlays the layout once put over their parent (before they had an image): placed afresh. */
function freeShots(f) {
  for (const s of f.screens) {
    if (s.kind === "screen" || !shotOf(s) || s.x === null) continue;
    if (f.screens.some((o) => o !== s && o.x !== null && Math.abs(o.x - s.x) < W && Math.abs(o.y - s.y) < H)) s.x = s.y = null;
  }
  return f;
}
/** Positions saved when every frame was a phone high: what sits under a long design (same column, inside its
 *  length) moves down with its overlays, top to bottom, so nothing is drawn over the design's lower part. */
function clearTall(f) {
  const tops = f.screens.filter((s) => !isOverlay(s) && s.x !== null && s.y !== null).sort((a, b) => a.y - b.y);
  const by = new Map(f.screens.map((s) => [s.id, s]));
  for (const s of tops) {
    const end = s.y + frameH(s) + ROW - H;
    if (frameH(s) <= H) continue;
    const under = tops.filter((o) => o !== s && o.y > s.y && Math.abs(o.x - s.x) < W);
    const push = Math.max(0, ...under.map((o) => end - o.y));
    if (push) for (const o of under) for (const id of family(f, o.id)) { const m = by.get(id); if (m.y !== null) m.y += push; }
  }
  return f;
}
/** Arrow ends: p (start) with its direction, q (end) on the nearest edge of the target card with that edge's normal. */
function linkEnds(l, by) {
  const a = by.get(scr(l.src)), ca = cardOf(a), A = cardAbs(a, ca), B = cardAbs(by.get(l.to));
  const i = a.items.findIndex((it) => it.id === itm(l.src));
  let p, dir;
  if (i >= 0) {
    const r = rowsOf(a)[i].r;
    p = { x: A.x + r.x + r.w, y: A.y + r.y + r.h / 2 };
    dir = { x: 1, y: 0 };
  } else {
    const left = B.x + B.w / 2 < A.x + A.w / 2;
    p = { x: left ? A.x : A.x + A.w, y: A.y + ca.head + ca.headH / 2 };
    dir = { x: left ? -1 : 1, y: 0 };
  }
  const m = 28, cy = clamp(p.y, B.y + m, B.y + B.h - m), cx = clamp(p.x, B.x + m, B.x + B.w - m);
  if (p.x <= B.x) return { p, dir, q: { x: B.x, y: cy }, n: { x: -1, y: 0 } };
  if (p.x >= B.x + B.w) return { p, dir, q: { x: B.x + B.w, y: cy }, n: { x: 1, y: 0 } };
  if (p.y < B.y) return { p, dir, q: { x: cx, y: B.y }, n: { x: 0, y: -1 } };
  return { p, dir, q: { x: cx, y: B.y + B.h }, n: { x: 0, y: 1 } };
}
const r1 = (v) => Math.round(v * 10) / 10;
/** Cubic bezier path for the ends + its midpoint (label anchor). */
function curve({ p, dir, q, n }) {
  const d = clamp(Math.hypot(q.x - p.x, q.y - p.y) * 0.45, 40, 260);
  const c1 = { x: p.x + dir.x * d, y: p.y + dir.y * d }, c2 = { x: q.x + n.x * d, y: q.y + n.y * d };
  return {
    d: `M${r1(p.x)} ${r1(p.y)}C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(q.x)} ${r1(q.y)}`,
    mid: { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 },
  };
}
const linkText = (l) => {
  const s = [l.when, l.ac].filter(Boolean).join(" · ");
  return s.length > 48 ? s.slice(0, 47) + "…" : s;
};
/** The box around the screens; `tall`: count a long design as at most this many phones high. */
function bounds(screens, tall = Infinity) {
  if (!screens.length) return { x: 0, y: 0, w: W, h: H };
  const xs = screens.map((s) => s.x), ys = screens.map((s) => s.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) + W - x, h: Math.max(...screens.map((s) => s.y + Math.min(frameH(s), tall * H))) - y };
}
/** Camera {x, y, k} (screen = world * k + x / y) that centres box b in a vw × vh view, never above 100%. Past the
 *  minimum zoom the box can't fit: that axis starts at its top / left edge, so the first screen stays in view. */
function fitCam(b, vw, vh) {
  const k = clamp(Math.min((vw - 2 * PAD) / b.w, (vh - 2 * PAD) / b.h), ZMIN, 1);
  const at = (size, view, start) => (size * k <= view - 2 * PAD ? (view - size * k) / 2 : PAD) - start * k;
  return { k, x: at(b.w, vw, b.x), y: at(b.h, vh, b.y) };
}
/** Zoom to k keeping view point (px, py) over the same world point. */
function zoomAt(c, k, px, py) {
  k = clamp(k, ZMIN, ZMAX);
  return { k, x: px - ((px - c.x) * k) / c.k, y: py - ((py - c.y) * k) / c.k };
}

export { frameH, canFold, setFold, oneFrame, cardOf, rowOf, cardAbs, rowsOf, freeShots, clearTall, linkEnds, r1, curve, linkText, bounds, fitCam, zoomAt };
