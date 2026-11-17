import { CAP_NOTE, DRAG_PX, MAX_MEMOS } from './constants.js';
import { box, h, ibtn, placeFrame } from './dom.js';
import { clamp } from './values.js';

// = Memo in backend/telegram_dashboard/youtrack/flow.py: a click without a drag makes a note of the default size
const WIDE = 320, TALL = 160, MIN_W = 160, MAX_W = 1600, MIN_H = 80, MAX_H = 4000;
const nextId = (used) => { let n = 1; while (used.has("m" + n)) n++; return "m" + n; };

/** Notes on the map (flow.memos: {id, x, y, w, h, text, fold?}): a caution, an idea to improve the feature, beside
 *  the screens. "+ Ghi chú" arms drawing: the cursor turns to a crosshair, a hint says to drag a box on the map, the
 *  box is the note (a click: one of the default size); Esc or the button again calls it off. While editing: type in
 *  it (kept on blur, Esc puts back what was stored), drag its bar to move it, its corner to size it, ✕ removes it, the chevron folds it to
 *  its bar (saved with the file). Read-only otherwise, where the chevron folds it for this view only. Every change is
 *  one undo step through ctx.commit. ctx: {t, cam, view, root, get, commit, say(text, stay), editing(), button()}. */
function memos(ctx) {
  const t = ctx.t;
  const el = h("div", "uf-pins");
  let shown = new Map(); // id -> {key, node}
  let pad = null; // the drawing surface while armed
  const change = (fn) => { const f = structuredClone(ctx.get()); fn(f); ctx.commit(f); };
  const fit = (a) => { a.style.height = "auto"; a.style.height = a.scrollHeight + "px"; };
  const world = (e) => {
    const r = ctx.view.getBoundingClientRect(), c = ctx.cam.get();
    return { x: (e.clientX - r.left - c.x) / c.k, y: (e.clientY - r.top - c.y) / c.k };
  };

  function build(m, editing) {
    const node = h("div", "uf-pin" + (m.fold ? " uf-pinfold" : "")), bar = h("div", "uf-pinbar");
    node.dataset.memo = m.id;
    // folded: the bar names it by its first line, so a row of folded notes still says what each one is
    const first = m.text.trim().split("\n")[0];
    const name = h("span", "uf-pinname", m.fold && first ? first : t("memo"));
    let a = null; // the text box while editing
    const tog = ibtn(m.fold ? "down" : "up", t(m.fold ? "memoOpen" : "memoFold"), "uf-btn uf-pintog", () => {
      if (editing) return change((f) => { // the text being typed goes with it: one step
        const x = f.memos.find((y) => y.id === m.id);
        if (a) x.text = a.value.slice(0, CAP_NOTE);
        if (x.fold) delete x.fold; else x.fold = true;
      });
      const on = node.classList.toggle("uf-pinfold"); // reading: this view only, the file is not changed
      name.textContent = on && first ? first : t("memo");
      node.style.minHeight = on ? "" : m.h + "px";
      tog.setAttribute("aria-expanded", String(!on));
      tog.setAttribute("aria-label", t(on ? "memoOpen" : "memoFold"));
    });
    tog.setAttribute("aria-expanded", String(!m.fold));
    bar.append(name, tog);
    node.append(bar);
    node.addEventListener("pointerdown", (e) => { if (editing || tog.contains(e.target)) e.stopPropagation(); }); // typing never pans
    if (!editing) {
      node.append(h("div", "uf-pintext", m.text)); // textContent: never parsed
      return node;
    }
    const del = ibtn("x", t("memoDel"), "uf-btn uf-pindel", () => change((f) => { f.memos = f.memos.filter((x) => x.id !== m.id); }));
    bar.append(del);
    a = h("textarea", "uf-pintext");
    a.maxLength = CAP_NOTE;
    a.value = m.text;
    a.placeholder = t("memoHint");
    a.setAttribute("aria-label", t("memo"));
    a.addEventListener("input", () => fit(a));
    a.addEventListener("keydown", (e) => {
      e.stopPropagation(); // Delete / ⌘Z are the text's here, not the map's
      if (e.key === "Escape") { e.preventDefault(); a.value = m.text; a.blur(); }
    });
    a.addEventListener("change", () => change((f) => { const x = f.memos.find((y) => y.id === m.id); if (x) x.text = a.value.slice(0, CAP_NOTE); }));
    const grip = h("div", "uf-pinrsz"); // the corner: drag to size the note (ponytail: pointer only, no keyboard way)
    grip.setAttribute("aria-hidden", "true");
    grip.addEventListener("pointerdown", (e) => resize(e, m.id));
    node.append(a, grip);
    // the bar's buttons keep the text focused: its blur would commit and redraw the note under the press, which
    // then lands on nothing (their own commit carries the text)
    for (const b of [tog, del]) b.addEventListener("pointerdown", (e) => e.preventDefault());
    bar.addEventListener("pointerdown", (e) => { if (!del.contains(e.target) && !tog.contains(e.target)) drag(e, m.id); });
    requestAnimationFrame(() => fit(a));
    return node;
  }

  /** Move a note by its bar: the node follows the pointer, the release commits once (a click moves nothing). */
  function drag(e, id) {
    // a text being typed commits first: the drag starts from the flow it made. The press then focuses the map, so
    // ⌘Z / Delete work next (the bar does not select text: .uf-pinbar)
    document.activeElement?.blur();
    const m = ctx.get().memos.find((x) => x.id === id), node = shown.get(id)?.node;
    if (!m || !node) return;
    const k = ctx.cam.get().k, c0 = { x: e.clientX, y: e.clientY }, bar = e.currentTarget;
    let at = { x: m.x, y: m.y }, moved = false;
    bar.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - c0.x, dy = ev.clientY - c0.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_PX) return;
      moved = true;
      at = { x: Math.round(m.x + dx / k), y: Math.round(m.y + dy / k) };
      placeFrame(node, at);
    };
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
      if (moved) change((f) => Object.assign(f.memos.find((x) => x.id === id), at));
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  }

  /** Size a note by its corner: the node follows the pointer (in map units, kept in range), the release commits once. */
  function resize(e, id) {
    document.activeElement?.blur(); // a text being typed commits first, as a move does; the press focuses the map (⌘Z)
    const m = ctx.get().memos.find((x) => x.id === id), node = shown.get(id)?.node, grip = e.currentTarget;
    if (!m || !node) return;
    const k = ctx.cam.get().k, c0 = { x: e.clientX, y: e.clientY };
    let size = { w: m.w, h: m.h }, moved = false;
    grip.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - c0.x, dy = ev.clientY - c0.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_PX) return;
      moved = true;
      size = { w: Math.round(clamp(m.w + dx / k, MIN_W, MAX_W)), h: Math.round(clamp(m.h + dy / k, MIN_H, MAX_H)) };
      node.style.width = size.w + "px";
      node.style.minHeight = size.h + "px";
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      if (moved) change((f) => Object.assign(f.memos.find((x) => x.id === id), size));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  /** Armed: a surface over the map takes the next press (the camera and the editor never see it; the wheel still
   *  zooms). Drag a box: that is the note; a click: a note of the default size there. */
  function arm() {
    if ((ctx.get().memos || []).length >= MAX_MEMOS) return ctx.say(t("maxMemos", { n: MAX_MEMOS }));
    // a note being typed commits before the next one is drawn; the map takes the keys (Esc calls drawing off)
    if (ctx.root.contains(document.activeElement) && document.activeElement !== ctx.button()) document.activeElement.blur();
    pad = h("div", "uf-pinpad");
    const ghost = h("div", "uf-pinghost");
    ghost.hidden = true;
    pad.append(ghost);
    pad.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      pad.setPointerCapture?.(e.pointerId);
      const r = ctx.view.getBoundingClientRect(), c0 = { x: e.clientX, y: e.clientY }, p0 = world(e), surface = pad;
      let p1 = p0, moved = false;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - c0.x, ev.clientY - c0.y) < DRAG_PX) return;
        moved = true;
        p1 = world(ev);
        ghost.hidden = false;
        box(ghost, { x: Math.min(c0.x, ev.clientX) - r.left, y: Math.min(c0.y, ev.clientY) - r.top,
          w: Math.abs(ev.clientX - c0.x), h: Math.abs(ev.clientY - c0.y) });
      };
      const up = () => {
        surface.removeEventListener("pointermove", move);
        surface.removeEventListener("pointerup", up);
        surface.removeEventListener("pointercancel", up);
        if (pad !== surface) return; // called off mid-drag (Esc)
        const x = moved ? Math.min(p0.x, p1.x) : p0.x, y = moved ? Math.min(p0.y, p1.y) : p0.y;
        const w = moved ? clamp(Math.abs(p1.x - p0.x), MIN_W, MAX_W) : WIDE;
        const hh = moved ? clamp(Math.abs(p1.y - p0.y), MIN_H, MAX_H) : TALL;
        disarm();
        add({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) });
      };
      pad.addEventListener("pointermove", move);
      pad.addEventListener("pointerup", up);
      pad.addEventListener("pointercancel", up);
    });
    ctx.view.append(pad);
    ctx.root.classList.add("uf-pinning");
    ctx.button()?.setAttribute("aria-pressed", "true");
    ctx.say(t("memoDraw"), true); // stays up until the note is drawn or drawing is called off
  }
  /** Call drawing off. -> whether it was armed (Esc does nothing else then). */
  function disarm() {
    if (!pad) return false;
    pad.remove();
    pad = null;
    ctx.root.classList.remove("uf-pinning");
    ctx.button()?.setAttribute("aria-pressed", "false");
    ctx.say("");
    return true;
  }
  function add(r) {
    const f = structuredClone(ctx.get());
    f.memos = f.memos || [];
    const id = nextId(new Set(f.memos.map((x) => x.id)));
    f.memos.push({ id, ...r, text: "" });
    ctx.commit(f);
    shown.get(id)?.node.querySelector("textarea")?.focus();
  }

  return {
    el,
    /** Draw the notes of the flow in hand; a node whose note and mode are unchanged stays (a focused text keeps its caret). */
    sync() {
      const editing = ctx.editing(), next = new Map();
      if (!editing) disarm();
      for (const m of ctx.get().memos || []) {
        const key = JSON.stringify([m.text, m.w, m.h, !!m.fold, editing]), old = shown.get(m.id);
        const node = old?.key === key ? old.node : build(m, editing);
        placeFrame(node, m);
        node.style.width = m.w + "px";
        if (old?.key !== key) node.style.minHeight = m.fold ? "" : m.h + "px"; // the box drawn; a longer text grows it
        next.set(m.id, { key, node });
      }
      shown = next;
      el.replaceChildren(...[...next.values()].map((x) => x.node));
    },
    /** "+ Ghi chú": arm drawing, or call it off when armed. */
    toggle: () => (pad ? disarm() : arm()),
    stop: disarm,
  };
}

export { memos };
