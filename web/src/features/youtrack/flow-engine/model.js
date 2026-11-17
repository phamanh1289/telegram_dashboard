import { shotOf } from './shots.js';
import { ACTS, CAP_NOTE, KINDS, VERSION, setDevice } from './constants.js';
import { itm, num, rectOf, scr, str } from './values.js';

/** Shown as a card over its parent. A popup / sheet / toast with a Zeplin image is a full frame instead (the
 *  design draws its own scrim), laid out like a screen; it still opens as an overlay in Prototype (`isPop`). */
const isOverlay = (s) => s.kind !== "screen" && !shotOf(s);
/** A fresh, well-formed copy plus what had to go: {flow, dropped: {screens: [dup id], items: ["s.i"], links: n,
 *  bad: n}}. Known kinds / acts, string labels, and ONLY Flow-schema fields — a hand-edited file's extras are
 *  dropped here, so what "Lưu file" writes matches what the backend model accepts. */
function sanitize(raw) {
  const f = raw && typeof raw === "object" ? raw : {};
  // never edit a newer file: saving it would drop the fields this engine does not know
  if (Number.isFinite(f.v) && f.v > VERSION) throw new Error(`UI flow v${f.v} > v${VERSION}`);
  const device = setDevice(f.device); // every read of a flow goes through here: the frame is the one of the flow in hand
  const dropped = { screens: [], items: [], links: 0, bad: 0 };
  const seen = new Set(), screens = [];
  for (const s of Array.isArray(f.screens) ? f.screens : []) {
    if (!s || typeof s.id !== "string") { dropped.bad++; continue; }
    if (seen.has(s.id)) { dropped.screens.push(s.id); continue; }
    seen.add(s.id);
    const ids = new Set(), items = [];
    for (const it of Array.isArray(s.items) ? s.items : []) {
      if (!it || typeof it.id !== "string") { dropped.bad++; continue; }
      if (ids.has(it.id)) { dropped.items.push(`${s.id}.${it.id}`); continue; }
      ids.add(it.id);
      const r = rectOf(it.rect);
      items.push(r ? { id: it.id, label: str(it.label, it.id), rect: r } : { id: it.id, label: str(it.label, it.id) });
    }
    screens.push({ id: s.id, title: str(s.title, s.id) || s.id, kind: KINDS.includes(s.kind) ? s.kind : "screen",
      parent: typeof s.parent === "string" ? s.parent : null, x: num(s.x), y: num(s.y),
      zeplin: str(s.zeplin), ac: str(s.ac), note: str(s.note).slice(0, CAP_NOTE), items });
  }
  const by = new Map(screens.map((s) => [s.id, s]));
  const okSrc = (src) => {
    const s = typeof src === "string" && by.get(scr(src));
    return !!s && (itm(src) === null || s.items.some((it) => it.id === itm(src)));
  };
  const all = Array.isArray(f.links) ? f.links : [];
  const links = all.filter((l) => l && okSrc(l.src) && by.has(l.to))
    .map((l) => ({ src: l.src, to: l.to, act: ACTS.includes(l.act) ? l.act : "navigate", when: str(l.when), ac: str(l.ac) }));
  dropped.links = all.length - links.length;
  // v, device and rev are literals / an int in the backend model: anything else would make the file unreadable
  // (device: "mobile" | "web", anything else is a phone)
  const rev = Number.isFinite(f.rev) && f.rev > 0 ? Math.trunc(f.rev) : 0;
  const start = typeof f.start === "string" && by.has(f.start) ? f.start : null;
  // steps the ticket describes that have no design yet (= Pending in the backend model): listed, never drawn.
  // The key is only written when there are some, so a flow without them keeps its old shape.
  const titles = new Set(), pending = [];
  for (const p of Array.isArray(f.pending) ? f.pending : []) {
    const title = p && typeof p === "object" ? str(p.title).trim() : "", key = title.toLowerCase().replace(/\s+/g, " ");
    if (!title || titles.has(key)) continue;
    titles.add(key);
    pending.push({ title, kind: KINDS.includes(p.kind) ? p.kind : "screen", ac: str(p.ac), src: okSrc(p.src) ? p.src : "",
      when: str(p.when) });
  }
  // the ticket's AC codes, read at the last render (= Flow.acs): kept as they are, the editor never changes them
  const acs = [...new Set((Array.isArray(f.acs) ? f.acs : []).filter((x) => typeof x === "string" && /^AC\d{1,3}(\.\d{1,3}){0,3}$/.test(x)))];
  return { flow: { v: VERSION, ticket: str(f.ticket), rev, device, start, screens, links,
    ...(pending.length ? { pending } : {}), ...(acs.length ? { acs } : {}) }, dropped };
}
const normalize = (raw) => sanitize(raw).flow;
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

export { isOverlay, sanitize, normalize, parents, family };
