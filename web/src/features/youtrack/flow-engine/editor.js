import { family, isOverlay } from './model.js';
import { inspector } from './inspector.js';
import { cardAbs } from './geometry.js';
import { shotOf } from './shots.js';
import { CAP, DRAG_PX, H, MAX_ITEMS, MAX_LINKS, MAX_SCREENS, W } from './constants.js';
import { clamp, isPop, itm, scr } from './values.js';
import { box, h } from './dom.js';
import { inlineEdit } from './inline-edit.js';

const nextId = (used, p) => { let n = 1; while (used.has(p + n)) n++; return p + n; };
/** Edit mode: drag an arrow head to retarget it, drag a dot to add a link, drag a title bar to move a screen,
 *  double-click to rename, click to select (Delete removes, the panel changes what the shape cannot show).
 *  It never writes to the flow itself: every change goes through ctx.commit(flow, before), so undo and `dirty`
 *  stay in one place. ctx: {t, insp, cam, view, layer, get, commit, marks, frames, moveScreens, liveLink,
 *  tempLink, drawAll, centre}. */
function editor(ctx) {
  let sel = null; // {t: "screen" | "item" | "link", id?, item?, i?}
  let drawFor = null; // {id, item?}: the next drag on that screen's image draws a tap area (for `item`, or a new one)
  const fieldState = { badVal: null }; // text in a checked field that cannot be stored; kept so the panel can show it again
  let drag = null, raf = 0, at = null; // at: where the pointer is now, painted on the next frame
  const t = ctx.t, get = ctx.get;

  const world = (e, rect) => {
    const c = ctx.cam.get();
    return { x: (e.clientX - rect.left - c.x) / c.k, y: (e.clientY - rect.top - c.y) / c.k };
  };
  /** The screen under a world point; an overlay wins, since it is drawn on top. */
  function hit(p) {
    const on = get().screens.filter((s) => {
      const b = cardAbs(s);
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });
    return on.find(isOverlay) || on[0] || null;
  }

  // ---------------- selection
  const target = (f) => (sel.t === "link" ? f.links[sel.i]
    : sel.t === "item" ? f.screens.find((s) => s.id === sel.id).items.find((i) => i.id === sel.item)
      : f.screens.find((s) => s.id === sel.id));
  function alive(f) {
    if (!sel) return false;
    if (sel.t === "link") return !!f.links[sel.i];
    const s = f.screens.find((x) => x.id === sel.id);
    return !!s && (sel.t !== "item" || s.items.some((i) => i.id === sel.item));
  }
  function node() {
    if (!sel) return null;
    if (sel.t === "link") return ctx.marks()[sel.i]?.path;
    const f = ctx.frames().get(sel.id);
    return sel.t === "item" ? f?.querySelector(`[data-item="${window.CSS.escape(sel.item)}"]`) : f;
  }
  function paint() {
    for (const el of ctx.layer.querySelectorAll(".uf-sel, .uf-drawon")) el.classList.remove("uf-sel", "uf-drawon");
    node()?.classList.add("uf-sel");
    if (drawFor) ctx.frames().get(drawFor.id)?.classList.add("uf-drawon");
  }
  /** Frame units per image fraction for a screen drawn from its Zeplin image (the frame is W wide). */
  const scale = (s) => { const sh = shotOf(s); return sh ? { kw: W, kh: (sh.h * W) / sh.w, sh } : null; };
  const rnd = (v) => Math.round(v * 1e4) / 1e4;
  const MIN_RECT = 12; // frame px: smaller is a slip, not a button
  /** A rect moved / sized by (dx, dy) image fractions, kept on the image and at least MIN_RECT. */
  function shift(r, k, dx, dy, size) {
    const mw = MIN_RECT / k.kw, mh = MIN_RECT / k.kh;
    if (size) {
      const w = rnd(clamp(r.w + dx, mw, 1 - r.x)), hh = rnd(clamp(r.h + dy, mh, 1 - r.y));
      return { x: r.x, y: r.y, w: Math.min(w, 1 - r.x), h: Math.min(hh, 1 - r.y) };
    }
    const x = rnd(clamp(r.x + dx, 0, 1 - r.w)), y = rnd(clamp(r.y + dy, 0, 1 - r.h));
    return { x, y, w: Math.min(r.w, 1 - x), h: Math.min(r.h, 1 - y) };
  }
  const px = (r, k) => ({ x: r.x * k.kw, y: r.y * k.kh, w: r.w * k.kw, h: r.h * k.kh });
  function startDraw(spec) {
    if (blocked()) return;
    drawFor = spec;
    ctx.root.classList.add("uf-drawing");
    paint();
    ctx.view.focus({ preventScroll: true }); // Enter / Esc reach the engine, not the button that started it
    ctx.note(t("drawHint"));
  }
  function stopDraw() {
    if (!drawFor) return false;
    drawFor = null;
    ctx.root.classList.remove("uf-drawing");
    paint();
    return true;
  }
  function select(s) {
    sel = s;
    fieldState.badVal = null; // it belonged to the field that is going away
    paint();
    fill();
  }
  /** After a re-render: drop a selection whose shape is gone, then paint the new nodes. A value that could not
   *  be stored belongs to the edit that is now over (undo included), so it goes too. */
  function sync() {
    fieldState.badVal = null;
    if (!alive(get())) sel = null;
    const ds = drawFor && get().screens.find((x) => x.id === drawFor.id);
    if (drawFor && (!ds || !shotOf(ds) || (drawFor.item && !ds.items.some((i) => i.id === drawFor.item)))) stopDraw();
    paint();
    fill();
  }
  /** Click that was not a drag: pick what is under it. */
  function tap(el) {
    const link = el?.closest?.(".uf-label, .uf-handle"); // the arrow itself is not a target: see .uf-handle
    if (link) return select({ t: "link", i: +link.dataset.i });
    const frame = el?.closest?.(".uf-screen"), item = el?.closest?.(".uf-item");
    if (frame && item) return select({ t: "item", id: frame.dataset.id, item: item.dataset.item });
    select(frame ? { t: "screen", id: frame.dataset.id } : null);
  }

  // ---------------- pointer
  function down(e) {
    const el = e.target;
    if (!ctx.on() || el.closest?.("a, [contenteditable]")) return;
    const frame = el.closest?.(".uf-screen");
    const draw = drawFor && frame?.dataset.id === drawFor.id && !el.closest(".uf-head, .uf-dot");
    const knob = el.closest?.(".uf-handle"), dot = el.closest?.(".uf-dot"), head = el.closest?.(".uf-head");
    const hot = !draw && !dot && el.closest?.(".uf-rect"), rsz = hot && el.closest(".uf-rsz");
    if (!knob && !dot && !head && !hot && !draw) return;
    // A rename or a panel field commits on blur, and mousedown is about to blur it. Do it now, while there is
    // no drag yet, or `commit` would refuse it and the typed value would be lost. Everything read below is read
    // after it, so it comes from the flow that edit produced.
    document.activeElement?.blur();
    e.stopPropagation(); // keep the camera from panning. No preventDefault: it would swallow the renaming dblclick
    const rect = ctx.view.getBoundingClientRect(), f = get();
    at = null;
    drag = { rect, c0: { x: e.clientX, y: e.clientY }, before: JSON.stringify(f), moved: false,
      by: new Map(f.screens.map((x) => [x.id, x])) };
    if (draw || hot) {
      const s = drag.by.get(frame.dataset.id), k = scale(s), p = world(e, rect);
      if (!k) { drag = null; return; }
      if (draw) {
        const box0 = h("div", "uf-item uf-hot uf-rect uf-sel");
        frame.querySelector(".uf-card").append(box0);
        box0.hidden = true;
        Object.assign(drag, { kind: "draw", s, k, el: box0, p0: { x: (p.x - s.x) / k.kw, y: (p.y - s.y) / k.kh }, r: null });
      } else {
        const it = s.items.find((i) => i.id === hot.dataset.item);
        Object.assign(drag, { kind: rsz ? "size" : "rect", s, k, it, el: hot, at: p, r0: { ...it.rect } });
      }
    } else if (knob) Object.assign(drag, { kind: "link", m: ctx.marks()[+knob.dataset.i] });
    else if (dot) Object.assign(drag, { kind: "new", src: dot.dataset.src, from: { x: +dot.dataset.x, y: +dot.dataset.y } });
    else {
      const id = head.closest(".uf-screen").dataset.id, ids = [...family(f, id)];
      const objs = ids.map((i) => drag.by.get(i));
      Object.assign(drag, { kind: "move", id, ids, objs, at: world(e, rect),
        start: new Map(objs.map((s) => [s.id, { x: s.x, y: s.y }])) });
    }
  }
  /** Pointer moves only record where the pointer is; the DOM is written once per animation frame, like the
   *  camera does. Nothing is rebuilt: moved frames get a transform, and only the arrows touching them a new
   *  path (a head drag: one path). */
  function move(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.c0.x, e.clientY - drag.c0.y) <= DRAG_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      // capture only once it really is a drag: a captured pointer would retarget the click, and with it the
      // double-click that renames
      try { ctx.layer.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    }
    at = world(e, drag.rect);
    if (!raf) raf = requestAnimationFrame(paintDrag);
  }
  function paintDrag() {
    raf = 0;
    if (!drag || !at) return;
    if (drag.kind === "move") {
      const dx = at.x - drag.at.x, dy = at.y - drag.at.y;
      for (const s of drag.objs) {
        s.x = Math.round(drag.start.get(s.id).x + dx);
        s.y = Math.round(drag.start.get(s.id).y + dy);
      }
      ctx.moveScreens(drag.ids, drag.by);
    } else if (drag.kind === "rect" || drag.kind === "size") {
      const k = drag.k;
      drag.it.rect = shift(drag.r0, k, (at.x - drag.at.x) / k.kw, (at.y - drag.at.y) / k.kh, drag.kind === "size");
      box(drag.el, px(drag.it.rect, k));
    } else if (drag.kind === "draw") {
      const k = drag.k, a = drag.p0;
      const b = { x: clamp((at.x - drag.s.x) / k.kw, 0, 1), y: clamp((at.y - drag.s.y) / k.kh, 0, 1) };
      const x = rnd(Math.min(a.x, b.x)), y = rnd(Math.min(a.y, b.y));
      drag.r = { x, y, w: Math.min(rnd(Math.abs(a.x - b.x)), 1 - x), h: Math.min(rnd(Math.abs(a.y - b.y)), 1 - y) };
      drag.el.hidden = false;
      box(drag.el, px(drag.r, k));
    } else if (drag.kind === "link") ctx.liveLink(drag.m, at, drag.by);
    else ctx.tempLink(drag.from, at);
  }
  const flush = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    paintDrag();
  };
  function up(e) {
    if (!drag) return;
    flush();
    const d = drag;
    drag = null;
    at = null;
    ctx.tempLink(null);
    if (d.kind === "draw") d.el.remove();
    if (!d.moved) { // a plain click on a handle, a dot or a title bar selects
      if (d.kind === "draw") return;
      if (d.kind === "rect" || d.kind === "size") return select({ t: "item", id: d.s.id, item: d.it.id });
      if (d.kind === "link") return select({ t: "link", i: d.m.i });
      if (d.kind === "move") return select({ t: "screen", id: d.id });
      return select(d.src.includes(".") ? { t: "item", id: scr(d.src), item: itm(d.src) } : { t: "screen", id: d.src });
    }
    if (d.kind === "draw") return drawn(d);
    const f = get(), to = hit(world(e, d.rect));
    if (d.kind === "rect" || d.kind === "size") sel = { t: "item", id: d.s.id, item: d.it.id }; // keys nudge it next
    if (d.kind === "move" || d.kind === "rect" || d.kind === "size") return ctx.commit(f, d.before);
    if (d.kind === "link") {
      if (to && to.id !== f.links[d.m.i].to) {
        f.links[d.m.i] = { ...f.links[d.m.i], to: to.id };
        return ctx.commit(f, d.before);
      }
      return back(); // dropped on nothing: the arrow snaps back
    }
    if (to && f.links.length >= MAX_LINKS) ctx.note(t("maxLinks", { n: MAX_LINKS }));
    else if (to && to.id !== d.src && !f.links.some((l) => l.src === d.src && l.to === to.id)) {
      f.links.push({ src: d.src, to: to.id, act: isPop(to) ? "open" : "navigate", when: "", ac: "" });
      return ctx.commit(f, d.before);
    }
    back();
  }
  /** A finished draw: the tap area of the item it was for, or a new button with it. One undo step. */
  function drawn(d) {
    const r = d.r, spec = drawFor;
    if (!r || !spec || r.w * d.k.kw < MIN_RECT || r.h * d.k.kh < MIN_RECT) return; // a slip: still drawing
    const f = structuredClone(get()), s = f.screens.find((x) => x.id === spec.id);
    let item = spec.item && s.items.find((i) => i.id === spec.item);
    if (!item) {
      if (s.items.length >= MAX_ITEMS) return ctx.note(t("maxItems", { n: MAX_ITEMS }));
      item = { id: nextId(new Set(s.items.map((i) => i.id)), "i"), label: t("newItem") };
      s.items.push(item);
    }
    item.rect = r;
    drawFor = null;
    ctx.root.classList.remove("uf-drawing");
    sel = { t: "item", id: s.id, item: item.id };
    ctx.commit(f);
  }
  /** Enter while drawing: a default area mid-screen (then the numbers / arrow keys place it), no pointer needed. */
  function drawDefault() {
    if (!drawFor || blocked()) return false;
    const s = get().screens.find((x) => x.id === drawFor.id), k = s && scale(s);
    if (!k) return false;
    const w = 0.6, hh = rnd(Math.min(48 / k.kh, 1)), y = rnd(clamp((H / 2) / k.kh - hh / 2, 0, 1 - hh));
    drawn({ r: { x: 0.2, y, w, h: hh }, k });
    return true;
  }
  /** Arrow keys: the selected screen (with its overlays) or tap area moves by (dx, dy) frame px. */
  function nudge(dx, dy) {
    if (!sel || sel.t === "link" || blocked()) return false;
    const f = structuredClone(get()), s = f.screens.find((x) => x.id === sel.id);
    if (sel.t === "screen") {
      for (const id of family(f, s.id)) {
        const o = f.screens.find((x) => x.id === id);
        o.x += dx;
        o.y += dy;
      }
    } else {
      const it = s.items.find((i) => i.id === sel.item), k = scale(s);
      if (!it.rect || !k) return false;
      it.rect = shift(it.rect, k, dx / k.kw, dy / k.kh, false);
    }
    ctx.commit(f, undefined, `nudge:${sel.t}:${sel.id}:${sel.item ?? ""}`);
    return true;
  }
  /** Every screen laid out afresh by the code layout: one undo step. */
  function relayout() {
    if (blocked()) return;
    const f = structuredClone(get());
    for (const s of f.screens) s.x = s.y = null;
    ctx.commit(f);
  }
  /** Redraw the arrows as the flow still has them, keeping what was selected selected. */
  function back() {
    ctx.drawAll();
    sync();
  }
  function dbl(e) {
    const el = ctx.on() ? e.target.closest?.(".uf-title, .uf-item, .uf-label") : null;
    if (!el || !ctx.layer.contains(el)) return;
    e.preventDefault();
    const frame = el.closest(".uf-screen");
    const kind = el.classList.contains("uf-label") ? "link" : el.classList.contains("uf-item") ? "item" : "screen";
    const f0 = get(), link = kind === "link" ? f0.links[+el.dataset.i] : null;
    inlineEdit(el, CAP, (val) => {
      ctx.view.focus({ preventScroll: true }); // leaving the text box must not drop focus out of the engine
      if (val === null) return;
      const f = structuredClone(get());
      if (kind === "link") f.links[+el.dataset.i].when = val;
      else {
        const s = f.screens.find((x) => x.id === frame.dataset.id);
        if (kind === "item") s.items.find((i) => i.id === el.dataset.item).label = val;
        else s.title = val;
      }
      ctx.commit(f);
    }, link ? link.when : null);
  }

  const { fill, change } = inspector({ ctx, t, get, target, blocked, scale, rnd,
    select, selected: () => sel, startDraw, addItem, remove, fieldState });

  // ---------------- add / remove
  /** True (and says why) when a gesture is in flight: `commit` would refuse, so change nothing at all. */
  function blocked() {
    if (!drag) return false;
    ctx.note(t("dragging"));
    return true;
  }
  /** A new screen at the centre of the view (`props`: title / zeplin); its id, or null when refused. */
  function addScreen(props = {}) {
    if (blocked()) return null;
    const f = structuredClone(get()), c = ctx.centre();
    if (f.screens.length >= MAX_SCREENS) { ctx.note(t("maxScreens", { n: MAX_SCREENS })); return null; }
    const id = nextId(new Set(f.screens.map((s) => s.id)), "s");
    f.screens.push({ id, title: t("newScreen"), kind: "screen", parent: null, x: Math.round(c.x - W / 2),
      y: Math.round(c.y - H / 2), zeplin: "", ac: "", note: "", items: [], ...props });
    sel = { t: "screen", id };
    ctx.commit(f);
    return id;
  }
  function addItem() {
    if (sel?.t !== "screen" || blocked()) return;
    if (target(get()).items.length >= MAX_ITEMS) return ctx.note(t("maxItems", { n: MAX_ITEMS }));
    change((s) => s.items.push({ id: nextId(new Set(s.items.map((i) => i.id)), "i"), label: t("newItem") }));
  }
  /** Delete what is selected: a screen takes its overlays and every arrow touching them. */
  function remove() {
    if (!sel || blocked()) return;
    const f = structuredClone(get());
    if (sel.t === "link") f.links.splice(sel.i, 1);
    else if (sel.t === "item") {
      const s = f.screens.find((x) => x.id === sel.id);
      s.items = s.items.filter((i) => i.id !== sel.item);
      f.links = f.links.filter((l) => l.src !== `${sel.id}.${sel.item}`);
    } else {
      const gone = family(f, sel.id);
      f.screens = f.screens.filter((s) => !gone.has(s.id));
      if (!f.screens.length) return ctx.note(t("lastScreen")); // the backend refuses a flow with no screen
      f.links = f.links.filter((l) => !gone.has(scr(l.src)) && !gone.has(l.to));
    }
    sel = null;
    ctx.commit(f);
  }

  function cancel() {
    cancelAnimationFrame(raf);
    raf = 0;
    const d = drag;
    drag = null;
    at = null;
    ctx.tempLink(null);
    if (!d) return;
    if (d.kind === "move") {
      for (const s of d.objs) Object.assign(s, d.start.get(s.id));
      ctx.moveScreens(d.ids, d.by);
    } else if (d.kind === "rect" || d.kind === "size") {
      d.it.rect = d.r0;
      box(d.el, px(d.r0, d.k));
    } else if (d.kind === "draw") d.el.remove();
    back();
  }
  ctx.layer.addEventListener("pointerdown", down);
  ctx.layer.addEventListener("pointermove", move);
  ctx.layer.addEventListener("pointerup", up);
  ctx.layer.addEventListener("pointercancel", cancel);
  ctx.layer.addEventListener("dblclick", dbl);
  return {
    tap,
    addScreen,
    remove,
    nudge,
    relayout,
    stopDraw,
    drawDefault,
    pick: (x) => select(x),
    selected: () => sel,
    busy: () => !!drag, // a flow change mid-gesture would strand the objects and frames the drag holds
    cancel,
    clear: () => { stopDraw(); select(null); },
    /** After a re-render: drop a selection whose shape is gone, then paint the new nodes. */
    sync,
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}

export { nextId, editor };
