import { shotOf } from './shots.js';
import { ACTS, CAP_NOTE, CAP_TITLE, KINDS, MAX_MEMOS, VERSION, setDevice } from './constants.js';
import { itm, num, rectOf, scr, str } from './values.js';

/** Shown as a card over its parent. A popup / sheet / toast with a Zeplin image is a full frame instead (the
 *  design draws its own scrim), laid out like a screen; it still opens as an overlay in Prototype (`isPop`). */
const isOverlay = (s) => s.kind !== "screen" && !shotOf(s);
/** A fresh, well-formed copy: known kinds / acts, string labels, one screen / button per id, and ONLY Flow-schema
 *  fields — a hand-edited file's extras are dropped here, so what "Lưu file" writes matches what the backend model
 *  accepts (an older file's `pending` / `acs` included). */
function sanitize(raw) {
  const f = raw && typeof raw === "object" ? raw : {};
  // never edit a newer file: saving it would drop the fields this engine does not know
  if (Number.isFinite(f.v) && f.v > VERSION) throw new Error(`UI flow v${f.v} > v${VERSION}`);
  const device = setDevice(f.device); // every read of a flow goes through here: the frame is the one of the flow in hand
  const seen = new Set(), screens = [];
  for (const s of Array.isArray(f.screens) ? f.screens : []) {
    if (!s || typeof s.id !== "string" || seen.has(s.id)) continue;
    seen.add(s.id);
    const ids = new Set(), items = [];
    for (const it of Array.isArray(s.items) ? s.items : []) {
      if (!it || typeof it.id !== "string" || ids.has(it.id)) continue;
      ids.add(it.id);
      const r = rectOf(it.rect);
      items.push(r ? { id: it.id, label: str(it.label, it.id), rect: r } : { id: it.id, label: str(it.label, it.id) });
    }
    screens.push({ id: s.id, title: str(s.title, s.id) || s.id, kind: KINDS.includes(s.kind) ? s.kind : "screen",
      parent: typeof s.parent === "string" ? s.parent : null, x: num(s.x), y: num(s.y),
      zeplin: str(s.zeplin), ac: str(s.ac), note: str(s.note).slice(0, CAP_NOTE), items,
      ...(Number.isFinite(s.fold) && s.fold > 0 && s.fold < 1 ? { fold: s.fold } : {}) }); // folded on the map (= Screen.fold)
  }
  const by = new Map(screens.map((s) => [s.id, s]));
  const okSrc = (src) => {
    const s = typeof src === "string" && by.get(scr(src));
    return !!s && (itm(src) === null || s.items.some((it) => it.id === itm(src)));
  };
  const all = Array.isArray(f.links) ? f.links : [];
  const links = all.filter((l) => l && okSrc(l.src) && by.has(l.to))
    .map((l) => ({ src: l.src, to: l.to, act: ACTS.includes(l.act) ? l.act : "navigate", when: str(l.when), ac: str(l.ac) }));
  // v, device and rev are literals / an int in the backend model: anything else would make the file unreadable
  // (device: "mobile" | "web", anything else is a phone)
  const rev = Number.isFinite(f.rev) && f.rev > 0 ? Math.trunc(f.rev) : 0;
  const start = typeof f.start === "string" && by.has(f.start) ? f.start : null;
  // notes on the map (= Flow.memos): one with no place or a repeated id is dropped, as the backend does
  const mids = new Set(), memos = [];
  for (const m of Array.isArray(f.memos) ? f.memos : []) {
    if (!m || typeof m.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(m.id) || mids.has(m.id) || num(m.x) === null || num(m.y) === null) continue;
    mids.add(m.id);
    // its box: the size drawn (= Memo.w / h), else the default; folded to its bar only when it says so
    const size = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    memos.push({ id: m.id, x: m.x, y: m.y, w: size(m.w, 160, 1600, 320), h: size(m.h, 80, 4000, 160), text: str(m.text).slice(0, CAP_NOTE),
      ...(m.fold === true ? { fold: true } : {}) });
  }
  const title = str(f.title).replace(/\s+/g, " ").trim().slice(0, CAP_TITLE); // its own name (= Flow.title); none: ""
  return { v: VERSION, ticket: str(f.ticket), ...(title ? { title } : {}), rev, device, start, screens, links,
    ...(memos.length ? { memos: memos.slice(0, MAX_MEMOS) } : {}) };
}
/** id -> the screen an overlay sits on: its declared parent, else the screen whose `open` link targets it; null
 *  for screens and for overlays nothing opens. One rule for layout and focus. */
function parents(f) {
  const by = new Map(f.screens.map((s) => [s.id, s]));
  const parentOf = (s) => {
    if (!isOverlay(s)) return null;
    if (s.parent && s.parent !== s.id && by.has(s.parent)) return s.parent;
    const l = f.links.find((l) => l.to === s.id && l.act === "open" && scr(l.src) !== s.id);
    return l ? scr(l.src) : null;
  };
  return new Map(f.screens.map((s) => [s.id, parentOf(s)]));
}

/** id plus every overlay hanging off it (a popup of a popup too). */
function family(f, id) {
  const par = parents(f), out = new Set([id]);
  for (let n = 0; n < 20; n++) {
    const was = out.size;
    for (const [k, p] of par) if (p && out.has(p)) out.add(k);
    if (out.size === was) break;
  }
  return out;
}

/** Screen `id` of `f` becomes `kind`, in place, and its arrows keep meaning what they did: into it "navigate" ↔
 *  "open", from it "back" ↔ "close" — only those carrying the old kind's default, a condition / AC stays. A popup
 *  gets the screen under it (the first one that opens it) when it has none; a screen has none. -> f */
function rekind(f, id, kind) {
  const s = f.screens.find((x) => x.id === id), was = s.kind !== "screen", now = kind !== "screen";
  s.kind = kind;
  if (!now) s.parent = null;
  if (was === now) return f;
  const [inOld, inNew] = now ? ["navigate", "open"] : ["open", "navigate"], [outOld, outNew] = now ? ["back", "close"] : ["close", "back"];
  for (const l of f.links) {
    if (l.to === id && l.act === inOld) l.act = inNew;
    if (scr(l.src) === id && l.act === outOld) l.act = outNew;
  }
  if (now && !s.parent) s.parent = scr(f.links.find((l) => l.to === id && l.act === "open" && scr(l.src) !== id)?.src ?? "") || null;
  return f;
}
export { rekind, isOverlay, sanitize, parents, family };
