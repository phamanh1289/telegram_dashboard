import { BEZEL, FLASH_MS, GAP, H, HINT_MS, SLIDE_MS, TOAST_MS, W } from './constants.js';
import { box, btn, h, shotImg, svg } from './dom.js';
import { isPop, scr, startOf } from './values.js';
import { hotspots, layersOf, shotOf } from './shots.js';
import { parents } from './model.js';

// ------------------------------------------------------------------ prototype (player)
const CARD_IN = {
  popup: [{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }],
  sheet: [{ transform: "translateY(100%)" }, { transform: "none" }],
  toast: [{ opacity: 0, transform: "translateY(calc(100% + 56px))" }, { opacity: 1, transform: "none" }],
};
const FADE_IN = [{ opacity: 0 }, { opacity: 1 }];
const PULSE = [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }];
const backwards = (frames) => [...frames].reverse();
/** Transform / opacity animation; done() at the end, or at once under reduced motion. Returns the animation
 *  (null when it did not run) so a new one can cancel it. `o`: extra KeyframeEffect options. */
function motion(el, frames, reduced, done, o) {
  if (reduced.matches || !el.animate) {
    done?.();
    return null;
  }
  const a = el.animate(frames, { duration: SLIDE_MS, easing: "ease-out", ...o });
  if (done) a.finished.then(done, done);
  return a;
}
/** Tappable rows: [{label, cls, onTap(button)}]. */
function rowList(rows) {
  const list = h("div", "uf-rows");
  for (const r of rows) {
    const b = btn(r.label, "uf-row " + r.cls, () => r.onTap(b));
    list.append(b);
  }
  return list;
}
/** One overlay layer: scrim + card (popup / sheet), card alone (toast). list: rows element or null. */
function overlayNode(kind, title, list) {
  const el = h("div", `uf-overlay uf-${kind}`);
  const card = h("div", "uf-pcard" + (list ? "" : " uf-empty"));
  card.tabIndex = -1;
  card.setAttribute("role", kind === "toast" ? "status" : "dialog");
  if (kind !== "toast") card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", title);
  card.append(h("div", "uf-title", title));
  if (list) card.append(list);
  if (kind === "toast") {
    el.append(card);
    return { el, card, scrim: null, hit: null };
  }
  const hit = h("div", "uf-backdrop"), scrim = h("div", "uf-scrim");
  hit.append(scrim, card);
  el.append(hit);
  return { el, card, scrim, hit };
}
/** The phone shell: status bar, nav bar (back + title), body for screens; the path walked below it. */
function phoneShell(t) {
  const stage = h("div", "uf-stage"), phone = h("div", "uf-phone");
  phone.tabIndex = -1;
  const status = h("div", "uf-status", "9:41");
  status.setAttribute("aria-hidden", "true");
  const back = btn(null, "uf-pback", null);
  back.setAttribute("aria-label", t("back"));
  const i = svg("svg", { viewBox: "0 0 24 24", width: 26, height: 26, fill: "none", stroke: "currentColor",
    "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
  i.append(svg("path", { d: "M15 18l-6-6 6-6" }));
  back.append(i);
  const nav = h("div", "uf-nav"), title = h("div", "uf-title"), body = h("div", "uf-pbody");
  nav.append(back, title);
  phone.append(status, nav, body);
  stage.append(phone);
  const crumbs = h("nav", "uf-crumbs");
  crumbs.setAttribute("aria-label", t("trail"));
  const trail = h("div", "uf-trail");
  return { stage, phone, back, title, body, nav, crumbs, trail };
}
/** Prototype: a phone you tap through as if running the app. Owns its state (path of screens walked, open
 *  overlays, timers) and renders only the current screen + its overlays. flow(): the current flow (read on every
 *  tap, so edits apply); onGo(id): the shown screen changed; setStart(id | null), where the flow may be edited:
 *  the screen shown becomes the start screen without a trip to the map's edit mode. */
function player(host, { flow, t, reduced, onGo, setStart }) {
  let path = [], ovs = [], cur = null, flash = null, hint = null; // ovs: [{id, kind, el, card, scrim, timer}]
  const ui = phoneShell(t);
  const restart = btn(t("restart"), "uf-btn", () => go([startOf(flow())].filter(Boolean), "back"));
  ui.back.addEventListener("click", goBack);
  const note = h("span", "uf-nostart", t("noStartNote"));
  const pin = btn(`▶ ${t("setStart")}`, "uf-btn", () => { setStart(flow().start === here() ? null : here()); fillTrail(); });
  pin.title = t("startHere");
  ui.trail.append(ui.crumbs, ...(setStart ? [note, pin] : []), restart);
  host.replaceChildren(ui.stage, ui.trail);

  const resize = () => { // scale the frame to fit the stage; ignore 0 × 0 while hidden
    const w = ui.stage.clientWidth, hh = ui.stage.clientHeight, m = 2 * (BEZEL + GAP);
    if (w && hh) ui.phone.style.setProperty("--k", String(Math.min(1, (hh - m) / H, (w - m) / W)));
  };
  const ro = new ResizeObserver(resize);
  ro.observe(ui.stage);

  const by = (id) => flow().screens.find((s) => s.id === id);
  const from = (src) => flow().links.filter((l) => l.src === src);
  const here = () => path[path.length - 1];
  const backLink = () => from(here()).find((l) => l.act === "back");

  // state changes
  function go(next, dir) {
    const refocus = ui.phone.contains(document.activeElement);
    closeAll();
    path = next;
    show(dir);
    if (refocus) ui.phone.focus({ preventScroll: true });
  }
  function follow(l) {
    const to = by(l.to);
    if (l.act === "close") return drop(ovs.findLast((o) => o.id === scr(l.src)) || ovs[ovs.length - 1]);
    if (isPop(to)) return openOverlay(to);
    if (l.act !== "back") return go([...path, to.id], "push");
    const i = path.lastIndexOf(to.id);
    go(i >= 0 ? path.slice(0, i + 1) : [...path, to.id], "back");
  }
  /** Back (the nav bar / the design's back button): to the screen this one was opened from. C opened from A or B
   *  has a back link to each: the one in the path walked wins (A → C → back: A; B → C → back: B). None of them
   *  walked: the screen before in the path. At the first screen: the back link's own target. */
  function goBack() {
    const links = from(here()).filter((l) => l.act === "back" && !isPop(by(l.to)));
    const i = Math.max(-1, ...links.map((l) => path.lastIndexOf(l.to)).filter((k) => k < path.length - 1));
    if (i >= 0) go(path.slice(0, i + 1), "back");
    else if (path.length > 1) go(path.slice(0, -1), "back");
    else if (links.length) follow(links[0]);
  }
  function tap(b, links) {
    // the same screen the same way is one outcome, however many links say it: nothing to choose between
    const ways = links.filter((l, i) => links.findIndex((x) => x.to === l.to && x.act === l.act) === i);
    if (ways.length === 1) follow(ways[0]);
    else if (ways.length) choose(ways);
    else blink(b);
  }

  // rendering
  function itemRows(s, only = s.items) {
    return rowList(only.map((it) => {
      const links = from(`${s.id}.${it.id}`);
      return { label: it.label, cls: links.length ? "uf-linked" : "uf-dead", onTap: (b) => tap(b, links) };
    }));
  }
  function screenNode(s) {
    const el = h("div", "uf-pscreen");
    const sh = s && shotOf(s);
    if (sh) el.append(...shotNodes(s, sh));
    else if (s) el.append(s.items.length ? itemRows(s) : h("p", "uf-none", t("noItems")));
    return el;
  }
  /** The Zeplin image with a tap area on each button found on it (and on its back button); the buttons not
   *  found stay as rows under it. */
  function shotNodes(s, sh) {
    const { items, back } = hotspots(s, sh), pic = h("div", "uf-pshot uf-ld"), z = layersOf(items);
    pic.append(shotImg(sh, s.title, false));
    pic.addEventListener("click", (e) => { if (!e.target.closest("button")) hints(pic); }); // a tap on no button
    s.items.forEach((it, i) => {
      if (!items[i]) return;
      const links = from(`${s.id}.${it.id}`);
      const b = btn(null, "uf-phot " + (links.length ? "uf-linked" : "uf-dead"), () => tap(b, links));
      b.setAttribute("aria-label", it.label);
      box(b, items[i]);
      b.style.zIndex = z[i]; // as on the map: the area on top takes the tap, the one under it does not
      pic.append(b);
    });
    if (back && !isPop(s)) {
      const b = btn(null, "uf-phot uf-linked", goBack);
      b.setAttribute("aria-label", t("back"));
      box(b, back);
      b.style.zIndex = s.items.length + 1; // found by its text, small: never under a drawn area
      pic.append(b);
    }
    const off = s.items.filter((_, i) => !items[i]);
    return off.length ? [pic, h("p", "uf-none", t("offShot")), itemRows(s, off)] : [pic];
  }
  /** Build the next screen, then slide it in (push: from the right, back: from the left); dir null = no motion. */
  function show(dir) {
    const s = by(here()), old = cur;
    cur = screenNode(s);
    ui.body.replaceChildren(...(old && dir ? [old] : [])); // drops a screen still sliding out
    if (dir === "back") ui.body.prepend(cur);
    else ui.body.append(cur);
    if (old && dir) {
      const [inX, outX] = dir === "push" ? ["100%", "-28%"] : ["-28%", "100%"];
      old.classList.add("uf-leaving");
      motion(cur, [{ transform: `translateX(${inX})` }, { transform: "none" }], reduced);
      motion(old, [{ transform: "none" }, { transform: `translateX(${outX})` }], reduced, () => old.remove());
    }
    ui.title.textContent = s ? s.title : "";
    ui.phone.classList.toggle("uf-full", !!(s && shotOf(s))); // the image has its own status and nav bars
    ui.back.classList.toggle("uf-off", !backLink() && path.length < 2);
    fillTrail();
    if (s) onGo(s.id);
  }
  function fillTrail() {
    ui.crumbs.replaceChildren(...path.flatMap((id, i) => {
      const c = btn(by(id)?.title ?? id, "uf-crumb", () => go(path.slice(0, i + 1), "back"));
      if (i === path.length - 1) { c.disabled = true; c.setAttribute("aria-current", "page"); }
      return i ? [h("span", "uf-sep", "›"), c] : [c];
    }));
    note.hidden = !!by(flow().start); // a start that names no screen is no start
    pin.setAttribute("aria-pressed", String(flow().start === here()));
    ui.crumbs.scrollLeft = ui.crumbs.scrollWidth; // keep the current screen in view (one read per step)
  }

  // overlays
  function layer(id, kind, title, list, full) {
    const o = { id, kind, timer: 0, ...(full ? fullNode(kind, full) : overlayNode(kind, title, list)) };
    o.hit?.addEventListener("click", (e) => { // the scrim closes; so does any tap on a card without buttons
      if (!e.target.closest("button") && (!list || !o.card.contains(e.target))) drop(o);
    });
    if (kind === "toast") o.timer = setTimeout(() => drop(o), TOAST_MS);
    ovs.push(o);
    ui.phone.append(o.el);
    gate();
    if (o.scrim) motion(o.scrim, FADE_IN, reduced);
    motion(o.card, full ? FADE_IN : CARD_IN[kind], reduced);
    if (kind !== "toast") o.card.focus({ preventScroll: true });
    return o;
  }
  function openOverlay(s) {
    if (ovs.some((o) => o.id === s.id)) return;
    if (shotOf(s)) layer(s.id, s.kind, s.title, null, screenNode(s));
    else layer(s.id, s.kind, s.title, s.items.length ? itemRows(s) : null);
  }
  /** An overlay drawn from its Zeplin image: the whole phone (the design has its own scrim). */
  function fullNode(kind, card) {
    const el = h("div", `uf-overlay uf-fullov${kind === "toast" ? " uf-toast" : ""}`);
    card.tabIndex = -1;
    card.setAttribute("role", kind === "toast" ? "status" : "dialog");
    el.append(card);
    return { el, card, scrim: null, hit: null };
  }
  /** A button with several links: pick the case (its `when`) to follow. */
  function choose(links) {
    const o = layer(null, "sheet", t("pick"), rowList(links.map((l) => ({
      label: l.when || by(l.to).title, cls: "uf-linked", onTap: () => { drop(o, true); follow(l); },
    }))));
  }
  function drop(o, instant) {
    if (!o || !ovs.includes(o)) return;
    ovs = ovs.filter((x) => x !== o);
    clearTimeout(o.timer);
    gate();
    const refocus = o.el.contains(document.activeElement);
    o.el.classList.add("uf-leaving");
    if (instant) o.el.remove();
    else {
      if (o.scrim) motion(o.scrim, backwards(FADE_IN), reduced);
      motion(o.card, backwards(o.el.classList.contains("uf-fullov") ? FADE_IN : CARD_IN[o.kind]), reduced, () => o.el.remove());
    }
    if (refocus) ui.phone.focus({ preventScroll: true });
  }
  function closeAll() {
    for (const o of ovs) clearTimeout(o.timer);
    ovs = [];
    ui.phone.querySelectorAll(".uf-overlay").forEach((n) => n.remove()); // leaving ones too
    gate();
  }
  /** Only the top layer takes input: everything under it is inert, so it is out of the tab order and the
   *  accessibility tree. A toast takes no input at all, so it never gates the screen. */
  function gate() {
    const top = ovs.findLast((o) => o.kind !== "toast");
    ui.body.inert = ui.nav.inert = !!top;
    for (const o of ovs) o.el.inert = !!top && o !== top;
  }
  /** A button that goes nowhere: pulse its border. Tapped again mid-pulse, it starts over. */
  function blink(b) {
    if (flash) {
      flash.a?.cancel();
      clearTimeout(flash.timer);
      flash.b.classList.remove("uf-flash");
    }
    b.classList.add("uf-flash");
    const a = motion(b, PULSE, reduced, null, { duration: FLASH_MS, pseudoElement: "::before" });
    flash = { b, a, timer: setTimeout(() => { b.classList.remove("uf-flash"); flash = null; }, FLASH_MS) };
  }

  /** A tap on the image outside every button: all its tap areas light up for a moment. Again mid-way: over. */
  function hints(pic) {
    if (hint) {
      clearTimeout(hint.timer);
      hint.pic.classList.remove("uf-hints");
    }
    pic.classList.add("uf-hints");
    hint = { pic, timer: setTimeout(() => { pic.classList.remove("uf-hints"); hint = null; }, HINT_MS) };
  }

  return {
    /** Jump to a screen (an overlay: its parent with the overlay open), as a fresh path. */
    open(id) {
      const s = by(id) || by(startOf(flow()));
      if (!s) return;
      const p = isPop(s) && parents(flow()).get(s.id);
      go([p || s.id], null);
      if (p) openOverlay(s);
    },
    /** The frame changed size (a flow of the other device): fit it to the stage again. */
    resize,
    /** First entry into Prototype: start at id (or the first screen); later entries keep where the user was. */
    start(id) { if (!path.length) this.open(id); },
    /** The flow changed: keep the walked screens that still exist, redraw without motion. */
    refresh() {
      if (!path.length) return;
      go(path.filter((id) => by(id)), null);
      if (!path.length) this.open(null);
    },
    /** Esc: close the top overlay; false when there is none. */
    escape() {
      if (!ovs.length) return false;
      drop(ovs[ovs.length - 1]);
      return true;
    },
    destroy() {
      ro.disconnect();
      closeAll();
      if (flash) clearTimeout(flash.timer);
      if (hint) clearTimeout(hint.timer);
    },
  };
}

export { CARD_IN, FADE_IN, PULSE, backwards, motion, rowList, overlayNode, phoneShell, player };
