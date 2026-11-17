import { createFinder } from './finder.js';
import { injectStyle } from './styles.js';
import { tr } from './i18n.js';
import { SHOTS, sameShot, setShots, shotOf } from './shots.js';
import { parents, sanitize } from './model.js';
import { layout } from './layout.js';
import { bounds, clearTall, curve, freeShots, linkEnds, linkText, r1 } from './geometry.js';
import { h, ibtn, placeFrame, svg } from './dom.js';
import { readHash } from './standalone.js';
import { buildFrame, markers } from './frames.js';
import { CAP_TITLE, DEVICE, FIT_TALL, FOCUS, H, LABEL_HIDE, MERGE_MS, NOTE_MS, UNDO, W } from './constants.js';
import { acCodes, scr, startOf } from './values.js';
import { camera } from './camera.js';
import { editor } from './editor.js';
import { zeplinForm as zeplinFormOf } from './zeplin-form.js';
import { player } from './player.js';
import { memos } from './memos.js';

// ------------------------------------------------------------------ mount
let mounts = 0;
/** standalone: an exported file opened on its own (writes the hash); it is mounted view-only (no opts.edit). */
function mount(host, flow, opts = {}, standalone = false) {
  const cleanup = [];
  try {
  injectStyle();
  const lang = opts.lang || (/^vi/i.test(navigator.language || "") ? "vi" : "en");
  const t = tr(lang), uid = "uf" + ++mounts;

  // state
  setShots(opts.shots);
  const first = sanitize(flow);
  let cur = layout(clearTall(freeShots(first))), base = JSON.stringify(cur), hist = [];
  let fut = [], merging = null; // fut: what undo took back (redo); merging: {key, at} of the last mergeable step
  let shown = "map", focusId = null, focusLink = null, focusSrc = null, focusAc = null, here = null, editing = false; // focusLink: index of the arrow in hand (edit)
  let frames = new Map(), marks = []; // marks: [{path, lab, a, b}] per link, for focus dimming

  // shell
  const root = h("div", "uf-root");
  root.dataset.mode = shown;
  /** The frame of the flow's device (a phone, a browser window), for the CSS: set on mount and when a flow of the
   *  other device replaces this one. */
  const frameSize = () => {
    root.dataset.device = DEVICE;
    root.style.setProperty("--uf-w", W + "px");
    root.style.setProperty("--uf-h", H + "px");
  };
  frameSize();
  // the toolbar: a narrow rail down the left edge, icons only; it slides open with every name on hover / focus
  // (styles: .uf-bar), each name staying its aria-label. Top to bottom: the view, Sửa and its tools, the map's
  // display.
  const bar = h("div", "uf-bar");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-orientation", "vertical");
  let bZep = null, bMemo = null, bUndo = null, bRedo = null;
  const seg = h("div", "uf-seg");
  seg.setAttribute("role", "group");
  const bMap = ibtn("map", t("map"), "uf-btn", () => api.mode("map"));
  const bPlay = ibtn("play", t("play"), "uf-btn", () => api.mode("play"));
  seg.append(bMap, bPlay);
  bar.append(seg);
  if (opts.edit) {
    const bEdit = ibtn("edit", t("edit"), "uf-btn uf-editbtn", () => {
      ed.cancel(); // the handles this render draws are about to be replaced
      editing = !editing;
      bEdit.setAttribute("aria-pressed", String(editing));
      root.classList.toggle("uf-editing", editing);
      if (!editing) { ed.clear(); zeplinForm(false); setFocus(null); }
      render(); // the dots and arrow handles only exist while editing
    });
    bEdit.setAttribute("aria-pressed", "false");
    const tool = (name, key, onClick) => ibtn(name, t(key), "uf-btn", onClick);
    bZep = tool("plus", "fromZeplin", () => zeplinForm(true));
    bZep.setAttribute("aria-expanded", "false");
    bUndo = tool("undo", "undo", () => api.undo());
    bRedo = tool("redo", "redo", () => api.redo());
    const tools = h("div", "uf-tools"), tin = h("div", "uf-tin"); // one group that slides open while editing (CSS)
    tools.setAttribute("role", "group");
    bMemo = tool("memo", "addMemo", () => memo.toggle());
    bMemo.setAttribute("aria-pressed", "false");
    tin.append(bZep, bMemo, tool("grid", "relayout", () => ed.relayout()), h("span", "uf-div"), bUndo, bRedo);
    tools.append(tin);
    bar.append(h("span", "uf-div"), bEdit, tools);
  }
  const bFit = ibtn("fit", t("fit"), "uf-btn uf-fit", () => api.fit());
  bar.append(h("span", "uf-div uf-fit"), bFit);
  // every icon's name beside it, shown when the pointer rests on the rail (it slides open over the map: CSS)
  for (const b of bar.querySelectorAll(".uf-icon[title]")) {
    b.append(h("span", "uf-lbl", b.title.replace(/^[+↶↷]\s*/, ""))); // no glyph twice
    b.removeAttribute("title"); // the name is right there: no slow browser tooltip
  }
  // a tool picked: the rail slides shut until the pointer leaves it, so what it opens beside it is not covered
  // (Sửa excepted: its tools slide out under it to be picked next)
  bar.addEventListener("click", (e) => {
    if (e.target.closest?.(".uf-btn") && !e.target.closest(".uf-editbtn")) bar.classList.add("uf-hold");
  });
  bar.addEventListener("pointerleave", () => bar.classList.remove("uf-hold"));

  const main = h("div", "uf-main");
  const view = h("div", "uf-view");
  view.tabIndex = 0;
  view.setAttribute("aria-label", t("canvas"));
  const layer = h("div", "uf-layer");
  const links = svg("svg", { class: "uf-links", "aria-hidden": "true" });
  const labels = h("div", "uf-labels");
  const defs = markers(uid), tmp = svg("path", { class: "uf-temp" });
  view.append(layer);
  const play = h("div", "uf-play"); // prototype view: filled by player()
  const insp = h("div", "uf-insp"); // properties of what is selected while editing
  insp.hidden = true;
  const note = h("div", "uf-note"); // why an edit was refused (a cap); clears itself
  note.setAttribute("role", "status");
  note.hidden = true;
  const zform = h("div", "uf-panel uf-zform"); // + Từ Zeplin: link → read → one new screen
  zform.hidden = true;
  main.append(view, play);
  if (opts.edit) main.append(insp, zform, note);
  let noteTimer = 0;
  /** A short note at the foot of the map (why an edit was refused, a hint); `stay`: up until the next say ("" hides). */
  function say(text, stay = false) {
    note.textContent = text;
    note.hidden = !text;
    clearTimeout(noteTimer);
    if (text && !stay) noteTimer = setTimeout(() => { note.hidden = true; }, NOTE_MS);
  }
  root.append(bar, main);
  host.replaceChildren(root);

  // Keep unchanged nodes mounted: editing one property must not decode every screenshot again.
  let rendered = new Map();
  function syncNodes(parent, nodes) {
    const keep = new Set(nodes);
    for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
    nodes.forEach((node, i) => { if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] || null); });
  }
  const finder = createFinder({ t, uid, view, get: () => cur, frames: () => frames,
    goTo: (id) => goto(id, !reduced.matches),
    selectScreen: (id) => { if (editing && shown === "map") ed.pick({ t: "screen", id }); },
  });
  main.append(finder.element); // over the map's top left corner, in both views

  // ---------------- + Từ Zeplin (zeplin-form.js): a checked link, read once, one new screen
  const zeplinForm = zeplinFormOf({ t, zform, view, lookup: opts.lookup, get: () => cur, anchor: () => bZep,
    addScreens: (list, also) => ed.addScreens(list, also),
    show: (id) => show(id, !reduced.matches), goto: (id) => goto(id, !reduced.matches),
    opened: (open) => bZep?.setAttribute("aria-expanded", String(open)) });

  function render() {
    const had = root.contains(document.activeElement);
    const linked = new Set(cur.links.map((l) => l.src));
    const previous = frames, next = new Map(), changed = new Set();
    frames = new Map(cur.screens.map((s) => {
      const isStart = s.id === startOf(cur);
      const key = JSON.stringify([{ ...s, x: undefined, y: undefined }, editing, isStart,
        [s.id, ...s.items.map((it) => `${s.id}.${it.id}`)].map((id) => linked.has(id))]);
      const shot = shotOf(s), old = rendered.get(s.id);
      // a new read of the same design (the live one after the kept one): the frame stays, no image drawn again;
      // one whose image failed to load is drawn again from the new read
      const sameShotOk = !!old && sameShot(old.shot, shot) && !(old.shot !== shot && previous.get(s.id)?.querySelector("img[data-bad]"));
      const frame = old?.key === key && sameShotOk ? previous.get(s.id) : buildFrame(s, t, linked, editing, isStart);
      if (old && old.kind !== s.kind) frame.classList.add("uf-morph"); // screen ↔ popup / sheet / toast: the new shape eases in
      placeFrame(frame, s);
      if (!old || old.key !== key || !sameShotOk || old.x !== s.x || old.y !== s.y) changed.add(s.id);
      next.set(s.id, { key, shot, x: s.x, y: s.y, kind: s.kind });
      return [s.id, frame];
    }));
    rendered = next;
    const nodes = [...frames.values()].sort((a, b) => a.classList.contains("uf-ov") - b.classList.contains("uf-ov"));
    memo.sync();
    syncNodes(layer, [...nodes, links, labels, memo.el]);
    drawLinks(changed);
    if (focusId && !frames.has(focusId)) focusId = null;
    applyFocus();
    finder.sync();
    ed.sync();
    if (bUndo) { bUndo.disabled = !hist.length; bRedo.disabled = !fut.length; }
    if (shown === "play") proto.refresh();
    if (had && !root.contains(document.activeElement)) view.focus({ preventScroll: true }); // Delete / ⌘Z keep working // in Map the phone is hidden: no DOM to rebuild, no hash to write
  }
  const atMid = (el, mid) => { el.style.transform = `translate(${r1(mid.x)}px,${r1(mid.y)}px) translate(-50%,-50%)`; };
  function drawLinks(changed = cur.screens.map((s) => s.id)) {
    const by = new Map(cur.screens.map((s) => [s.id, s])), paths = [], labs = [], knobs = [];
    const previous = marks;
    marks = cur.links.map((l, i) => {
      const key = JSON.stringify([l, editing]);
      const old = previous[i];
      if (old?.key === key) { old.l = l; paths.push(old.path); if (old.lab) labs.push(old.lab); if (old.knob) knobs.push(old.knob); return old; }
      const ends = linkEnds(l, by), g = curve(ends), dashed = l.act === "back" || l.act === "close";
      const path = svg("path", { d: g.d, class: `uf-link uf-${l.act}${dashed ? " uf-back" : ""}`,
        "marker-end": `url(#${uid}-${dashed ? "b" : "a"})`, "data-i": i });
      paths.push(path);
      const text = linkText(l);
      let lab = null;
      if (text) {
        lab = h("div", "uf-label", text);
        lab.dataset.i = i;
        atMid(lab, g.mid);
        labs.push(lab);
      }
      let knob = null;
      if (editing) {
        knob = svg("circle", { class: "uf-handle", r: 9, cx: r1(ends.q.x), cy: r1(ends.q.y), "data-i": i,
          "data-link": `${l.src}>${l.to}` });
        knobs.push(knob);
      }
      return { l, i, key, path, lab, knob, a: scr(l.src), b: l.to };
    });
    syncNodes(links, [defs, tmp, ...paths, ...knobs]);
    syncNodes(labels, labs);
    moveLinks(changed, by);
    tempLink(null);
  }
  /** Redraw just the arrows that touch `ids` (a Set / array of screen ids), in place. */
  function moveLinks(ids, by = new Map(cur.screens.map((s) => [s.id, s]))) {
    const on = new Set(ids);
    for (const m of marks) {
      if (!on.has(m.a) && !on.has(m.b)) continue;
      const ends = linkEnds(m.l, by), g = curve(ends);
      m.path.setAttribute("d", g.d);
      if (m.lab) atMid(m.lab, g.mid);
      if (m.knob) { m.knob.setAttribute("cx", r1(ends.q.x)); m.knob.setAttribute("cy", r1(ends.q.y)); }
    }
  }
  function moveScreens(ids, by = new Map(cur.screens.map((s) => [s.id, s]))) {
    for (const id of ids) placeFrame(frames.get(id), by.get(id));
    moveLinks(ids, by);
  }
  /** One arrow following the pointer while its head is dragged. */
  function liveLink(m, p, by = new Map(cur.screens.map((s) => [s.id, s]))) {
    const ends = linkEnds(m.l, by);
    m.path.setAttribute("d", curve({ p: ends.p, dir: ends.dir, q: p, n: { x: -1, y: 0 } }).d);
    m.knob.setAttribute("cx", r1(p.x));
    m.knob.setAttribute("cy", r1(p.y));
  }
  /** The dashed arrow drawn while a new link is being dragged out of a dot. */
  function tempLink(from, to) {
    if (!from) return tmp.removeAttribute("d");
    tmp.setAttribute("d", curve({ p: from, dir: { x: 1, y: 0 }, q: to, n: { x: -1, y: 0 } }).d);
  }
  function applyFocus() {
    if (focusLink !== null && !marks[focusLink]) focusLink = null;
    const any = focusId !== null || focusLink !== null || focusAc !== null;
    const hasAc = (ac) => acCodes(ac).some((x) => focusAc.includes(x)); // an AC chip was pressed: what carries one of its codes
    root.classList.toggle("uf-focus", any);
    const near = new Set([focusId]);
    for (const [id, p] of parents(cur)) {
      if (p === focusId) near.add(id); // its popups
      if (id === focusId && p) near.add(p); // the screen under it
    }
    for (const m of marks) {
      const on = focusAc ? hasAc(m.l.ac) : focusLink !== null ? m.i === focusLink : focusSrc !== null ? m.l.src === focusSrc
        : focusId !== null && (m.a === focusId || m.b === focusId);
      if (on && !focusAc) { near.add(m.a); near.add(m.b); }
      m.path.classList.toggle("uf-on", on);
      m.lab?.classList.toggle("uf-on", on);
      m.knob?.classList.toggle("uf-on", on);
    }
    const acOn = focusAc && new Set(cur.screens.filter((s) => hasAc(s.ac)).map((s) => s.id));
    frames.forEach((f, id) => f.classList.toggle("uf-on", any && (acOn ? acOn.has(id) : near.has(id))));
  }
  let picked = false; // the focus is the editor's selection, not a screen the user went to: Prototype ignores it
  function setFocus(id, link = null, byEdit = false, src = null, ac = null) { // src: "screen.item", the button in hand (edit)
    focusAc = ac;
    focusId = id;
    focusLink = link;
    focusSrc = src;
    picked = byEdit;
    applyFocus();
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const cam = camera(view, layer, {
    reduced,
    onZoom: (k) => { // one variable for every frame label, and a class once the frames are big enough to read
      layer.style.setProperty("--zk", String(k));
      view.classList.toggle("uf-near", k >= LABEL_HIDE);
    },
    onTap: (target) => {
      if (editing) return ed.tap(target && layer.contains(target) ? target : null);
      const chip = target?.closest?.(".uf-ac, .uf-lac"); // an AC chip: light what carries its codes; again: clear
      if (chip && layer.contains(chip)) {
        const want = acCodes(chip.textContent);
        return setFocus(null, null, false, null, focusAc && want.join() === focusAc.join() ? null : want);
      }
      const f = target?.closest?.(".uf-screen");
      setFocus(f && layer.contains(f) ? f.dataset.id : null);
    },
  });
  cleanup.push(() => cam.destroy());
  const fitAll = (animate) => cam.fit(bounds([...cur.screens, ...(cur.memos || [])], FIT_TALL), animate); // a note: a screen's box
  /** The one way the flow changes. Refused while a drag is in flight: that gesture holds the screen objects
   *  and the frames of the current render, and a rebuild under it would strand them (and could commit half a
   *  link). A change that changes nothing costs no undo step. */
  const commit = (next, before = JSON.stringify(cur), merge = null) => {
    if (ed.busy()) return;
    const laid = layout(next), now = JSON.stringify(laid);
    if (now === before) return;
    const at = Date.now();
    // a run of arrow-key steps on one thing is one undo step (the first one's "before" stays on the stack)
    if (!(merge && merging?.key === merge && at - merging.at < MERGE_MS && hist.length)) hist.push(before);
    merging = merge ? { key: merge, at } : null;
    fut = [];
    if (hist.length > UNDO) hist.shift();
    cur = laid;
    render();
    opts.onChange?.(structuredClone(cur), now !== base);
  };
  /** The world point in the middle of the view: where a new screen or note lands. */
  const centre = () => {
    const c = cam.get();
    return { x: (view.clientWidth / 2 - c.x) / c.k, y: (view.clientHeight / 2 - c.y) / c.k };
  };
  const ed = editor({
    t, insp, cam, view, layer, root,
    on: () => editing && shown === "map",
    get: () => cur,
    commit,
    marks: () => marks,
    frames: () => frames,
    moveScreens,
    liveLink,
    tempLink,
    drawAll: drawLinks,
    focus: (sel) => (sel?.t === "link" ? setFocus(null, sel.i, true)
      : setFocus(sel ? sel.id : null, null, true, sel?.t === "item" ? `${sel.id}.${sel.item}` : null)),
    note: say,
    centre,
    show: (id) => show(id, !reduced.matches),
  });
  cleanup.push(() => ed.destroy());
  const memo = memos({ t, cam, view, root, get: () => cur, commit, say, editing: () => editing && shown === "map",
    button: () => bMemo });
  const setStart = (id) => { const f = structuredClone(cur); f.start = id; commit(f); seenStart = startOf(cur); };
  let seenStart = startOf(cur); // the start screen Prototype last knew: changed on the map since, it begins there
  const proto = player(play, { flow: () => cur, t, reduced, setStart: opts.edit ? setStart : null, onGo: (id) => { if (shown === "play") { here = id; setFocus(id); writeHash(); } } });
  cleanup.push(() => proto.destroy());

  const onKey = (e) => {
    const tag = e.target?.tagName;
    if (e.target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA") return;
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      return e.shiftKey || e.key === "y" || e.key === "Y" ? api.redo() : api.undo();
    }
    if (editing && shown === "map" && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      return ed.remove();
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.key === "Enter" && editing && shown === "map" && e.target?.tagName !== "BUTTON" && ed.drawDefault()) {
      e.preventDefault();
      return;
    }
    if (dir && editing && shown === "map" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const sel = ed.selected(), step = sel?.t === "item" ? (e.shiftKey ? 10 : 2) : e.shiftKey ? 100 : 10;
      if (ed.nudge(dir[0] * step, dir[1] * step)) e.preventDefault();
      return;
    }
    if (e.key !== "Escape") return;
    if (ed.busy()) return ed.cancel();
    if (ed.stopDraw() || memo.stop()) return;
    if (!zform.hidden) return zeplinForm(false);
    if (shown === "play") proto.escape();
    else if (editing && ed.selected()) ed.clear();
    else if (finder.hasMatches()) finder.clear();
    else setFocus(null);
  };
  root.addEventListener("keydown", onKey);
  // a press outside "+ Từ Zeplin" closes it, as Esc does; the press still does what it does there (select a
  // screen, pan). The toolbar is its home, not outside: Hoàn tác keeps it open. Capture: before the editor or the
  // camera takes the pointer.
  const onOutside = (e) => {
    const t = e.target;
    if (!(t instanceof Node) || bar.contains(t)) return;
    if (!zform.hidden && !zform.contains(t) && !bZep?.contains(t)) zeplinForm(false);
  };
  document.addEventListener("pointerdown", onOutside, true);

  // hash (#s=<screen>&m=play): read on mount, written only when standalone
  function writeHash() {
    if (!standalone) return;
    const q = new URLSearchParams();
    if (here) q.set("s", here);
    if (shown === "play") q.set("m", "play");
    history.replaceState(history.state, "", "#" + q);
  }
  /** Bring a screen into view; false when it is not in the flow. */
  function show(id, animate) {
    const s = cur.screens.find((x) => x.id === id);
    // with a margin round it (FOCUS of its size each side): its neighbours and arrows stay in sight
    if (s) cam.fit({ x: s.x - W * FOCUS, y: s.y - H * FOCUS, w: W * (1 + 2 * FOCUS), h: H * (1 + 2 * FOCUS) }, animate);
    return !!s;
  }
  function goto(id, animate) {
    if (!show(id, animate)) return;
    here = id;
    setFocus(id);
    if (shown === "play") proto.open(id);
    writeHash();
  }
  const ids = (f) => f.screens.map((s) => s.id).join("\n");
  const api = {
    get: () => structuredClone(cur),
    /** Replace the flow and treat it as clean; refit only when the set of screens changed. */
    set(f) {
      ed.cancel(); // whatever the pointer was doing points at the flow that is being replaced
      const before = ids(cur), was = DEVICE;
      cur = sanitize(f);
      if (DEVICE !== was) { // a re-render for the other platform: every frame is another size, none is reused
        rendered = new Map();
        frameSize();
        proto.resize();
      }
      cur = layout(clearTall(freeShots(cur)));
      base = JSON.stringify(cur);
      hist = [];
      fut = [];
      merging = null;
      ed.clear();
      render();
      if (ids(cur) !== before || DEVICE !== was) fitAll(false);
    },
    mode(m) {
      if (m !== "map" && m !== "play") return;
      ed.cancel(); // hiding the map mid-drag would leave the gesture holding frames nobody can see
      shown = m;
      root.dataset.mode = m;
      bMap.setAttribute("aria-pressed", String(m === "map"));
      bPlay.setAttribute("aria-pressed", String(m === "play"));
      if (m === "play") {
        // a screen picked on the map: Prototype goes on from it; none picked since: where the user was
        const first = startOf(cur);
        if (focusId && focusId !== here && !picked) proto.open(focusId);
        else if (first !== seenStart) proto.open(first);
        else proto.start(here);
        seenStart = first;
        proto.refresh(); // a path kept from an earlier visit may name screens an edit has since removed
      }
      writeHash();
    },
    goto: (id) => goto(id, true),
    /** The flow's own name (the dashboard's header; "" drops it): one edit, one undo step. */
    title(name) {
      const f = structuredClone(cur), v = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, CAP_TITLE);
      if (v) f.title = v;
      else delete f.title;
      commit(f);
    },
    /** New Zeplin images ({url: shot}): frames redraw, positions stay. */
    shots(map) {
      // the same designs read again (only their image links signed anew): every frame stays as it is, so nothing
      // redraws and a drag goes on; an image that failed to load is drawn again from the new link
      const was = SHOTS, urls = Object.keys(map || {});
      const same = urls.length === Object.keys(was).length && urls.every((u) => sameShot(was[u], map[u]))
        && !layer.querySelector("img[data-bad]");
      setShots(map);
      if (same) return;
      ed.cancel();
      render();
    },
    fit: () => fitAll(true),
    /** Steps back through `hist` (snapshots pushed by edits, Task 7). */
    undo() {
      if (!hist.length || ed.busy()) return;
      fut.push(JSON.stringify(cur));
      cur = JSON.parse(hist.pop());
      merging = null;
      render();
      opts.onChange?.(structuredClone(cur), JSON.stringify(cur) !== base);
    },
    /** Steps forward again through what undo took back; any new edit clears it. */
    redo() {
      if (!fut.length || ed.busy()) return;
      hist.push(JSON.stringify(cur));
      cur = JSON.parse(fut.pop());
      merging = null;
      render();
      opts.onChange?.(structuredClone(cur), JSON.stringify(cur) !== base);
    },
    destroy() {
      cam.destroy();
      proto.destroy();
      ed.destroy();
      clearTimeout(noteTimer);
      document.removeEventListener("pointerdown", onOutside, true);
      host.replaceChildren();
      host.uiflow = null;
    },
  };

  cleanup.push(() => { clearTimeout(noteTimer); document.removeEventListener("pointerdown", onOutside, true); });

  render();
  const hs = readHash(); // before the first writeHash, which mode() runs
  api.mode("map");
  if (hs.s && frames.has(hs.s)) goto(hs.s, false); // a goto() before the view has a size replaces the pending camera
  else fitAll(false);
  if (hs.m === "play") api.mode("play");
  return api;
  } catch (error) {
    for (const dispose of cleanup.reverse()) dispose();
    host.replaceChildren();
    throw error;
  }
}

export { mounts, mount };
