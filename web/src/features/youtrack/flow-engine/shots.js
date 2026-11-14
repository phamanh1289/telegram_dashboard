import { str } from './values.js';
import { W } from './constants.js';

// ------------------------------------------------------------------ Zeplin images (shots)
// {zeplin url: {src, w, h, hits: [[label, x, y, w, h]]}} in design units, from the dashboard (or the file's own
// block). Kept out of the flow: undo / dirty compare the flow as JSON, and images would make that heavy.
// ponytail: one set per page (the dashboard shows one flow at a time); a map per mount if two ever share a page
let SHOTS = {};
const hotCache = new Map();
// "url \n labels" -> {items, back}; cleared with SHOTS
const shotOf = (s) => (s.zeplin && SHOTS[s.zeplin]) || null;
const norm = (v) => str(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const BACK = /(^| )(back|quay lai|tro lai|tro ve)( |$)/;
function setShots(map) {
  SHOTS = map && typeof map === "object" ? map : {};
  hotCache.clear();
}
/** Where each button of `s` sits on its Zeplin image (frame units; null: label not found) and the back button:
 *  its hand-drawn rect, else same text first, then one containing the other; each hit used once, in reading order. */
function hotspots(s, sh) {
  const key = s.zeplin + "\n" + s.items.map((i) => i.label + (i.rect ? JSON.stringify(i.rect) : "")).join("\n");
  let got = hotCache.get(key);
  if (got) return got;
  const k = W / sh.w, hits = Array.isArray(sh.hits) ? sh.hits : [], ns = hits.map((x) => norm(x[0])), used = new Set();
  const at = (j) => {
    const [, x, y, w, hh] = hits[j];
    return { x: x * k, y: y * k, w: Math.max(w * k, 24), h: Math.max(hh * k, 24) };
  };
  // best tier wins: same text, the text starts with the label ("Tìm căn hộ" + its subtitle), contains it, is
  // contained in it; within a tier, the order the server sent (buttons before titles, reading order)
  const tiers = [(x, n) => x === n, (x, n) => x.startsWith(n + " "), (x, n) => x.includes(n), (x, n) => x.length >= 3 && n.includes(x)];
  const find = (label) => {
    const n = norm(label);
    if (!n) return -1;
    for (const [i, ok] of tiers.entries()) {
      if (i > 0 && n.length < 3) return -1;
      const j = ns.findIndex((x, k) => !used.has(k) && ok(x, n));
      if (j >= 0) return j;
    }
    return -1;
  };
  const kw = W, kh = (sh.h * W) / sh.w; // a rect is a fraction of the whole image; the frame is W wide
  const items = s.items.map((it) => {
    if (it.rect) return { x: it.rect.x * kw, y: it.rect.y * kh, w: it.rect.w * kw, h: it.rect.h * kh, manual: true };
    const j = find(it.label);
    if (j < 0) return null;
    used.add(j);
    return at(j);
  });
  const b = ns.findIndex((x, i) => !used.has(i) && BACK.test(x));
  got = { items, back: b >= 0 ? at(b) : null };
  hotCache.set(key, got);
  return got;
}

export { SHOTS, hotCache, shotOf, norm, BACK, setShots, hotspots };
