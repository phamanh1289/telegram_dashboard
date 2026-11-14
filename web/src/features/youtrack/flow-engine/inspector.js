import { ACTS, CAP, CAP_AC, CAP_NOTE, CAP_URL, KINDS, MAX_ITEMS, ZEPLIN } from './constants.js';
import { clamp, scr, startOf } from './values.js';
import { shotOf } from './shots.js';
import { btn, h } from './dom.js';
import { family } from './model.js';

/** Properties UI delegates all mutations to the editor's single commit path. */
export function inspector({ ctx, t, get, target, blocked, scale, rnd, select, selected, startDraw, addItem, remove, fieldState }) {
  // ---------------- the properties panel
  const change = (fn) => {
    if (blocked()) return;
    const f = structuredClone(get());
    fn(target(f), f);
    ctx.commit(f);
  };
  function chips(vals, now, key, pick) {
    const g = h("div", "uf-chips");
    for (const v of vals) {
      const b = btn(t(key + v), "uf-btn", () => pick(v));
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
    w.append(h("span", "uf-flab", label), ...boxes);
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
    if (sel.t === "screen") {
      rows.push(h("h2", null, o.title),
        chips(KINDS, o.kind, "kind_", (k) => change((s) => {
          s.kind = k;
          if (k === "screen") s.parent = null; // a screen has no parent
        })),
        (() => { // the prototype / test paths start here; pressed again: back to the first screen
          const on = startOf(f) === o.id && f.start === o.id, b = btn(`▶ ${t("setStart")}`, "uf-btn", () => change((s, g) => { g.start = on ? null : s.id; }));
          b.setAttribute("aria-pressed", String(on));
          const w = h("div", "uf-chips");
          w.style.marginTop = "6px";
          w.append(b);
          return w;
        })(),
        field(t("acField"), o.ac, CAP_AC, (v) => change((s) => { s.ac = v; })),
        field(t("zeplinField"), o.zeplin, CAP_URL, (v) => change((s) => { s.zeplin = v; }),
          { ok: (v) => ZEPLIN.test(v), text: t("badZeplin") }),
        numbers(t("posField"), ["X", "Y"], [o.x, o.y], ([x, y]) => change((s, g) => {
          const dx = Math.round(x) - s.x, dy = Math.round(y) - s.y;
          for (const id of family(g, s.id)) {
            const m = g.screens.find((v) => v.id === id);
            m.x += dx;
            m.y += dy;
          }
        })),
        memo(o.note || "", (v) => change((s) => { s.note = v; })));
      if (o.items.length) { // keyboard way to a button (the map itself is pointer-only)
        const w = h("div", "uf-field"), g = h("div", "uf-chips");
        for (const it of o.items) g.append(btn(it.label, "uf-btn", () => select({ t: "item", id: o.id, item: it.id })));
        w.append(h("span", "uf-flab", t("itemsField")), g);
        rows.push(w);
      }
    } else if (sel.t === "item") {
      rows.push(h("h2", null, `${t("button")}: ${o.label}`));
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
      rows.push(h("h2", null, `${t("arrow")}: ${f.screens.find((s) => s.id === scr(o.src)).title} → ${f.screens.find((s) => s.id === o.to).title}`),
        chips(ACTS, o.act, "act_", (a) => change((l) => { l.act = a; })),
        field(t("whenField"), o.when, CAP, (v) => change((l) => { l.when = v; })),
        field(t("acField"), o.ac, CAP_AC, (v) => change((l) => { l.ac = v; })));
    }
    const acts = h("div", "uf-acts uf-chips");
    if (sel.t === "screen") {
      const add = btn(t("addItem"), "uf-btn", addItem);
      add.disabled = o.items.length >= MAX_ITEMS;
      if (add.disabled) add.title = t("maxItems", { n: MAX_ITEMS });
      acts.append(add);
      if (shotOf(o)) {
        const area = btn(t("drawHot"), "uf-btn", () => startDraw({ id: o.id }));
        area.disabled = add.disabled;
        acts.append(area);
      }
    } else if (sel.t === "item" && shotOf(f.screens.find((x) => x.id === sel.id))) {
      const id = sel.id, item = sel.item;
      acts.append(btn(o.rect ? t("redraw") : t("drawHot").replace(/^\+ /, ""), "uf-btn", () => startDraw({ id, item })));
      if (o.rect) acts.append(btn(t("byText"), "uf-btn", () => change((it) => { delete it.rect; })));
    }
    acts.append(btn(t("del"), "uf-btn uf-danger", remove));
    rows.push(acts);
    ctx.insp.replaceChildren(...rows);
  }

  return { fill, change };
}
