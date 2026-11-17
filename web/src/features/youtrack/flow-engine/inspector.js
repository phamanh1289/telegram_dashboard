import { ACTS, CAP, CAP_AC, CAP_NOTE, CAP_URL, KINDS, MAX_ITEMS, W, ZEPLIN } from './constants.js';
import { clamp, scr, startOf } from './values.js';
import { shotOf } from './shots.js';
import { canFold, frameH, oneFrame, rowsOf, setFold } from './geometry.js';
import { btn, h, ibtn, icon } from './dom.js';
import { rekind } from './model.js';

/** Properties UI delegates all mutations to the editor's single commit path. */
const ACT_ICON = { navigate: "go", open: "open", back: "back", close: "x" };

export function inspector({ ctx, t, get, target, blocked, select, selected, startDraw, addItem, remove, fieldState }) {
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
    // Enter keeps the text and hands the keys back to the map (arrow keys move the selection again), as a rename does
    i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { i.blur(); ctx.view.focus({ preventScroll: true }); } });
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
  /** A button's ways out ("Đường đi"): one row per arrow from it. A press opens the row (its arrow stays lit on
   *  the map, its kind can be picked right there); hovering a row lights its arrow for a moment. The full arrow
   *  panel (condition, AC) is one press further. `open`: the arrow opened, by "src>to", for this button only. */
  let open = null; // {who: "screen.item", key: "src>to"}
  let nameNext = false; // the next panel puts the cursor in the button's name (an area just drawn has none)
  function routes(f, src) {
    const w = h("div", "uf-field uf-sec"), list = h("div", "uf-routes");
    const mine = f.links.map((l, i) => [l, i]).filter(([l]) => l.src === src);
    const name = (id) => f.screens.find((s) => s.id === id)?.title ?? id;
    const path = (i) => ctx.marks()[i]?.path;
    if (open && (open.who !== src || !mine.some(([l]) => `${l.src}>${l.to}` === open.key))) open = null;
    for (const [l, i] of mine) {
      const key = `${l.src}>${l.to}`, on = open?.key === key;
      const row = h("div", `uf-route uf-a-${l.act}` + (on ? " uf-open" : ""));
      const how = t("act_" + l.act) + (l.when ? ` · ${l.when}` : "");
      // drawn as: the act's icon, where it goes, how (and when); read as one line, the way the map's arrows say it
      const go = btn(null, "uf-btn uf-rgo", () => {
        open = on ? null : { who: src, key };
        fill();
      });
      const mark = h("span", "uf-ract"), txt = h("span", "uf-rtxt");
      mark.append(icon(ACT_ICON[l.act] || "go"));
      txt.append(h("span", "uf-rto", name(l.to)), h("span", "uf-rsub", how));
      go.append(mark, txt, icon("down"));
      go.setAttribute("aria-label", `${t("act_" + l.act)} → ${name(l.to)}${l.when ? ` · ${l.when}` : ""}`);
      go.setAttribute("aria-expanded", String(on));
      go.addEventListener("pointerenter", () => path(i)?.classList.add("uf-peek"));
      go.addEventListener("pointerleave", () => { if (!on) path(i)?.classList.remove("uf-peek"); });
      const head = h("div", "uf-rhead");
      head.append(go, ibtn("x", t("routeDel", { s: name(l.to) }), "uf-btn uf-rdel", () => change((_, g) => { g.links.splice(i, 1); })));
      row.append(head);
      if (on) {
        const more = btn(null, "uf-btn uf-rmore", () => select({ t: "link", i }));
        more.append(h("span", null, t("routeMore")), icon("chev"));
        const body = h("div", "uf-rbody");
        body.append(chips(ACTS, l.act, "act_", (a) => change((_, g) => { g.links[i].act = a; }), key), more);
        row.append(body);
      }
      list.append(row);
    }
    // the open one stays lit after the panel is rebuilt (a change redraws its arrow); the others go dark
    for (const m of ctx.marks()) m.path.classList.toggle("uf-peek", !!open && m.l.src === src && `${m.l.src}>${m.l.to}` === open.key);
    if (!mine.length) list.append(h("p", "uf-rnone", t("routesNone")));
    w.append(h("span", "uf-flab", t("routesField", { n: mine.length })), list);
    return w;
  }
  let nameBox = null;
  function focusName() {
    const i = nameBox?.querySelector("input");
    if (!i || !i.isConnected) return;
    i.focus({ preventScroll: true });
    i.select(); // typing replaces "Nút mới"
  }
  /** A tap area's actions, pinned under the scrolling fields: draw it (again), or back to its text on the design. */
  function itemActs(f, sel, o) {
    const acts = h("div", "uf-ifoot"), id = sel.id, item = sel.item;
    const s = f.screens.find((x) => x.id === id);
    if (!shotOf(s)) return acts;
    const draw = ibtn("area", t(o.rect ? "redraw" : "drawOne"), "uf-btn", () => startDraw({ id, item }), t(o.rect ? "redraw" : "drawOne"));
    draw.removeAttribute("title"); // its text says it
    acts.append(draw);
    if (!o.rect) return acts;
    // back to the text's place on the design (it follows the button when the designer moves it), offered only
    // when the label is a text on the image: a drawn area ("Nút mới") or one the AI placed (it got a rect for
    // having no such text) would fall off the image into a plain row under it. Always there for a drawn area:
    // when its name is no text on the design, a press says so and puts the cursor in the name (an action that
    // leads somewhere, where a greyed-out button would not say why)
    const i = s.items.findIndex((x) => x.id === item);
    const asText = { ...s, items: s.items.map((x, j) => (j === i ? { id: x.id, label: x.label } : x)) };
    const can = rowsOf(asText)[i].hot, unnamed = o.label === t("newItem");
    const b = ibtn("text", t("byText"), "uf-btn", () => {
      if (can) return change((it) => { delete it.rect; });
      ctx.note(unnamed ? t("byTextUnnamed") : t("byTextNone", { s: o.label }));
      focusName();
    }, t("byText"));
    b.title = can ? t("byTextHint", { s: o.label }) : t("byTextNeed");
    acts.append(b);
    return acts;
  }
  /** What is in hand: its kind (coloured) over its name, the screen a button sits on; back to that screen, delete,
   *  let go. The icons say what they do on hover (styles: .uf-ihead [data-tip]). */
  function header(f, sel, o, title, start) {
    const head = h("div", "uf-ihead uf-k-" + (sel.t === "screen" ? o.kind : sel.t === "item" ? "item" : "link"));
    const eye = h("div", "uf-ieye"), name = h("h2", null, title), titled = h("div", "uf-ititle");
    eye.append(h("span", "uf-itag", sel.t === "screen" ? t("kind_" + o.kind) : t(sel.t === "item" ? "button" : "arrow")));
    name.title = title;
    if (sel.t !== "screen") { // a button / an arrow belongs to a screen: one press back to it
      const home = f.screens.find((x) => x.id === (sel.t === "item" ? sel.id : scr(o.src)));
      head.append(ibtn("back", t("backTo", { s: home.title }), "uf-btn", () => select({ t: "screen", id: home.id })));
      if (sel.t === "item") eye.append(h("span", "uf-ihome", home.title));
    }
    titled.append(eye, name);
    head.append(titled, ...(start ? [start] : []), ibtn("trash", t("del"), "uf-btn uf-danger", remove), ibtn("x", t("unpick"), "uf-btn", () => select(null)));
    for (const b of head.querySelectorAll(".uf-btn[title]")) { b.dataset.tip = b.title; b.removeAttribute("title"); }
    return head;
  }
  function fill() {
    nameBox = null;
    const sel = selected();
    if (sel?.t !== "item") for (const m of ctx.marks()) m.path.classList.remove("uf-peek");
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
        chips(KINDS, o.kind, "kind_", (k) => change((s, g) => { rekind(g, s.id, k); }, o.id)), // its arrows follow
        field(t("zeplinField"), o.zeplin, CAP_URL, (v) => change((s) => { s.zeplin = v; }),
          { ok: (v) => ZEPLIN.test(v), text: t("badZeplin") }),
        memo(o.note || "", (v) => change((s) => { s.note = v; })));
      if (canFold(o)) { // a long design (a list): whole, or its top part on the map; the part's height in design px
        const sh = shotOf(o), shown = o.fold ? "fold" : "full";
        rows.push(chips(["full", "fold"], shown, "fold_", (v) => change((s, g) => { setFold(g, s.id, v === "fold" ? oneFrame(s) : null); }), o.id));
        if (o.fold) {
          rows.push(numbers(t("foldH"), ["H"], [(frameH(o) * sh.w) / W],
            ([px]) => change((s, g) => { setFold(g, s.id, clamp(px / sh.h, 0.01, 1)); })));
        }
      }
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
      title = o.label;
      // its name: what the arrows, the flow check and Prototype call it, and what "Khớp theo chữ" looks for on
      // the design. An emptied box puts the stored name back.
      nameBox = field(t("itemName"), o.label, CAP, (v) => (v ? change((it) => { it.label = v; }) : fill()));
      rows.push(nameBox, routes(f, `${sel.id}.${sel.item}`)); // its area: dragged / sized on the image, arrow keys
    } else {
      title = `${f.screens.find((s) => s.id === scr(o.src)).title} → ${f.screens.find((s) => s.id === o.to).title}`;
      rows.push(chips(ACTS, o.act, "act_", (a) => change((l) => { l.act = a; }), `${o.src}>${o.to}`),
        field(t("whenField"), o.when, CAP, (v) => change((l) => { l.when = v; })),
        field(t("acField"), o.ac, CAP_AC, (v) => change((l) => { l.ac = v; })));
    }
    const acts = sel.t === "item" ? itemActs(f, sel, o) : null, head = header(f, sel, o, title, start);
    const body = h("div", "uf-ibody");
    body.append(...rows);
    ctx.insp.replaceChildren(head, body, ...(acts?.children.length ? [acts] : []));
    if (nameNext) { nameNext = false; focusName(); }
  }

  /** An area just drawn by dragging has no name: the panel that follows asks for one. */
  const nameSoon = () => { nameNext = true; };
  return { fill, change, nameSoon };
}
