import { createFinder } from './finder.js';
import { injectStyle } from './styles.js';
import { tr } from './i18n.js';
import { SHOTS, setShots, shotOf } from './shots.js';
import { parents, sanitize } from './model.js';
import { layout, sharedLead } from './layout.js';
import { bounds, curve, freeShots, linkEnds, linkText, r1 } from './geometry.js';
import { btn, h, placeFrame, svg } from './dom.js';
import { readHash, saveFile } from './standalone.js';
import { buildFrame, markers } from './frames.js';
import { CAP, CAP_URL, H, LABEL_HIDE, MAX_SCREENS, MERGE_MS, NOTE_MS, UNDO, W, ZEPLIN } from './constants.js';
import { canon, scr, startOf, str } from './values.js';
import { KIND_ORDER, brokenRows, checklist, gaps, stepText, testPaths } from './checks.js';
import { camera } from './camera.js';
import { editor } from './editor.js';
import { player } from './player.js';

// ------------------------------------------------------------------ mount
let mounts = 0;
/** src: the page's own HTML when standalone (enables "Lưu file" and hash writing), else null. */
function mount(host, flow, opts = {}, src = null) {
  const cleanup = [];
  try {
  injectStyle();
  const lang = opts.lang || (/^vi/i.test(navigator.language || "") ? "vi" : "en");
  const t = tr(lang), uid = "uf" + ++mounts;

  // state
  setShots(opts.shots);
  const first = sanitize(flow);
  let cur = layout(freeShots(first.flow)), dropped = first.dropped, base = JSON.stringify(cur), hist = [], issues = [];
  let fut = [], merging = null; // fut: what undo took back (redo); merging: {key, at} of the last mergeable step
  let shown = "map", focusId = null, here = null, editing = false;
  let frames = new Map(), marks = []; // marks: [{path, lab, a, b}] per link, for focus dimming

  // shell
  const root = h("div", "uf-root");
  root.dataset.mode = shown;
  const bar = h("div", "uf-bar");
  let bAdd = null, bZep = null, bUndo = null, bRedo = null;
  const seg = h("div", "uf-seg");
  seg.setAttribute("role", "group");
  const bMap = btn(t("map"), "uf-btn", () => api.mode("map"));
  const bPlay = btn(t("play"), "uf-btn", () => api.mode("play"));
  seg.append(bMap, bPlay);
  bar.append(seg);
  if (opts.edit) {
    const bEdit = btn(t("edit"), "uf-btn uf-editbtn", () => {
      ed.cancel(); // the handles this render draws are about to be replaced
      editing = !editing;
      bEdit.setAttribute("aria-pressed", String(editing));
      root.classList.toggle("uf-editing", editing);
      if (!editing) { ed.clear(); zeplinForm(false); }
      render(); // the dots and arrow handles only exist while editing
    });
    bEdit.setAttribute("aria-pressed", "false");
    bAdd = btn(t("addScreen"), "uf-btn uf-add", () => ed.addScreen());
    bZep = btn(t("fromZeplin"), "uf-btn uf-add", () => zeplinForm(true));
    bZep.setAttribute("aria-expanded", "false");
    bUndo = btn(t("undo"), "uf-btn uf-add", () => api.undo());
    bRedo = btn(t("redo"), "uf-btn uf-add", () => api.redo());
    bar.append(bEdit, bAdd, bZep, btn(t("relayout"), "uf-btn uf-add", () => ed.relayout()), bUndo, bRedo);
  }
  const bFit = btn(t("fit"), "uf-btn uf-fit", () => api.fit());
  bar.append(h("span", "uf-sp"), bFit);
  const bCheck = btn("", "uf-btn", togglePanel);
  bCheck.setAttribute("aria-expanded", "false");
  bar.append(bCheck);
  if (src !== null) bar.append(btn(t("save"), "uf-btn", () => saveFile(src, cur)));

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
  const panel = h("div", "uf-panel");
  panel.hidden = true;
  const insp = h("div", "uf-insp"); // properties of what is selected while editing
  insp.hidden = true;
  const note = h("div", "uf-note"); // why an edit was refused (a cap); clears itself
  note.setAttribute("role", "status");
  note.hidden = true;
  const zform = h("div", "uf-panel uf-zform"); // + Từ Zeplin: link → read → one new screen
  zform.hidden = true;
  main.append(view, play, panel);
  if (opts.edit) main.append(insp, zform, note);
  let noteTimer = 0;
  function say(text) {
    note.textContent = text;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; }, NOTE_MS);
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
  bar.insertBefore(finder.element, bFit);

  // ---------------- + Từ Zeplin: a checked link, read once (opts.lookup, the dashboard's), one new screen
  let zTry = 0;
  function zeplinForm(open) {
    zTry++; // a read still in flight answers a form that is gone
    if (open && !panel.hidden) togglePanel();
    zform.hidden = !open;
    bZep?.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const i = h("input", "uf-input");
    i.type = "url";
    i.placeholder = "https://app.zeplin.io/project/…/screen/…";
    const lab = h("label", "uf-field");
    lab.append(h("span", "uf-flab", t("zUrl")), i);
    const msg = h("p", "uf-zmsg");
    msg.setAttribute("role", "status");
    const acts = h("div", "uf-acts uf-chips");
    const say2 = (text, err, ...buttons) => {
      msg.textContent = text;
      msg.classList.toggle("uf-err", !!err);
      acts.replaceChildren(add, ...buttons, btn(t("close"), "uf-btn", () => zeplinForm(false)));
    };
    const run = async (mode) => { // mode: undefined | "copy" (duplicate allowed) | "plain" (no image read)
      const url = i.value.trim(), me = ++zTry;
      if (!ZEPLIN.test(url) || url.length > CAP_URL) return say2(t("badZeplin"), true);
      const dup = cur.screens.find((s) => s.zeplin && canon(s.zeplin) === canon(url));
      if (dup && mode !== "copy") {
        goto(dup.id, !reduced.matches);
        return say2(t("zDup", { s: dup.title }), false, btn(t("zCopy"), "uf-btn", () => run("copy")));
      }
      if (cur.screens.length >= MAX_SCREENS) return say2(t("maxScreens", { n: MAX_SCREENS }), true);
      let shot = null;
      if (opts.lookup && mode !== "plain") {
        say2(t("zReading"));
        add.disabled = true;
        const again = btn(t("zRetry"), "uf-btn", () => run(mode)), keep = btn(t("zKeep"), "uf-btn", () => run("plain"));
        try {
          shot = await opts.lookup(url);
        } catch (e) {
          if (me !== zTry) return;
          add.disabled = false;
          return say2(`${t("zFail")}: ${e instanceof Error ? e.message : String(e)}`, true, again, keep);
        }
        if (me !== zTry) return;
        add.disabled = false;
        if (!shot) return say2(t("zMissing"), true, again, keep);
      }
      if (shot) setShots({ ...SHOTS, [url]: shot }); // drawn at once; the host's own shots replace it later
      const title = str(shot?.title).replace(/\s+/g, " ").trim().slice(0, CAP);
      const id = ed.addScreen({ zeplin: url, ...(title ? { title } : {}) });
      if (id === null) return say2(t("dragging"), true);
      zeplinForm(false);
      goto(id, !reduced.matches);
    };
    const add = btn(t("zAdd"), "uf-btn", () => run());
    i.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); run(); }
      else if (e.key === "Escape") { e.preventDefault(); zeplinForm(false); view.focus({ preventScroll: true }); }
    });
    say2("", false);
    zform.replaceChildren(h("h2", "uf-ztitle", t("fromZeplin").replace(/^\+ /, "")), lab, msg, acts);
    i.focus();
  }

  function render() {
    const had = root.contains(document.activeElement);
    const linked = new Set(cur.links.map((l) => l.src));
    const lead = sharedLead(cur);
    const previous = frames, next = new Map(), changed = new Set();
    frames = new Map(cur.screens.map((s) => {
      const isStart = s.id === startOf(cur);
      const key = JSON.stringify([{ ...s, x: undefined, y: undefined }, editing, lead, isStart,
        [s.id, ...s.items.map((it) => `${s.id}.${it.id}`)].map((id) => linked.has(id))]);
      const shot = shotOf(s), old = rendered.get(s.id);
      const frame = old?.key === key && old.shot === shot ? previous.get(s.id) : buildFrame(s, t, linked, editing, lead, isStart);
      placeFrame(frame, s);
      if (!old || old.key !== key || old.shot !== shot || old.x !== s.x || old.y !== s.y) changed.add(s.id);
      next.set(s.id, { key, shot, x: s.x, y: s.y });
      return [s.id, frame];
    }));
    rendered = next;
    const nodes = [...frames.values()].sort((a, b) => a.classList.contains("uf-ov") - b.classList.contains("uf-ov"));
    syncNodes(layer, [...nodes, links, labels]);
    drawLinks(changed);
    if (focusId && !frames.has(focusId)) focusId = null;
    applyFocus();
    finder.sync();
    refreshChecks();
    ed.sync();
    if (bUndo) { bUndo.disabled = !hist.length; bRedo.disabled = !fut.length; }
    if (bAdd) {
      bAdd.disabled = cur.screens.length >= MAX_SCREENS;
      bAdd.title = bAdd.disabled ? t("maxScreens", { n: MAX_SCREENS }) : "";
    }
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
    root.classList.toggle("uf-focus", focusId !== null);
    const near = new Set([focusId]);
    for (const [id, p] of parents(cur)) {
      if (p === focusId) near.add(id); // its popups
      if (id === focusId && p) near.add(p); // the screen under it
    }
    for (const m of marks) {
      const on = focusId !== null && (m.a === focusId || m.b === focusId);
      if (on) { near.add(m.a); near.add(m.b); }
      m.path.classList.toggle("uf-on", on);
      m.lab?.classList.toggle("uf-on", on);
    }
    frames.forEach((f, id) => f.classList.toggle("uf-on", focusId !== null && near.has(id)));
  }
  function setFocus(id) {
    focusId = id;
    applyFocus();
  }

  // flow check panel
  function refreshChecks() {
    issues = [...brokenRows(dropped, t), ...gaps(cur, t)];
    bCheck.textContent = t("check", { n: issues.length });
    if (!panel.hidden) fillPanel();
  }
  let panelTab = "gaps", panelKind = null; // what the panel shows: the review list (filtered by kind) or the checklist
  const chip = (label, on, fn) => {
    const b = btn(label, "uf-btn", fn);
    b.setAttribute("aria-pressed", String(on));
    return b;
  };
  function fillPanel() {
    const tabs = h("div", "uf-ptabs");
    tabs.setAttribute("role", "group");
    tabs.append(chip(t("gapsTab", { n: issues.length }), panelTab === "gaps", () => { panelTab = "gaps"; fillPanel(); }),
      chip(t("testsTab"), panelTab === "tests", () => { panelTab = "tests"; fillPanel(); }));
    if (panelTab === "tests") return panel.replaceChildren(tabs, ...testsView());
    if (!issues.length) return panel.replaceChildren(tabs, h("p", "uf-none", t("ok")));
    const counts = new Map();
    for (const it of issues) counts.set(it.kind, (counts.get(it.kind) || 0) + 1);
    if (panelKind && !counts.has(panelKind)) panelKind = null;
    const filter = h("div", "uf-pfilter");
    filter.setAttribute("role", "group");
    filter.append(chip(t("all", { n: issues.length }), !panelKind, () => { panelKind = null; fillPanel(); }),
      ...KIND_ORDER.filter((k) => counts.has(k)).map((k) =>
        chip(`${t("k_" + k)} (${counts.get(k)})`, panelKind === k, () => { panelKind = k; fillPanel(); })));
    const rows = issues.filter((it) => !panelKind || it.kind === panelKind).map((it) => {
      const b = btn(null, "uf-issue", () => {
        togglePanel();
        if (!it.screen) return;
        api.goto(it.screen);
        // editing: open what the row is about, so its fix (draw the area, link it, add the AC) is one click away
        if (editing && shown === "map") ed.pick(it.item ? { t: "item", id: it.screen, item: it.item } : { t: "screen", id: it.screen });
      });
      b.append(h("span", "uf-tag uf-tag-" + it.kind, t("k_" + it.kind)), h("span", "uf-txt", it.text));
      return b;
    });
    panel.replaceChildren(tabs, filter, ...rows);
  }
  function testsView() {
    const { paths, missed } = testPaths(cur), first = startOf(cur), title = (id) => cur.screens.find((s) => s.id === id)?.title;
    if (!paths.length) return [h("p", "uf-none", t("noPaths"))];
    const text = checklist(cur, t), msg = h("p", "uf-zmsg");
    msg.setAttribute("role", "status");
    const copy = btn(t("copy"), "uf-btn", async () => {
      try {
        await navigator.clipboard.writeText(text);
        msg.textContent = t("copied");
      } catch {
        msg.textContent = t("copyFail");
      }
    });
    const list = h("ol", "uf-paths");
    for (const p of paths) list.append(h("li", null, `${title(first)} → ${p.map((l) => stepText(cur, l, t)).join(" → ")}`));
    const out = [h("p", "uf-count", text.split("\n")[0]), list];
    if (missed.length) out.push(h("p", "uf-none", t("missed", { s: missed.map((l) => `${title(scr(l.src))} → ${title(l.to)}`).join("; ") })));
    const acts = h("div", "uf-acts");
    acts.append(copy);
    out.push(acts, msg);
    return out;
  }
  function togglePanel() {
    if (panel.hidden && !zform.hidden) zeplinForm(false);
    panel.hidden = !panel.hidden;
    bCheck.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) fillPanel();
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
      const f = target?.closest?.(".uf-screen");
      setFocus(f && layer.contains(f) ? f.dataset.id : null);
    },
  });
  cleanup.push(() => cam.destroy());
  const fitAll = (animate) => cam.fit(bounds(cur.screens), animate);
  /** The one way the flow changes. Refused while a drag is in flight: that gesture holds the screen objects
   *  and the frames of the current render, and a rebuild under it would strand them (and could commit half a
   *  link). A change that changes nothing costs no undo step. */
  const commit = (next, before = JSON.stringify(cur), merge = null) => {
    if (ed.busy()) return;
    const laid = layout(next), now = JSON.stringify(laid);
    if (now === before) return;
    dropped = sanitize(next).dropped; // the "Dữ liệu hỏng" rows describe what is on screen now, as api.set does
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
    note: say,
    centre: () => {
      const c = cam.get();
      return { x: (view.clientWidth / 2 - c.x) / c.k, y: (view.clientHeight / 2 - c.y) / c.k };
    },
  });
  cleanup.push(() => ed.destroy());
  const proto = player(play, { flow: () => cur, t, reduced, onGo: (id) => { if (shown === "play") { here = id; writeHash(); } } });
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
    if (ed.stopDraw()) return;
    if (!zform.hidden) return zeplinForm(false);
    if (!panel.hidden) togglePanel();
    else if (shown === "play") proto.escape();
    else if (editing && ed.selected()) ed.clear();
    else if (finder.hasMatches()) finder.clear();
    else setFocus(null);
  };
  root.addEventListener("keydown", onKey);

  // hash (#s=<screen>&m=play): read on mount, written only when standalone
  function writeHash() {
    if (src === null) return;
    const q = new URLSearchParams();
    if (here) q.set("s", here);
    if (shown === "play") q.set("m", "play");
    history.replaceState(history.state, "", "#" + q);
  }
  function goto(id, animate) {
    const s = cur.screens.find((x) => x.id === id);
    if (!s) return;
    here = id;
    setFocus(id);
    cam.fit({ x: s.x, y: s.y, w: W, h: H }, animate);
    if (shown === "play") proto.open(id);
    writeHash();
  }
  const ids = (f) => f.screens.map((s) => s.id).join("\n");
  const api = {
    get: () => structuredClone(cur),
    /** Replace the flow and treat it as clean; refit only when the set of screens changed. */
    set(f) {
      ed.cancel(); // whatever the pointer was doing points at the flow that is being replaced
      const before = ids(cur);
      ({ flow: cur, dropped } = sanitize(f));
      cur = layout(freeShots(cur));
      base = JSON.stringify(cur);
      hist = [];
      fut = [];
      merging = null;
      ed.clear();
      render();
      if (ids(cur) !== before) fitAll(false);
    },
    mode(m) {
      if (m !== "map" && m !== "play") return;
      ed.cancel(); // hiding the map mid-drag would leave the gesture holding frames nobody can see
      shown = m;
      root.dataset.mode = m;
      bMap.setAttribute("aria-pressed", String(m === "map"));
      bPlay.setAttribute("aria-pressed", String(m === "play"));
      if (m === "play") {
        proto.start(here);
        proto.refresh(); // a path kept from an earlier visit may name screens an edit has since removed
      }
      writeHash();
    },
    goto: (id) => goto(id, true),
    /** New Zeplin images ({url: shot}): frames redraw, positions stay. */
    shots(map) {
      ed.cancel();
      setShots(map);
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
      window.removeEventListener("beforeunload", onLeave);
      host.replaceChildren();
      host.uiflow = null;
    },
  };

  const onLeave = (e) => { if (JSON.stringify(cur) !== base) e.preventDefault(); };
  if (src !== null) window.addEventListener("beforeunload", onLeave);
  cleanup.push(() => { clearTimeout(noteTimer); window.removeEventListener("beforeunload", onLeave); });

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
