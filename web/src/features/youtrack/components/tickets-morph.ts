import { useLayoutEffect, useRef } from "react";

// Bảng ↔ Board: every ticket on screen flies from its row to its card (or back) in a floating copy above the page (the scroll areas
// would clip it), the box reshaping on the way while the two looks crossfade. The real item stays hidden until its copy lands.
export type Snap = Map<string, { r: DOMRect; look: HTMLElement; radius: string; shadow: string }>;
const MORPH_MAX = 60; // ponytail: only the first 60 visible items fly, the rest fade in with the view
const itemsOf = (root: HTMLElement) => root.querySelectorAll<HTMLElement>("tr[data-id], [data-card] > button");
const keyOf = (el: HTMLElement) => el.dataset.id ?? el.parentElement!.dataset.card!;

/** Is some of el's box on screen, not clipped by a scroll area between it and root? */
function seen(el: HTMLElement, r: DOMRect, root: HTMLElement) {
  let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom), left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    if (getComputedStyle(p).overflow === "visible") continue;
    const c = p.getBoundingClientRect();
    top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); left = Math.max(left, c.left); right = Math.min(right, c.right);
  }
  return bottom - top > 4 && right - left > 4;
}

/** A detached copy of the item; a row keeps its cell widths inside a table of its own. */
function lookOf(el: HTMLElement, w: number) {
  const c = el.cloneNode(true) as HTMLElement;
  let out = c;
  if (el.tagName === "TR") {
    [...el.children].forEach((td, k) => { (c.children[k] as HTMLElement).style.width = `${td.getBoundingClientRect().width}px`; });
    out = document.createElement("table");
    out.className = "border-collapse text-sm";
    out.style.tableLayout = "fixed";
    out.append(document.createElement("tbody"));
    out.firstChild!.appendChild(c);
  }
  Object.assign(out.style, { position: "absolute", left: "0", top: "0", margin: "0", width: `${w}px`, visibility: "visible" });
  return out;
}

export function grab(root: HTMLElement): Snap {
  const m: Snap = new Map();
  for (const el of itemsOf(root)) {
    const r = el.getBoundingClientRect();
    if (!seen(el, r, root)) continue;
    const cs = getComputedStyle(el);
    m.set(keyOf(el), { r, look: lookOf(el, r.width), radius: cs.borderRadius, shadow: cs.boxShadow });
    if (m.size >= MORPH_MAX) break;
  }
  return m;
}

/** Fly each snapped item to its new place; returns the cleanup. */
export function morph(snap: Snap, root: HTMLElement) {
  // fast off the mark, slowing into its place (the look's --ease-out: springy under Vivid)
  const ease = getComputedStyle(root).getPropertyValue("--ease-out").trim() || "cubic-bezier(0.16, 1, 0.3, 1)", dur = 600;
  const runs: Animation[] = [], ghosts: HTMLElement[] = [], hid: HTMLElement[] = [];
  root.querySelector<HTMLElement>("[data-view]")?.animate({ opacity: [0, 1] }, { duration: 320, easing: ease });
  let k = 0;
  for (const el of itemsOf(root)) {
    const s = snap.get(keyOf(el));
    if (!s) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), to = lookOf(el, r.width);
    const g = document.createElement("div");
    g.style.cssText = "position:fixed;left:0;top:0;z-index:60;pointer-events:none;overflow:hidden;background:var(--color-cotton)";
    g.append(s.look, to);
    document.body.append(g);
    ghosts.push(g);
    el.style.visibility = "hidden";
    hid.push(el);
    const box = (b: DOMRect, radius: string, shadow: string, opacity: number) =>
      ({ transform: `translate(${b.left}px, ${b.top}px)`, width: `${b.width}px`, height: `${b.height}px`, borderRadius: radius, boxShadow: shadow, opacity });
    const o = { duration: dur, delay: Math.min(k++ * 16, 240), easing: ease, fill: "both" as const };
    runs.push(
      g.animate([box(s.r, s.radius, s.shadow, 1), box(r, cs.borderRadius, cs.boxShadow, seen(el, r, root) ? 1 : 0)], o),
      s.look.animate({ opacity: [1, 0] }, { ...o, duration: dur * 0.55 }),
      to.animate({ opacity: [0, 1] }, { ...o, delay: o.delay + dur * 0.2, duration: dur * 0.6 }),
    );
  }
  let over = false;
  const done = () => {
    if (over) return;
    over = true;
    runs.forEach((a) => a.cancel());
    ghosts.forEach((g) => g.remove());
    hid.forEach((e) => { e.style.visibility = ""; });
  };
  void Promise.all(runs.map((a) => a.finished)).then(done, () => {});
  return done;
}

// Filter / sort / fold: rows and cards that stay glide from their old place to the new one (FLIP), new ones rise in. Places are
// offsetTop inside the table / lane, so scrolling between renders doesn't skew them; a far jump starts one screen away, not miles off.
const FLIP_ITEMS = "tr[data-id], tr[data-g], [data-card]";
const flipKey = (el: HTMLElement) => el.dataset.id ?? el.dataset.g ?? el.dataset.card!;
export function useFlip(root: React.RefObject<HTMLElement | null>, deps: unknown[], still: boolean | null) {
  const last = useRef(new Map<string, { top: number; parent: Element | null }>());
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const box = root.current;
    if (!mounted.current || still || !box) { mounted.current = true; return; }
    const prev = last.current, runs: Animation[] = [];
    const ease = getComputedStyle(box).getPropertyValue("--ease-out").trim() || "ease-out";
    let moved = 0, born = 0;
    for (const el of box.querySelectorAll<HTMLElement>(FLIP_ITEMS)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue; // off screen: nothing to see
      const p = prev.get(flipKey(el));
      if (p && el.dataset.g != null) continue; // a sticky group header: its offsets follow the scroll, it only fades in when new
      if (!p || p.parent !== el.offsetParent) {
        runs.push(el.animate({ opacity: [0, 1], transform: ["translateY(12px)", "none"] }, { duration: 380, delay: Math.min(born++ * 22, 260), easing: ease, fill: "backwards" }));
        continue;
      }
      const dy = Math.max(-innerHeight, Math.min(innerHeight, p.top - el.offsetTop));
      if (Math.abs(dy) < 1) continue;
      runs.push(el.animate({ transform: [`translateY(${dy}px)`, "none"] }, { duration: 520, delay: Math.min(moved++ * 12, 180), easing: ease, fill: "backwards" }));
    }
    return () => runs.forEach((a) => a.cancel());
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  // after every commit: where each item sits now, the "before" of the next change
  useLayoutEffect(() => {
    const m = new Map<string, { top: number; parent: Element | null }>();
    for (const el of root.current?.querySelectorAll<HTMLElement>(FLIP_ITEMS) ?? []) m.set(flipKey(el), { top: el.offsetTop, parent: el.offsetParent });
    last.current = m;
  });
}
