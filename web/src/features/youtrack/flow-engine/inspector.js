import { ACTS, CAP, CAP_AC, CAP_NOTE, CAP_URL, KINDS, MAX_ITEMS, ZEPLIN } from './constants.js';
import { clamp, scr, startOf } from './values.js';
import { shotOf } from './shots.js';
import { btn, h, ibtn } from './dom.js';

/** Properties UI delegates all mutations to the editor's single commit path. */
export function inspector({ ctx, t, get, target, blocked, scale, rnd, select, selected, startDraw, addItem, remove, fieldState }) {
  // ---------------- the properties panel
  const change = (fn) => {
    if (blocked()) return;
    const f = structuredClone(get());
    fn(target(f), f);
    ctx.commit(f);
  };
  /** A pick-one row. Its filled pill slides from the value it sat on to `now`: the panel is rebuilt by every change,
   *  so where it was (`was`, for this same `who`) is kept here and the new pill starts there. */
  let was = null; // {who, key, i}
  function chips(vals, now, key, pick, who) {
    const g = h("div", "uf-seg uf-pick");
    g.setAttribute("role", "group");
    const i = vals.indexOf(now), from = was && was.who === who && was.key === key ? was.i : i;
    const pill = h("span", "uf-pill uf-k-" + vals[from]);
    const at = (n) => { pill.className = "uf-pill uf-k-" + vals[n]; pill.style.transform = `translateX(${n * 100}%)`; };
    pill.style.width = `calc((100% - 4px) / ${vals.length})`;
    at(from);
    if (from !== i) requestAnimationFrame(() => { void pill.offsetWidth; at(i); }); // drawn at the old place first
    was = { who, key, i };
    g.append(pill);
    for (const v of vals) {
      const b = btn(t(key + v), "uf-btn uf-k-" + v, () => pick(v));
      b.setAttribute("aria-pressed", String(v === now));
      g.append(b);
    }
    return g;
  }
  /** One text field, capped exactly like the backend model so a round-trip never changes what is stored.
   *  `bad`: {ok(v), text} turns the field into a checked one — what it rejects (pattern or over `cap`) is shown
   *  as wrong and the stored value is cleared, so the box and the flow never say different things. The typed
   *  text survives the re-render that clearing causes (`fieldState.badVal`). */
  function field(label, value, cap, set, bad) {
    const w = h("label", "uf-field");
    const i = h("input", "uf-input");
    i.type = "text";
    if (!bad) i.maxLength = cap; // a checked field must show what the user typed, over-long included
    i.value = bad && fieldState.badVal !== null ? fieldState.badVal : value;
    const mark = (wrong) => {
      w.classList.toggle("uf-has-bad", wrong);
      i.setAttribute("aria-invalid", String(wrong));
    };
    i.addEventListener("change", () => {
      const raw = i.value.trim(), v = bad ? raw : raw.slice(0, cap);
      if (!v || !bad || (bad.ok(v) && v.length <= cap)) {
        mark(false);
        fieldState.badVal = null;
        return set(v);
      }
      set(""); // never keep a stored value the box does not show
      fieldState.badVal = v; // the re-render that just happened cleared it; the panel still owes the user their text
      fill();
    });
    i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
    w.append(h("span", "uf-flab", label), i);
    if (bad) {
      w.append(h("span", "uf-bad", bad.text));
      if (fieldState.badVal !== null) mark(true);
    }
    return w;
  }
  /** Numbers in one row (`names` label each box); set(values) only once every box holds a finite number. */
  function numbers(label, names, values, set) {
    const w = h("div", "uf-field");
    const boxes = names.map((n, j) => {
      const i = h("input", "uf-input uf-num");
      i.type = "number";
      i.value = String(Math.round(values[j]));
      i.setAttribute("aria-label", `${label} ${n}`);
      i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
      i.addEventListener("change", () => {
        const v = boxes.map((b) => b.valueAsNumber);
        if (v.every(Number.isFinite)) set(v);
        else fill(); // a cleared box: show the stored values again
      });
      return i;
    });
    const row = h("div", "uf-nums");
    row.append(...boxes);
    w.append(h("span", "uf-flab", label), row);
    return w;
  }
  /** Plain-text note: kept on blur, Esc puts back what was stored. */
  function memo(value, set) {
    const w = h("label", "uf-field");
    const a = h("textarea", "uf-area");
    a.maxLength = CAP_NOTE;
    a.value = value;
    a.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); a.value = value; a.blur(); }
    });
    a.addEventListener("change", () => set(a.value.slice(0, CAP_NOTE)));
    w.append(h("span", "uf-flab", t("noteField")), a);
    return w;
  }
  function fill() {
    const sel = selected();
    ctx.insp.hidden = !sel;
    if (!sel) return ctx.insp.replaceChildren();
    const f = get(), o = target(f), rows = [];
    let title = o.title, start = null;
    if (sel.t === "screen") { // the prototype / test paths start here; pressed again: back to the first screen
      const on = startOf(f) === o.id && f.start === o.id, label = `▶ ${t("setStart")}`;
      start = btn("▶", "uf-btn uf-icon uf-start", () => change((s, g) => { g.start = on ? null : s.id; }));
      start.setAttribute("aria-label", label);
      start.title = label;
      start.setAttribute("aria-pressed", String(on));
    }
    if (sel.t === "screen") {
      const shot = shotOf(o), full = o.items.length >= MAX_ITEMS;
      // the name, as a field: the double-click on the frame's title renames too, but shows no sign of it and the
      // title bar of a screen with an image is hidden until zoomed in. An emptied box puts the stored name back.
      rows.push(field(t("nameField"), o.title, CAP, (v) => (v ? change((s) => { s.title = v; }) : fill())),
        chips(KINDS, o.kind, "kind_", (k) => change((s) => {
          s.kind = k;
          if (k === "screen") s.parent = null; // a screen has no parent
        }, o.id)),
        field(t("zeplinField"), o.zeplin, CAP_URL, (v) => change((s) => { s.zeplin = v; }),
          { ok: (v) => ZEPLIN.test(v), text: t("badZeplin") }),
        memo(o.note || "", (v) => change((s) => { s.note = v; })));
      // what can be pressed on this screen, and the one way to add to it: a tap area drawn on the design image,
      // or (no image to draw on) a plain button. Also the keyboard way to a button (the map is pointer-only).
      const w = h("div", "uf-field"), g = h("div", "uf-chips");
      const node = (it) => ctx.frames().get(o.id)?.querySelector(`[data-item="${window.CSS.escape(it.id)}"]`);
      for (const it of o.items) {
        const b = btn(it.label, "uf-btn", () => select({ t: "item", id: o.id, item: it.id }));
        b.addEventListener("pointerenter", () => node(it)?.classList.add("uf-peek")); // which one on the map
        b.addEventListener("pointerleave", () => node(it)?.classList.remove("uf-peek"));
        g.append(b);
      }
      const add = shot ? btn(t("drawHot"), "uf-btn uf-addchip", () => startDraw({ id: o.id })) : btn(t("addItem"), "uf-btn uf-addchip", addItem);
      add.disabled = full;
      if (full) add.title = t("maxItems", { n: MAX_ITEMS });
      g.append(add);
      w.append(h("span", "uf-flab", t(shot ? "hotsField" : "itemsField")), g);
      rows.push(w);
    } else if (sel.t === "item") {
      title = `${t("button")}: ${o.label}`;
      const k = scale(f.screens.find((x) => x.id === sel.id));
      if (k && o.rect) {
        const { sh } = k, r = o.rect;
        rows.push(numbers(t("rectField"), ["X", "Y", "W", "H"], [r.x * sh.w, r.y * sh.h, r.w * sh.w, r.h * sh.h],
          ([x, y, w, hh]) => change((it) => {
            const nx = rnd(clamp(x / sh.w, 0, 1)), ny = rnd(clamp(y / sh.h, 0, 1));
            const nw = Math.min(rnd(clamp(w / sh.w, 1 / sh.w, 1)), 1 - nx), nh = Math.min(rnd(clamp(hh / sh.h, 1 / sh.h, 1)), 1 - ny);
            if (nw > 0 && nh > 0) it.rect = { x: nx, y: ny, w: nw, h: nh };
          })));
      }
    } else {
      title = `${t("arrow")}: ${f.screens.find((s) => s.id === scr(o.src)).title} → ${f.screens.find((s) => s.id === o.to).title}`;
      rows.push(chips(ACTS, o.act, "act_", (a) => change((l) => { l.act = a; }), `${o.src}>${o.to}`),
        field(t("whenField"), o.when, CAP, (v) => change((l) => { l.when = v; })),
        field(t("acField"), o.ac, CAP_AC, (v) => change((l) => { l.ac = v; })));
    }
    const acts = h("div", "uf-acts uf-chips");
    if (sel.t === "item" && shotOf(f.screens.find((x) => x.id === sel.id))) {
      const id = sel.id, item = sel.item;
      acts.append(btn(o.rect ? t("redraw") : t("drawOne"), "uf-btn", () => startDraw({ id, item })));
      if (o.rect) acts.append(btn(t("byText"), "uf-btn", () => change((it) => { delete it.rect; })));
    }
    if (acts.children.length) rows.push(acts);
    // header: what is in hand (coloured by its kind), delete it, let go of it
    const head = h("div", "uf-ihead");
    const tag = sel.t === "screen" ? [h("span", "uf-itag uf-k-" + o.kind, t("kind_" + o.kind))] : []; // a button / arrow says what it is in its title
    const name = h("h2", null, title);
    name.title = title;
    if (sel.t !== "screen") { // a button / an arrow belongs to a screen: one press back to it
      const home = f.screens.find((x) => x.id === (sel.t === "item" ? sel.id : scr(o.src)));
      head.append(ibtn("back", t("backTo", { s: home.title }), "uf-btn", () => select({ t: "screen", id: home.id })));
    }
    head.append(...tag, name, ...(start ? [start] : []), ibtn("trash", t("del"), "uf-btn uf-danger", remove), ibtn("x", t("unpick"), "uf-btn", () => select(null)));
    const body = h("div", "uf-ibody");
    body.append(...rows);
    ctx.insp.replaceChildren(head, body);
  }

  return { fill, change };
}
