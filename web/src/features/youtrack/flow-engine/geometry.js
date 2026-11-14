import { hotspots, shotOf } from './shots.js';
import { BOTTOM, CARD_HEAD, CARD_PAD, H, HEAD, PAD, STATUS, STEP, TOP, W, ZMAX, ZMIN } from './constants.js';
import { isOverlay } from './model.js';
import { clamp, itm, scr } from './values.js';

// ------------------------------------------------------------------ geometry (pure, canvas units)
/** The visible card inside a 390 × 844 frame: the whole phone for a screen, a dialog / sheet / toast otherwise.
 *  head / headH: the title bar; top / step: where item rows start and their pitch. */
function cardOf(s) {
  const n = s.items.length;
  if (shotOf(s)) return { x: 0, y: 0, w: W, h: H, head: 0, headH: STATUS, top: TOP, step: STEP }; // head: over the status bar
  if (!isOverlay(s))
    return { x: 0, y: 0, w: W, h: H, head: STATUS, headH: HEAD, top: TOP, step: n ? Math.min(STEP, (H - TOP - BOTTOM) / n) : STEP };
  const step = n ? Math.min(STEP, (H * 0.8 - CARD_HEAD - CARD_PAD) / n) : STEP;
  const h = Math.max(s.kind === "toast" ? CARD_HEAD + CARD_PAD : 140, CARD_HEAD + n * step + CARD_PAD);
  const w = s.kind === "sheet" ? W : s.kind === "popup" ? W - 70 : W - 48;
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
  const { items } = hotspots(s, sh), fold = H - BOTTOM;
  const off = items.filter((r) => !r || r.y + r.h > (r.manual ? H + 0.5 : fold)).length;
  let n = 0;
  // a hand-drawn area may sit over the home bar (the user put it there); a text match there is the next screenful
  return items.map((r) => (r && r.y + r.h <= (r.manual ? H + 0.5 : fold) ? { r, hot: true }
    : { r: { x: 16, y: fold - (off - n++) * 48, w: W - 32, h: 40 }, hot: false }));
}
/** Full-frame overlays the layout once put over their parent (before they had an image): placed afresh. */
function freeShots(f) {
  for (const s of f.screens) {
    if (s.kind === "screen" || !shotOf(s) || s.x === null) continue;
    if (f.screens.some((o) => o !== s && o.x !== null && Math.abs(o.x - s.x) < W && Math.abs(o.y - s.y) < H)) s.x = s.y = null;
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
function bounds(screens) {
  if (!screens.length) return { x: 0, y: 0, w: W, h: H };
  const xs = screens.map((s) => s.x), ys = screens.map((s) => s.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) + W - x, h: Math.max(...ys) + H - y };
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

export { cardOf, rowOf, cardAbs, rowsOf, freeShots, linkEnds, r1, curve, linkText, bounds, fitCam, zoomAt };
