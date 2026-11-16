import { createFinder } from './finder.js';
import { injectStyle } from './styles.js';
import { tr } from './i18n.js';
import { setShots, shotOf } from './shots.js';
import { parents, sanitize } from './model.js';
import { layout, sharedLead } from './layout.js';
import { bounds, curve, freeShots, linkEnds, linkText, r1 } from './geometry.js';
import { btn, h, ibtn, icon, placeFrame, svg } from './dom.js';
import { readHash, saveFile } from './standalone.js';
import { buildFrame, markers } from './frames.js';
import { H, LABEL_HIDE, MERGE_MS, NOTE_MS, UNDO, W } from './constants.js';
import { scr, startOf } from './values.js';
import { KIND_ORDER, brokenRows, checklist, gaps, stepText, testPaths } from './checks.js';
import { camera } from './camera.js';
import { editor } from './editor.js';
import { zeplinForm as zeplinFormOf } from './zeplin-form.js';
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
  let shown = "map", focusId = null, focusLink = null, focusSrc = null, focusAc = null, here = null, editing = false; // focusLink: index of the arrow in hand (edit)
  let frames = new Map(), marks = []; // marks: [{path, lab, a, b}] per link, for focus dimming

  // shell
  const root = h("div", "uf-root");
  root.dataset.mode = shown;
  const bar = h("div", "uf-bar");
  let bZep = null, bUndo = null, bRedo = null;
  const seg = h("div", "uf-seg");
  seg.setAttribute("role", "group");
  const bMap = btn(t("map"), "uf-btn", () => api.mode("map"));
  const bPlay = btn(t("play"), "uf-btn", () => api.mode("play"));
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
    }, t("edit"));
    bEdit.setAttribute("aria-pressed", "false");
    bZep = btn(t("fromZeplin"), "uf-btn", () => zeplinForm(true));
    bZep.setAttribute("aria-expanded", "false");
    bUndo = ibtn("undo", t("undo"), "uf-btn", () => api.undo());
    bRedo = ibtn("redo", t("redo"), "uf-btn", () => api.redo());
    const tools = h("div", "uf-tools uf-add"); // one group, there only while editing
    tools.setAttribute("role", "group");
    tools.append(bZep, h("span", "uf-div"), ibtn("grid", t("relayout"), "uf-btn", () => ed.relayout()), bUndo, bRedo);
    bar.append(bEdit, tools);
  }
  const bFit = ibtn("fit", t("fit"), "uf-btn uf-fit", () => api.fit());
  // "back" / "close" arrows mirror the ones that lead in: about half the lines of a map. Off until asked for
  // (remembered on this browser); the ones of what is selected or focused always show.
  const bBacks = ibtn("ret", t("backs"), "uf-btn uf-fit", () => setBacks(!root.classList.contains("uf-backs")));
  function setBacks(on) {
    root.classList.toggle("uf-backs", on);
    bBacks.setAttribute("aria-pressed", String(on));
    try { localStorage.setItem("uf-backs", on ? "1" : ""); } catch { /* private mode: not remembered */ }
  }
  let backs = false;
  try { backs = localStorage.getItem("uf-backs") === "1"; } catch { /* no storage: off */ }
  setBacks(backs);
  bar.append(h("span", "uf-sp"), bBacks, bFit);
  const bCheck = btn(null, "uf-btn uf-check", togglePanel), nCheck = h("span", "uf-badge");
  bCheck.setAttribute("aria-expanded", "false");
  bCheck.append(icon("check"), h("span", null, t("check", { n: "" }).replace(/\s*\(.*$/, "")), nCheck);
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

  // ---------------- + Từ Zeplin (zeplin-form.js): a checked link, read once, one new screen
  const zeplinForm = zeplinFormOf({ t, zform, view, lookup: opts.lookup, get: () => cur,
    addScreen: (props, also) => ed.addScreen(props, also),
    show: (id) => show(id, !reduced.matches), goto: (id) => goto(id, !reduced.matches),
    opened: (open) => { if (open && !panel.hidden) togglePanel(); bZep?.setAttribute("aria-expanded", String(open)); } });

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
      if (old && old.kind !== s.kind) frame.classList.add("uf-morph"); // screen ↔ popup / sheet / toast: the new shape eases in
      placeFrame(frame, s);
      if (!old || old.key !== key || old.shot !== shot || old.x !== s.x || old.y !== s.y) changed.add(s.id);
      next.set(s.id, { key, shot, x: s.x, y: s.y, kind: s.kind });
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
      const path = svg("path", { d: g.d, class: `uf-link uf-${l.act}${dashed ? " uf-back uf-ret" : ""}`,
        "marker-end": `url(#${uid}-${dashed ? "b" : "a"})`, "data-i": i });
      paths.push(path);
      const text = linkText(l);
      let lab = null;
      if (text) {
        lab = h("div", "uf-label" + (dashed ? " uf-ret" : ""), text);
        lab.dataset.i = i;
        atMid(lab, g.mid);
        labs.push(lab);
      }
      let knob = null;
      if (editing) {
        knob = svg("circle", { class: "uf-handle" + (dashed ? " uf-ret" : ""), r: 9, cx: r1(ends.q.x), cy: r1(ends.q.y), "data-i": i,
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
    const hasAc = (ac) => acs(ac).some((x) => focusAc.includes(x)); // an AC chip was pressed: what carries one of its codes
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
  const acs = (text) => String(text).split(/[,;]/).map((x) => x.trim()).filter(Boolean); // "AC1.2, AC4.5" -> its codes
  let picked = false; // the focus is the editor's selection, not a screen the user went to: Prototype ignores it
  function setFocus(id, link = null, byEdit = false, src = null, ac = null) { // src: "screen.item", the button in hand (edit)
    focusAc = ac;
    focusId = id;
    focusLink = link;
    focusSrc = src;
    picked = byEdit;
    applyFocus();
  }

  // flow check panel
  let notes = []; // the host's warnings about how this flow was built (api.notes): rows of their own, no screen to go to
  function refreshChecks() {
    issues = [...brokenRows(dropped, t), ...notes.map((text) => ({ kind: "unclear", text })), ...gaps(cur, t)];
    bCheck.setAttribute("aria-label", t("check", { n: issues.length }));
    nCheck.textContent = String(issues.length);
    bCheck.classList.toggle("uf-clean", !issues.length);
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
      if (it.kind !== "pending" || !editing || shown !== "map") return b;
      // editing: the row asks for the step's Zeplin link (the screen comes linked from where the step was reached);
      // ✕ takes a step that will never get a screen off the list
      b.addEventListener("click", () => zeplinForm(true, it.pending));
      b.title = t("pendingAdd", { s: it.pending });
      const row = h("div", "uf-prow");
      row.append(b, ibtn("x", t("pendingSkip"), "uf-btn", () => {
        const f = structuredClone(cur);
        f.pending = (f.pending || []).filter((x) => x.title !== it.pending);
        commit(f);
      }));
      return row;
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
      const chip = target?.closest?.(".uf-ac, .uf-lac"); // an AC chip: light what carries its codes; again: clear
      if (chip && layer.contains(chip)) {
        const want = acs(chip.textContent);
        return setFocus(null, null, false, null, focusAc && want.join() === focusAc.join() ? null : want);
      }
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
    focus: (sel) => (sel?.t === "link" ? setFocus(null, sel.i, true)
      : setFocus(sel ? sel.id : null, null, true, sel?.t === "item" ? `${sel.id}.${sel.item}` : null)),
    note: say,
    centre: () => {
      const c = cam.get();
      return { x: (view.clientWidth / 2 - c.x) / c.k, y: (view.clientHeight / 2 - c.y) / c.k };
    },
  });
  cleanup.push(() => ed.destroy());
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
  /** Bring a screen into view; false when it is not in the flow. */
  function show(id, animate) {
    const s = cur.screens.find((x) => x.id === id);
    if (s) cam.fit({ x: s.x, y: s.y, w: W, h: H }, animate);
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
    /** What the render could not make sure of (plain text lines), listed in the flow check; [] clears them. */
    notes(list) {
      notes = (Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && x).slice(0, 20);
      refreshChecks();
    },
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
