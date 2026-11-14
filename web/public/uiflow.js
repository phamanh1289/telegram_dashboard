/* UI flow engine: layout, map view, flow checks. Plain JS, no dependencies.
 * Runs inside the dashboard (mounted by the app) and inside an exported, self-contained uiflow-<ticket>.html opened
 * offline. Exposes window.UIFlow only. Every label coming from data is set via textContent, never as markup.
 *
 * Sections: constants · i18n · model (normalize / layout / check) · geometry · DOM builders · camera · prototype
 * (player) · mount (render, toolbar, api) · standalone auto-run. Pure parts never touch the DOM. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ constants
  const SCREEN = Object.freeze({ w: 390, h: 844 });
  const W = SCREEN.w, H = SCREEN.h;
  const COL = W + 220, ROW = H + 120, SHIFT = 60; // column / row step; overlay offset from its parent
  const GROUP_GAP = 200; // extra space between the main flow, each separate group and the loose screens
  const LABEL_HIDE = 0.6; // from this zoom up the in-frame title (17px) reads at 10px+: the frame labels step aside
  const STATUS = 44, HEAD = 56, TOP = 120, BOTTOM = 40; // phone: status bar, nav bar, first row, home bar
  const CARD_HEAD = 60, CARD_PAD = 20, STEP = 64; // overlay card header, bottom padding; max row step
  const ZMIN = 0.1, ZMAX = 2, PAD = 32, ANIM_MS = 220;
  const SLIDE_MS = 200, TOAST_MS = 2000, FLASH_MS = 600, BEZEL = 11, GAP = 16; // prototype: motion, phone bezel, margin
  const NOTE_MS = 2600; // edit: how long a refusal note stays up
  const MERGE_MS = 1000; // arrow-key steps closer than this make one undo step
  const CAP = 80, UNDO = 50, DRAG_PX = 4; // edit: schema cap for a title / label / condition, undo depth, tap slop
  const CAP_AC = 40, CAP_URL = 300; // the backend model's caps: it truncates silently, so never store more
  const MAX_SCREENS = 60, MAX_ITEMS = 20, MAX_LINKS = 300; // past these the backend refuses the whole file
  const VERSION = 2, CAP_NOTE = 4000; // = uiflow.VERSION / MAX_NOTE: v1 is read as v2, a newer file is refused
  const KINDS = ["screen", "popup", "sheet", "toast"];
  const ACTS = ["navigate", "open", "back", "close"];
  const ZEPLIN = /^https?:\/\/(?:zpl\.io|app\.zeplin\.io|scene\.zeplin\.io)\/\S+$/; // = providers.ZEPLIN
  const SVGNS = "http://www.w3.org/2000/svg";

  // ------------------------------------------------------------------ i18n
  const T = {
    vi: {
      map: "Toàn cục", play: "Prototype", edit: "Sửa", fit: "Vừa màn hình", check: "Soát luồng ({n})",
      save: "Lưu file", zeplin: "Mở trên Zeplin", canvas: "Sơ đồ luồng màn hình",
      ok: "Không thấy lỗ hổng nào trong luồng.", bad: "Không đọc được dữ liệu UI flow trong file này.",
      orphan: "Không có đường nào dẫn tới màn “{s}”", dead: "Nút “{i}” trên màn “{s}” chưa nối tới đâu",
      noback: "Màn “{s}” chưa có đường quay lại", noacScreen: "Màn “{s}” chưa gắn AC",
      noacLink: "Mũi tên “{i}” → “{s}” chưa gắn AC",
      k_orphan: "Không lối vào", k_dead: "Nút cụt", k_noback: "Thiếu quay lại", k_noac: "Thiếu AC", k_broken: "Dữ liệu hỏng",
      dupScreen: "Bỏ màn trùng id “{s}”", dupItem: "Bỏ nút trùng id “{i}” trên màn “{s}”",
      badLinks: "Bỏ {n} liên kết hỏng", badEntries: "Bỏ {n} màn / nút không có id",
      back: "Quay lại", restart: "Bắt đầu lại", pick: "Chọn trường hợp", trail: "Đường đã đi",
      noItems: "Màn này chưa có nút",
      offShot: "Nút chưa thấy trên thiết kế",
      addScreen: "+ Màn", addItem: "+ Nút", del: "Xoá", newScreen: "Màn mới", newItem: "Nút mới",
      acField: "AC", whenField: "Điều kiện", zeplinField: "Zeplin", dotHint: "Kéo để nối",
      arrow: "Mũi tên", button: "Nút", lastScreen: "Sơ đồ cần ít nhất một màn",
      maxScreens: "Tối đa {n} màn", maxItems: "Tối đa {n} nút mỗi màn", maxLinks: "Tối đa {n} liên kết",
      dragging: "Thả chuột xong rồi hãy sửa",
      badZeplin: "Link Zeplin không đúng (zpl.io, app.zeplin.io)",
      act_navigate: "Đi tới", act_open: "Mở", act_back: "Quay lại", act_close: "Đóng",
      kind_screen: "Màn", kind_popup: "Popup", kind_sheet: "Sheet", kind_toast: "Toast",
      search: "Tìm màn: tên, nút, link Zeplin, id", found: "{n} màn", noFound: "Không thấy màn nào",
      fromZeplin: "+ Từ Zeplin", zUrl: "Link màn Zeplin", zAdd: "Thêm", zReading: "Đang đọc màn từ Zeplin…",
      zDup: "Đã có màn này: “{s}”", zCopy: "Vẫn thêm bản sao", zRetry: "Thử lại", zKeep: "Thêm màn chờ ảnh",
      zMissing: "Không đọc được màn này trên Zeplin: chưa chia sẻ với tài khoản hoặc đã bị xoá",
      zFail: "Không đọc được Zeplin", close: "Đóng",
      drawHot: "+ Vùng bấm", redraw: "Vẽ lại vùng", byText: "Khớp theo chữ", drawHint: "Kéo trên ảnh màn để vẽ vùng bấm · Enter đặt vùng giữa màn · Esc để huỷ",
      rectField: "Vùng (px)", itemsField: "Nút", noteField: "Ghi chú", noteBadge: "Có ghi chú", posField: "Vị trí", relayout: "Sắp xếp lại",
      k_offshot: "Chưa khớp ảnh", k_nosrc: "Thiếu nguồn", offshot: "Nút “{i}” chưa thấy trên ảnh màn “{s}”",
      nosrc: "Màn “{s}” chưa có link Zeplin", all: "Tất cả ({n})", gapsTab: "Cần rà soát ({n})", testsTab: "Checklist test",
      copy: "Sao chép", copied: "Đã sao chép", copyFail: "Không sao chép được — chọn chữ rồi sao chép tay",
      startBadge: "Màn bắt đầu", setStart: "Màn bắt đầu", undo: "↶ Hoàn tác", redo: "↷ Làm lại",
      tap: "bấm “{i}”", goBack: "quay lại", goClose: "đóng", goOn: "tiếp", when: "khi {s}",
      pathN: "Đường {n}", missed: "Chưa đi tới từ màn bắt đầu: {s}", noPaths: "Chưa có liên kết nào để đi.",
      testsHead: "Checklist test UI flow {s}: {n} đường, phủ {c}/{l} liên kết",
    },
    en: {
      map: "Map", play: "Prototype", edit: "Edit", fit: "Fit to screen", check: "Flow check ({n})",
      save: "Save file", zeplin: "Open in Zeplin", canvas: "Screen flow map",
      ok: "No gaps found in this flow.", bad: "Could not read the UI flow data in this file.",
      orphan: "Nothing leads to “{s}”", dead: "“{i}” on “{s}” goes nowhere",
      noback: "“{s}” has no way back", noacScreen: "“{s}” has no AC",
      noacLink: "Arrow “{i}” → “{s}” has no AC",
      k_orphan: "Unreachable", k_dead: "Dead end", k_noback: "No back", k_noac: "No AC", k_broken: "Bad data",
      dupScreen: "Dropped duplicate screen id “{s}”", dupItem: "Dropped duplicate button id “{i}” on “{s}”",
      badLinks: "Dropped {n} broken links", badEntries: "Dropped {n} screens / buttons without an id",
      back: "Back", restart: "Start over", pick: "Pick a case", trail: "Path taken",
      noItems: "No buttons on this screen yet",
      offShot: "Buttons not found on the design",
      addScreen: "+ Screen", addItem: "+ Button", del: "Delete", newScreen: "New screen", newItem: "New button",
      acField: "AC", whenField: "Condition", zeplinField: "Zeplin", dotHint: "Drag to link",
      arrow: "Arrow", button: "Button", lastScreen: "The flow needs at least one screen",
      maxScreens: "At most {n} screens", maxItems: "At most {n} buttons per screen", maxLinks: "At most {n} links",
      dragging: "Drop what you are dragging first",
      badZeplin: "Not a Zeplin link (zpl.io, app.zeplin.io)",
      act_navigate: "Navigate", act_open: "Open", act_back: "Back", act_close: "Close",
      kind_screen: "Screen", kind_popup: "Popup", kind_sheet: "Sheet", kind_toast: "Toast",
      search: "Find a screen: name, button, Zeplin link, id", found: "{n} screens", noFound: "No screen found",
      fromZeplin: "+ From Zeplin", zUrl: "Zeplin screen link", zAdd: "Add", zReading: "Reading the screen from Zeplin…",
      zDup: "This screen is already here: “{s}”", zCopy: "Add a copy anyway", zRetry: "Retry", zKeep: "Add it without the image",
      zMissing: "Could not read this screen on Zeplin: not shared with this account, or deleted",
      zFail: "Could not read Zeplin", close: "Close",
      drawHot: "+ Tap area", redraw: "Redraw area", byText: "Match by text", drawHint: "Drag on the screen image to draw a tap area · Enter puts one mid-screen · Esc to cancel",
      rectField: "Area (px)", itemsField: "Buttons", noteField: "Note", noteBadge: "Has a note", posField: "Position", relayout: "Re-arrange",
      k_offshot: "Not on design", k_nosrc: "No source", offshot: "“{i}” is not found on the image of “{s}”",
      nosrc: "“{s}” has no Zeplin link", all: "All ({n})", gapsTab: "To review ({n})", testsTab: "Test checklist",
      copy: "Copy", copied: "Copied", copyFail: "Could not copy — select the text and copy it by hand",
      startBadge: "Start screen", setStart: "Start screen", undo: "↶ Undo", redo: "↷ Redo",
      tap: "tap “{i}”", goBack: "go back", goClose: "close", goOn: "go on", when: "when {s}",
      pathN: "Path {n}", missed: "Not reachable from the start screen: {s}", noPaths: "No links to follow yet.",
      testsHead: "UI flow {s} test checklist: {n} paths, covering {c}/{l} links",
    },
  };
  /** t(key, {n, s, i}) for one language; values are inserted as plain text by the caller. */
  function tr(lang) {
    const d = T[lang] || T.vi;
    return (key, vars) => (d[key] ?? key).replace(/\{(\w)\}/g, (_, k) => String(vars?.[k] ?? ""));
  }

  // ------------------------------------------------------------------ model (pure)
  const scr = (src) => src.split(".")[0];
  const itm = (src) => (src.includes(".") ? src.slice(src.indexOf(".") + 1) : null);
  const str = (v, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
  const num = (v) => (Number.isFinite(v) ? v : null);
  /** A hand-drawn tap area {x, y, w, h} as fractions of the screen's whole image; null when it is not one (= uiflow.Rect). */
  const rectOf = (r) => {
    if (!r || typeof r !== "object") return null;
    const { x, y, w, h: hh } = r;
    const ok = [x, y, w, hh].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && hh > 0 && x + w <= 1 + 1e-9 && y + hh <= 1 + 1e-9;
    return ok ? { x, y, w, h: hh } : null;
  };
  const ZSCREEN = /\/project\/([0-9a-f]{24})\/screen\/([0-9a-f]{24})/;
  /** A Zeplin link's identity (= zeplin.canonical): project/screen ids, else the link without trailing punctuation.
   *  A zpl.io short link only resolves on the server, so two spellings of one screen may still differ here. */
  const canon = (u) => { const m = ZSCREEN.exec(str(u)); return m ? `${m[1]}/${m[2]}` : str(u).trim().replace(/[.,:;/]+$/, ""); };
  /** The screen the prototype and the test paths start from: the chosen one, else the first. */
  const startOf = (f) => (f.start && f.screens.some((s) => s.id === f.start) ? f.start : f.screens[0]?.id ?? null);
  /** Shown as a card over its parent. A popup / sheet / toast with a Zeplin image is a full frame instead (the
   *  design draws its own scrim), laid out like a screen; it still opens as an overlay in Prototype (`isPop`). */
  const isOverlay = (s) => s.kind !== "screen" && !shotOf(s);
  const isPop = (s) => s.kind !== "screen";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /** A fresh, well-formed copy plus what had to go: {flow, dropped: {screens: [dup id], items: ["s.i"], links: n,
   *  bad: n}}. Known kinds / acts, string labels, and ONLY Flow-schema fields — a hand-edited file's extras are
   *  dropped here, so what "Lưu file" writes matches what the backend model accepts. */
  function sanitize(raw) {
    const f = raw && typeof raw === "object" ? raw : {};
    // never edit a newer file: saving it would drop the fields this engine does not know
    if (Number.isFinite(f.v) && f.v > VERSION) throw new Error(`UI flow v${f.v} > v${VERSION}`);
    const dropped = { screens: [], items: [], links: 0, bad: 0 };
    const seen = new Set(), screens = [];
    for (const s of Array.isArray(f.screens) ? f.screens : []) {
      if (!s || typeof s.id !== "string") { dropped.bad++; continue; }
      if (seen.has(s.id)) { dropped.screens.push(s.id); continue; }
      seen.add(s.id);
      const ids = new Set(), items = [];
      for (const it of Array.isArray(s.items) ? s.items : []) {
        if (!it || typeof it.id !== "string") { dropped.bad++; continue; }
        if (ids.has(it.id)) { dropped.items.push(`${s.id}.${it.id}`); continue; }
        ids.add(it.id);
        const r = rectOf(it.rect);
        items.push(r ? { id: it.id, label: str(it.label, it.id), rect: r } : { id: it.id, label: str(it.label, it.id) });
      }
      screens.push({ id: s.id, title: str(s.title, s.id) || s.id, kind: KINDS.includes(s.kind) ? s.kind : "screen",
        parent: typeof s.parent === "string" ? s.parent : null, x: num(s.x), y: num(s.y),
        zeplin: str(s.zeplin), ac: str(s.ac), note: str(s.note).slice(0, CAP_NOTE), items });
    }
    const by = new Map(screens.map((s) => [s.id, s]));
    const okSrc = (src) => {
      const s = typeof src === "string" && by.get(scr(src));
      return !!s && (itm(src) === null || s.items.some((it) => it.id === itm(src)));
    };
    const all = Array.isArray(f.links) ? f.links : [];
    const links = all.filter((l) => l && okSrc(l.src) && by.has(l.to))
      .map((l) => ({ src: l.src, to: l.to, act: ACTS.includes(l.act) ? l.act : "navigate", when: str(l.when), ac: str(l.ac) }));
    dropped.links = all.length - links.length;
    // v, device and rev are literals / an int in the backend model: anything else would make the file unreadable
    const rev = Number.isFinite(f.rev) && f.rev > 0 ? Math.trunc(f.rev) : 0;
    const start = typeof f.start === "string" && by.has(f.start) ? f.start : null;
    return { flow: { v: VERSION, ticket: str(f.ticket), rev, device: "mobile", start, screens, links }, dropped };
  }
  const normalize = (raw) => sanitize(raw).flow;

  /** id -> the screen an overlay sits on: its declared parent, else the screen whose `open` link targets it; null
   *  for screens and for overlays nothing opens. One rule for layout and focus. */
  function parents(f) {
    const by = new Map(f.screens.map((s) => [s.id, s]));
    const parentOf = (s) => {
      if (!isOverlay(s)) return null;
      if (s.parent && s.parent !== s.id && by.has(s.parent)) return s.parent;
      const l = f.links.find((l) => l.to === s.id && l.act === "open" && scr(l.src) !== s.id);
      return l ? scr(l.src) : null;
    };
    return new Map(f.screens.map((s) => [s.id, parentOf(s)]));
  }

  /** Fills x / y of screens that have none; returns a new flow (the input is not touched; x / y already set stay).
   *  - Regions, left to right: the main flow (BFS over `navigate` links from the first screen), then every other
   *    linked group (BFS from its own root: a screen nothing else in the group leads to), ordered by first
   *    appearance, then the screens with no links of their own as a grid.
   *  - In a region a BFS layer is a column, in order of appearance; a column longer than the row cap wraps into
   *    sub-columns beside it. Cap = max(3, ceil(√(0.4·n))) for n screens: a frame cell is 610 × 964, so this many
   *    rows makes a full grid about 16 : 10, landscape like the screens it is read on.
   *  - The k-th popup / sheet / toast of a parent sits 60·k / 60·k right-down of it; the parent's row and its column
   *    grow by that much, so overlays never cover another screen. */
  function layout(flow) {
    const f = normalize(flow);
    const by = new Map(f.screens.map((s) => [s.id, s]));
    const par = parents(f);
    const owner = (id) => { for (let n = 0; par.get(id) && n < 20; n++) id = par.get(id); return id; };

    // overlay offsets: nth among its parent's overlays, cumulated up to the owner screen; room = owner's largest
    const nth = new Map(), count = new Map(), off = new Map(), room = new Map();
    for (const s of f.screens) {
      const p = par.get(s.id);
      if (p) { count.set(p, (count.get(p) || 0) + 1); nth.set(s.id, count.get(p)); }
    }
    const offOf = (id, guard = 0) => {
      if (!par.get(id) || guard > 20) return 0;
      if (!off.has(id)) off.set(id, offOf(par.get(id), guard + 1) + SHIFT * nth.get(id));
      return off.get(id);
    };
    for (const s of f.screens) if (par.get(s.id)) room.set(owner(s.id), Math.max(room.get(owner(s.id)) || 0, offOf(s.id)));

    // navigate links between top-level screens (an overlay's links count as its owner's)
    const next = new Map();
    for (const l of f.links) {
      const a = owner(scr(l.src)), b = owner(l.to);
      if ((l.act !== "navigate" && !(l.act === "open" && !par.get(l.to))) || a === b) continue;
      if (!next.has(a)) next.set(a, []);
      next.get(a).push(b);
    }
    const tops = f.screens.filter((s) => !par.get(s.id)).map((s) => s.id);
    const order = new Map(tops.map((id, i) => [id, i]));
    const cap = Math.max(3, Math.ceil(Math.sqrt(0.4 * tops.length)));
    const done = new Set();
    /** BFS layers from `root` over screens no region has taken yet; each layer in order of appearance. */
    function layers(root) {
      const out = [[root]];
      done.add(root);
      for (;;) {
        const n = [];
        for (const id of out[out.length - 1]) for (const k of next.get(id) || []) if (!done.has(k)) { done.add(k); n.push(k); }
        if (!n.length) return out;
        out.push(n.sort((p, q) => order.get(p) - order.get(q)));
      }
    }
    const regions = [];
    if (tops.length) regions.push(layers(owner(startOf(f))));
    const rest = tops.filter((id) => !done.has(id)), led = new Set(); // led: something else left over leads to it
    for (const id of rest) for (const k of next.get(id) || []) if (!done.has(k)) led.add(k);
    const linkedTo = new Set([...next.keys(), ...[...next.values()].flat()]); // has a navigate edge, either way
    const groups = [], lone = [];
    for (const id of [...rest.filter((r) => !led.has(r)), ...rest]) { // true roots first; then what cycles left
      if (done.has(id)) continue;
      const g = layers(id);
      if (g.length > 1 || linkedTo.has(id)) groups.push(g); // a root whose target another group took is still linked
      else lone.push(id);
    }
    const first = (g) => Math.min(...g.flat().map((id) => order.get(id)));
    regions.push(...groups.sort((p, q) => first(p) - first(q)));
    if (lone.length) regions.push([lone.sort((p, q) => order.get(p) - order.get(q))]); // one long column: wraps into a grid

    let x = 0;
    regions.forEach((cols, r) => {
      if (r) x += GROUP_GAP;
      for (const col of cols) {
        for (let i = 0; i < col.length; i += cap) {
          const part = col.slice(i, i + cap).map((id) => by.get(id));
          let y = 0;
          for (const s of part) {
            if (s.x === null || s.y === null) { s.x = x; s.y = y; }
            y += ROW + (room.get(s.id) || 0);
          }
          x += COL + Math.max(...part.map((s) => room.get(s.id) || 0));
        }
      }
    });

    const place = (s, guard) => {
      if ((s.x !== null && s.y !== null) || guard > 20) return;
      const p = by.get(par.get(s.id));
      place(p, guard + 1);
      s.x = (p.x ?? 0) + SHIFT * nth.get(s.id);
      s.y = (p.y ?? 0) + SHIFT * nth.get(s.id);
    };
    for (const s of f.screens) if (par.get(s.id)) place(s, 0);
    return f;
  }

  /** What every screen title starts with, cut back to a word break ("Ban-TSCNY "): frame labels drop it so the part
   *  that tells screens apart is what fits. "" when screens share nothing or it would leave a title empty. */
  function sharedLead(f) {
    const titles = f.screens.filter((s) => s.kind === "screen").map((s) => s.title);
    if (titles.length < 2) return "";
    let p = titles[0];
    for (const x of titles) while (!x.startsWith(p)) p = p.slice(0, -1);
    p = p.slice(0, p.lastIndexOf(" ") + 1);
    return titles.some((x) => !x.slice(p.length).trim()) ? "" : p;
  }

  /** Rows for what `sanitize` dropped (kind "broken"); screen set when there is one to go to. */
  function brokenRows(d, t) {
    return [
      ...d.screens.map((id) => ({ kind: "broken", screen: id, text: t("dupScreen", { s: id }) })),
      ...d.items.map((src) => ({ kind: "broken", screen: scr(src), item: itm(src), text: t("dupItem", { i: itm(src), s: scr(src) }) })),
      ...(d.links ? [{ kind: "broken", text: t("badLinks", { n: d.links }) }] : []),
      ...(d.bad ? [{ kind: "broken", text: t("badEntries", { n: d.bad }) }] : []),
    ];
  }
  /** Gaps in a normalized flow: orphan, dead, offshot (a button its design image does not show), noback, noac, nosrc
   *  (a screen with no design link). offshot needs the images (SHOTS): without them it reports nothing. */
  function gaps(f, t) {
    const out = [], first = startOf(f);
    const by = new Map(f.screens.map((s) => [s.id, s]));
    const into = new Set(f.links.map((l) => l.to));
    const from = new Set(f.links.map((l) => l.src));
    const back = new Set(f.links.filter((l) => l.act === "back").map((l) => scr(l.src)));
    for (const s of f.screens) {
      if (s.id !== first && !into.has(s.id)) out.push({ kind: "orphan", screen: s.id, text: t("orphan", { s: s.title }) });
      for (const it of s.items)
        if (!from.has(`${s.id}.${it.id}`))
          out.push({ kind: "dead", screen: s.id, item: it.id, text: t("dead", { s: s.title, i: it.label }) });
      if (s.kind === "screen" && s.id !== first && s.items.length && !back.has(s.id))
        out.push({ kind: "noback", screen: s.id, text: t("noback", { s: s.title }) });
      if (!s.ac) out.push({ kind: "noac", screen: s.id, text: t("noacScreen", { s: s.title }) });
      if (shotOf(s)) rowsOf(s).forEach(({ hot }, i) => {
        if (!hot) out.push({ kind: "offshot", screen: s.id, item: s.items[i].id, text: t("offshot", { s: s.title, i: s.items[i].label }) });
      });
      if (s.kind === "screen" && !s.zeplin) out.push({ kind: "nosrc", screen: s.id, text: t("nosrc", { s: s.title }) });
    }
    for (const l of f.links) {
      if (l.ac) continue;
      const s = by.get(scr(l.src)), i = itm(l.src), name = i ? s.items.find((it) => it.id === i).label : s.title;
      out.push({ kind: "noac", screen: s.id, ...(i ? { item: i } : {}), text: t("noacLink", { i: name, s: by.get(l.to).title }) });
    }
    return out;
  }
  const KIND_ORDER = ["broken", "orphan", "dead", "offshot", "noback", "noac", "nosrc"];

  /** Test paths through the graph, by code: from the start screen, every link followed once at least where it can be
   *  reached. A path ends at a screen with nothing new to go to, or on a link back to a screen it already crossed.
   *  Only paths that cover a link no earlier path did are kept. {paths: [[link]], missed: [link]}. */
  function testPaths(f, max = 60) {
    const first = startOf(f), paths = [], covered = new Set();
    if (!first) return { paths, missed: [] };
    const idx = new Map(f.links.map((l, i) => [l, i]));
    const outOf = (id) => f.links.filter((l) => scr(l.src) === id);
    let budget = 20000; // ponytail: bounded DFS; a dense 300-link graph stops early and lists the rest as missed
    const keep = (steps) => {
      if (steps.some((l) => !covered.has(idx.get(l))) || !paths.length) {
        for (const l of steps) covered.add(idx.get(l));
        paths.push(steps.slice());
      }
    };
    const dfs = (id, seen, steps) => {
      if (paths.length >= max || --budget < 0) return;
      const next = outOf(id);
      if (!next.length) return keep(steps);
      for (const l of next) {
        steps.push(l);
        if (seen.has(l.to)) keep(steps);
        else { seen.add(l.to); dfs(l.to, seen, steps); seen.delete(l.to); }
        steps.pop();
      }
    };
    dfs(first, new Set([first]), []);
    return { paths, missed: f.links.filter((l) => !covered.has(idx.get(l))) };
  }
  /** One step in words: tap "Gửi OTP" (when …) → Nhập OTP. */
  function stepText(f, l, t) {
    const by = (id) => f.screens.find((s) => s.id === id);
    const i = itm(l.src), label = i ? by(scr(l.src)).items.find((it) => it.id === i)?.label : null;
    const how = label ? t("tap", { i: label }) : t(l.act === "back" ? "goBack" : l.act === "close" ? "goClose" : "goOn");
    return `${how}${l.when ? ` (${t("when", { s: l.when })})` : ""} → ${by(l.to).title}`;
  }
  /** The checklist as plain text (what "Sao chép" puts on the clipboard). */
  function checklist(f, t) {
    const { paths, missed } = testPaths(f), by = (id) => f.screens.find((s) => s.id === id);
    const covered = f.links.length - missed.length, first = startOf(f);
    const lines = [t("testsHead", { s: f.ticket, n: paths.length, c: covered, l: f.links.length })];
    paths.forEach((p, n) => lines.push(`${n + 1}. ${by(first).title} → ${p.map((l) => stepText(f, l, t)).join(" → ")}`));
    if (missed.length) lines.push(t("missed", { s: missed.map((l) => `${by(scr(l.src)).title} → ${by(l.to).title}`).join("; ") }));
    return lines.join("\n");
  }
  /** [{kind: "broken" | "orphan" | "dead" | "offshot" | "noback" | "noac" | "nosrc", screen?, item?, text}] for a raw flow. */
  function check(flow, lang) {
    const { flow: f, dropped } = sanitize(flow), t = tr(lang);
    return [...brokenRows(dropped, t), ...gaps(f, t)];
  }

  // ------------------------------------------------------------------ Zeplin images (shots)
  // {zeplin url: {src, w, h, hits: [[label, x, y, w, h]]}} in design units, from the dashboard (or the file's own
  // block). Kept out of the flow: undo / dirty compare the flow as JSON, and images would make that heavy.
  // ponytail: one set per page (the dashboard shows one flow at a time); a map per mount if two ever share a page
  let SHOTS = {};
  const hotCache = new Map(); // "url \n labels" -> {items, back}; cleared with SHOTS
  const shotOf = (s) => (s.zeplin && SHOTS[s.zeplin]) || null;
  const norm = (v) => str(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const BACK = /(^| )(back|quay lai|tro lai|tro ve)( |$)/;
  function setShots(map) {
    SHOTS = map && typeof map === "object" ? map : {};
    hotCache.clear();
  }
  /** Where each button of `s` sits on its Zeplin image (frame units; null: label not found) and the back button:
   *  its hand-drawn rect, else same text first, then one containing the other; each hit used once, in reading order. */
  function hotspots(s, sh) {
    const key = s.zeplin + "\n" + s.items.map((i) => i.label + (i.rect ? JSON.stringify(i.rect) : "")).join("\n");
    let got = hotCache.get(key);
    if (got) return got;
    const k = W / sh.w, hits = Array.isArray(sh.hits) ? sh.hits : [], ns = hits.map((x) => norm(x[0])), used = new Set();
    const at = (j) => {
      const [, x, y, w, hh] = hits[j];
      return { x: x * k, y: y * k, w: Math.max(w * k, 24), h: Math.max(hh * k, 24) };
    };
    // best tier wins: same text, the text starts with the label ("Tìm căn hộ" + its subtitle), contains it, is
    // contained in it; within a tier, the order the server sent (buttons before titles, reading order)
    const tiers = [(x, n) => x === n, (x, n) => x.startsWith(n + " "), (x, n) => x.includes(n), (x, n) => x.length >= 3 && n.includes(x)];
    const find = (label) => {
      const n = norm(label);
      if (!n) return -1;
      for (const [i, ok] of tiers.entries()) {
        if (i > 0 && n.length < 3) return -1;
        const j = ns.findIndex((x, k) => !used.has(k) && ok(x, n));
        if (j >= 0) return j;
      }
      return -1;
    };
    const kw = W, kh = (sh.h * W) / sh.w; // a rect is a fraction of the whole image; the frame is W wide
    const items = s.items.map((it) => {
      if (it.rect) return { x: it.rect.x * kw, y: it.rect.y * kh, w: it.rect.w * kw, h: it.rect.h * kh, manual: true };
      const j = find(it.label);
      if (j < 0) return null;
      used.add(j);
      return at(j);
    });
    const b = ns.findIndex((x, i) => !used.has(i) && BACK.test(x));
    got = { items, back: b >= 0 ? at(b) : null };
    hotCache.set(key, got);
    return got;
  }

  // ------------------------------------------------------------------ geometry (pure, canvas units)
  /** The visible card inside a 390 × 844 frame: the whole phone for a screen, a dialog / sheet / toast otherwise.
   *  head / headH: the title bar; top / step: where item rows start and their pitch. */
  function cardOf(s) {
    const n = s.items.length;
    if (shotOf(s)) return { x: 0, y: 0, w: W, h: H, head: 0, headH: STATUS, top: TOP, step: STEP }; // head: over the status bar
    if (!isOverlay(s))
      return { x: 0, y: 0, w: W, h: H, head: STATUS, headH: HEAD, top: TOP, step: n ? Math.min(STEP, (H - TOP - BOTTOM) / n) : STEP };
    const step = n ? Math.min(STEP, (H * 0.8 - CARD_HEAD - CARD_PAD) / n) : STEP;
    const h = Math.max(s.kind === "toast" ? CARD_HEAD + CARD_PAD : 140, CARD_HEAD + n * step + CARD_PAD);
    const w = s.kind === "sheet" ? W : s.kind === "popup" ? W - 70 : W - 48;
    const y = s.kind === "popup" ? (H - h) / 2 : s.kind === "sheet" ? H - h : H - h - 56;
    return { x: (W - w) / 2, y, w, h, head: 0, headH: CARD_HEAD, top: CARD_HEAD, step };
  }
  /** Row i of a card, relative to the card. */
  function rowOf(card, i) {
    return { x: 16, y: card.top + i * card.step, w: card.w - 32, h: card.step - Math.min(12, card.step * 0.22) };
  }
  const cardAbs = (s, c = cardOf(s)) => ({ x: s.x + c.x, y: s.y + c.y, w: c.w, h: c.h });
  /** Each button's box in its card: on the Zeplin image where its label is (`hot`) when that is inside the frame,
   *  else a row stacked at the bottom; without an image, the plain rows. */
  function rowsOf(s) {
    const c = cardOf(s), sh = shotOf(s);
    if (!sh) return s.items.map((_, i) => ({ r: rowOf(c, i), hot: false }));
    const { items } = hotspots(s, sh), fold = H - BOTTOM;
    const off = items.filter((r) => !r || r.y + r.h > (r.manual ? H + 0.5 : fold)).length;
    let n = 0;
    // a hand-drawn area may sit over the home bar (the user put it there); a text match there is the next screenful
    return items.map((r) => (r && r.y + r.h <= (r.manual ? H + 0.5 : fold) ? { r, hot: true }
      : { r: { x: 16, y: fold - (off - n++) * 48, w: W - 32, h: 40 }, hot: false }));
  }
  /** Full-frame overlays the layout once put over their parent (before they had an image): placed afresh. */
  function freeShots(f) {
    for (const s of f.screens) {
      if (s.kind === "screen" || !shotOf(s) || s.x === null) continue;
      if (f.screens.some((o) => o !== s && o.x !== null && Math.abs(o.x - s.x) < W && Math.abs(o.y - s.y) < H)) s.x = s.y = null;
    }
    return f;
  }

  /** Arrow ends: p (start) with its direction, q (end) on the nearest edge of the target card with that edge's normal. */
  function linkEnds(l, by) {
    const a = by.get(scr(l.src)), ca = cardOf(a), A = cardAbs(a, ca), B = cardAbs(by.get(l.to));
    const i = a.items.findIndex((it) => it.id === itm(l.src));
    let p, dir;
    if (i >= 0) {
      const r = rowsOf(a)[i].r;
      p = { x: A.x + r.x + r.w, y: A.y + r.y + r.h / 2 };
      dir = { x: 1, y: 0 };
    } else {
      const left = B.x + B.w / 2 < A.x + A.w / 2;
      p = { x: left ? A.x : A.x + A.w, y: A.y + ca.head + ca.headH / 2 };
      dir = { x: left ? -1 : 1, y: 0 };
    }
    const m = 28, cy = clamp(p.y, B.y + m, B.y + B.h - m), cx = clamp(p.x, B.x + m, B.x + B.w - m);
    if (p.x <= B.x) return { p, dir, q: { x: B.x, y: cy }, n: { x: -1, y: 0 } };
    if (p.x >= B.x + B.w) return { p, dir, q: { x: B.x + B.w, y: cy }, n: { x: 1, y: 0 } };
    if (p.y < B.y) return { p, dir, q: { x: cx, y: B.y }, n: { x: 0, y: -1 } };
    return { p, dir, q: { x: cx, y: B.y + B.h }, n: { x: 0, y: 1 } };
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  /** Cubic bezier path for the ends + its midpoint (label anchor). */
  function curve({ p, dir, q, n }) {
    const d = clamp(Math.hypot(q.x - p.x, q.y - p.y) * 0.45, 40, 260);
    const c1 = { x: p.x + dir.x * d, y: p.y + dir.y * d }, c2 = { x: q.x + n.x * d, y: q.y + n.y * d };
    return {
      d: `M${r1(p.x)} ${r1(p.y)}C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(q.x)} ${r1(q.y)}`,
      mid: { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 },
    };
  }
  const linkText = (l) => {
    const s = [l.when, l.ac].filter(Boolean).join(" · ");
    return s.length > 48 ? s.slice(0, 47) + "…" : s;
  };
  function bounds(screens) {
    if (!screens.length) return { x: 0, y: 0, w: W, h: H };
    const xs = screens.map((s) => s.x), ys = screens.map((s) => s.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) + W - x, h: Math.max(...ys) + H - y };
  }
  /** Camera {x, y, k} (screen = world * k + x / y) that centres box b in a vw × vh view, never above 100%. Past the
   *  minimum zoom the box can't fit: that axis starts at its top / left edge, so the first screen stays in view. */
  function fitCam(b, vw, vh) {
    const k = clamp(Math.min((vw - 2 * PAD) / b.w, (vh - 2 * PAD) / b.h), ZMIN, 1);
    const at = (size, view, start) => (size * k <= view - 2 * PAD ? (view - size * k) / 2 : PAD) - start * k;
    return { k, x: at(b.w, vw, b.x), y: at(b.h, vh, b.y) };
  }
  /** Zoom to k keeping view point (px, py) over the same world point. */
  function zoomAt(c, k, px, py) {
    k = clamp(k, ZMIN, ZMAX);
    return { k, x: px - ((px - c.x) * k) / c.k, y: py - ((py - c.y) * k) / c.k };
  }

  // ------------------------------------------------------------------ DOM builders
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(label, cls, onClick) {
    const b = h("button", cls, label);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function svg(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  const box = (e, r) => Object.assign(e.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
  const placeFrame = (el, s) => { el.style.transform = `translate(${s.x}px,${s.y}px)`; };
  /** A Zeplin image at frame width; `lazy`: the map, where most frames start off screen. */
  function shotImg(sh, alt, lazy) {
    const img = h("img", "uf-img");
    img.alt = alt;
    img.decoding = "async";
    img.draggable = false;
    if (lazy) img.loading = "lazy";
    img.style.height = (sh.h * W) / sh.w + "px";
    img.src = sh.src;
    return img;
  }

  function zeplinLink(url, t) {
    const a = h("a", "uf-zeplin");
    a.target = "_blank";
    a.rel = "noopener";
    if (ZEPLIN.test(url)) a.href = url;
    a.setAttribute("aria-label", t("zeplin"));
    const i = svg("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    i.append(svg("path", { d: "M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" }));
    a.append(i);
    return a;
  }

  /** One frame: phone (screen) or overlay frame with its card; rows positioned from the same geometry as arrows.
   *  `linked`: set of "screen.item" sources that have a link. `edit`: also draw the dots you drag links from.
   *  `lead`: the title prefix every screen shares, left out of the label above the frame. */
  function buildFrame(s, t, linked, edit, lead = "", isStart = false) {
    const c = cardOf(s), sh = shotOf(s), rows = rowsOf(s);
    const el = h("div", "uf-screen" + (isOverlay(s) ? " uf-ov uf-" + s.kind : "") + (sh ? " uf-shot" : ""));
    el.dataset.id = s.id;
    const card = h("div", "uf-card" + (s.items.length || sh ? "" : " uf-empty"));
    box(card, c);
    if (sh) {
      const pic = h("div", "uf-imgbox");
      pic.append(shotImg(sh, "", true));
      card.append(pic);
    }
    const head = h("div", "uf-head");
    box(head, { x: 0, y: c.head, w: c.w, h: c.headH });
    if (isStart) {
      const b = h("span", "uf-startb", "▶");
      b.title = t("startBadge");
      b.setAttribute("aria-label", t("startBadge"));
      head.append(b);
    }
    head.append(h("div", "uf-title", s.title));
    if (s.note) { // plain text: textContent / title never parse it
      const m = h("span", "uf-memo", "✎");
      m.title = s.note;
      m.setAttribute("aria-label", t("noteBadge"));
      head.append(m);
    }
    if (s.ac) head.append(h("span", "uf-ac", s.ac));
    if (s.zeplin) head.append(zeplinLink(s.zeplin, t));
    // the name above the frame at a constant on-screen size (Figma style): readable when the map is zoomed out.
    // Pure CSS from the camera's --zk; no per-label work on a pan, none in JS on a zoom.
    const label = h("div", "uf-flabel");
    label.setAttribute("aria-hidden", "true"); // the in-frame title is the accessible name; this one only repeats it
    label.append(h("span", "uf-ltitle", (lead && s.title.startsWith(lead) ? s.title.slice(lead.length) : s.title) || s.title));
    if (s.ac) label.append(h("span", "uf-lac", s.ac));
    card.append(label, head);
    s.items.forEach((it, i) => {
      const { r, hot } = rows[i];
      const rect = hot && it.rect; // hand-drawn and on the frame: edit mode moves / resizes it
      const row = h("div", "uf-item " + (hot ? "uf-hot " : "") + (rect ? "uf-rect " : "") +
        (linked.has(`${s.id}.${it.id}`) ? "uf-linked" : "uf-dead"), it.label);
      row.dataset.item = it.id;
      if (rect && edit) row.append(h("span", "uf-rsz"));
      if (!hot && sh) row.title = t("offShot");
      box(row, r);
      row.style.lineHeight = r.h - 2 + "px";
      card.append(row);
    });
    if (edit) {
      const dot = (src, x, y) => {
        const d = btn(null, "uf-dot");
        d.dataset.src = src;
        d.dataset.x = s.x + c.x + x; // world coordinates: where the new arrow starts
        d.dataset.y = s.y + c.y + y;
        d.style.left = x + "px";
        d.style.top = y + "px";
        d.setAttribute("aria-label", t("dotHint"));
        card.append(d);
      };
      dot(s.id, c.w, c.head + c.headH / 2);
      s.items.forEach((it, i) => {
        const r = rows[i].r;
        dot(`${s.id}.${it.id}`, r.x + r.w, r.y + r.h / 2);
      });
    }
    el.append(card);
    placeFrame(el, s);
    return el;
  }

  function markers(uid) {
    const defs = svg("defs", {});
    for (const k of ["a", "b"]) {
      const m = svg("marker", { id: `${uid}-${k}`, class: `uf-mk-${k}`, viewBox: "0 0 10 10", refX: 8, refY: 5,
        markerWidth: 14, markerHeight: 14, markerUnits: "userSpaceOnUse", orient: "auto" });
      m.append(svg("path", { d: "M0 0.5L10 5L0 9.5z" }));
      defs.append(m);
    }
    return defs;
  }

  // ------------------------------------------------------------------ styles (injected once)
  const DARK = "--uf-bg:#0d0f14;--uf-screen:#181b22;--uf-ink:#e8eaee;--uf-ink2:#9aa1ad;--uf-line:#2c313b;" +
    "--uf-soft:#22262e;--uf-accent:#8b8cf8;--uf-on-accent:#0d0f14;--uf-accent-soft:rgba(139,140,248,.16);" +
    "--uf-muted:#697282;--uf-bezel:#2e333c;--uf-hit:#facc15;--uf-hit-soft:rgba(250,204,21,.2);--uf-warn:#fb923c;--uf-warn-soft:rgba(251,146,60,.14);" +
    "--uf-shadow:0 1px 2px rgba(0,0,0,.4),0 18px 44px -14px rgba(0,0,0,.7);color-scheme:dark";
  const CSS = `
.uf-root{--uf-bg:#f3f4f7;--uf-screen:#fff;--uf-ink:#111827;--uf-ink2:#6b7280;--uf-line:#d9dce3;--uf-soft:#f1f3f6;
--uf-accent:#4f46e5;--uf-on-accent:#fff;--uf-bezel:#1b1d22;--uf-accent-soft:rgba(79,70,229,.1);--uf-muted:#9aa1ad;--uf-warn:#c2410c;
--uf-warn-soft:rgba(234,88,12,.1);--uf-hit:#eab308;--uf-hit-soft:rgba(234,179,8,.22);--uf-shadow:0 1px 2px rgba(16,24,40,.06),0 18px 44px -14px rgba(16,24,40,.22);
position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--uf-bg);
color:var(--uf-ink);font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
-webkit-font-smoothing:antialiased}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .uf-root{${DARK}}}
[data-theme=dark] .uf-root{${DARK}}
.uf-root *{box-sizing:border-box}
.uf-bar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;background:var(--uf-screen);
border-bottom:1px solid var(--uf-line)}
.uf-sp{flex:1}
.uf-btn{height:32px;padding:0 13px;border:1px solid var(--uf-line);border-radius:999px;background:var(--uf-screen);
color:var(--uf-ink);font:inherit;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}
.uf-btn:hover{background:var(--uf-soft)}
.uf-btn:active{transform:scale(.97)}
.uf-btn[aria-pressed=true]{background:var(--uf-accent);border-color:var(--uf-accent);color:var(--uf-on-accent)}
.uf-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--uf-line);border-radius:999px;background:var(--uf-soft)}
.uf-seg .uf-btn{height:26px;border:0;background:transparent;color:var(--uf-ink2)}
.uf-seg .uf-btn[aria-pressed=true]{background:var(--uf-screen);color:var(--uf-ink);box-shadow:0 1px 3px rgba(16,24,40,.18)}
.uf-main{position:relative;flex:1;min-height:0}
.uf-view{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;outline:none}
.uf-btn:focus-visible,.uf-issue:focus-visible,.uf-zeplin:focus-visible{outline:2px solid var(--uf-accent);outline-offset:2px}
.uf-view:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-2px}
.uf-view.uf-moving{cursor:grabbing}
.uf-layer{position:absolute;left:0;top:0;transform-origin:0 0}
.uf-moving .uf-layer{will-change:transform}
.uf-play{position:absolute;inset:0;display:none}
.uf-root[data-mode=play] .uf-view{display:none}
.uf-root[data-mode=play] .uf-play{display:flex;flex-direction:column}
.uf-root[data-mode=play] .uf-fit{display:none}
.uf-screen{position:absolute;left:0;top:0;width:${W}px;height:${H}px;border-radius:54px;background:var(--uf-screen);
box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow);transition:opacity .2s ease-out}
.uf-screen:not(.uf-ov)::before,.uf-phone::before{content:"";position:absolute;top:11px;left:50%;width:120px;height:33px;margin-left:-60px;
border-radius:20px;background:#000;opacity:.88}
.uf-screen:not(.uf-ov)::after,.uf-phone::after{content:"";position:absolute;bottom:9px;left:50%;width:134px;height:5px;margin-left:-67px;
border-radius:3px;background:var(--uf-ink);opacity:.45}
.uf-ov{background:none;box-shadow:none;pointer-events:none}
.uf-card{position:absolute}
.uf-ov .uf-card{pointer-events:auto;border-radius:22px;background:var(--uf-screen);box-shadow:var(--uf-shadow);
outline:1.5px dashed var(--uf-accent);outline-offset:0}
.uf-sheet .uf-card{border-radius:28px 28px 14px 14px}
.uf-popup .uf-empty::after,.uf-sheet .uf-empty::after{content:"";position:absolute;left:20px;right:72px;top:72px;height:10px;
border-radius:5px;background:var(--uf-soft);box-shadow:0 22px 0 var(--uf-soft)}
.uf-head{position:absolute;display:flex;align-items:center;gap:8px;padding:0 18px 0 20px}
.uf-screen:not(.uf-ov) .uf-head{border-bottom:1px solid var(--uf-soft)}
.uf-title{flex:1;min-width:0;font-size:17px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-ac,.uf-lac{flex:none;max-width:120px;padding:2px 8px;border-radius:999px;background:var(--uf-accent-soft);color:var(--uf-accent);
font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-zeplin{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;color:var(--uf-ink2)}
.uf-zeplin[href]{color:var(--uf-accent)}
.uf-zeplin[href]:hover{background:var(--uf-accent-soft)}
.uf-zeplin:not([href]){opacity:.4}
/* frame label: --zk is the camera zoom. Laid out at k·(card width) and scaled by 1/k, so on screen it is exactly the
   frame's width and its text a constant 12px, whatever the zoom. Its layout width is its on-screen width, so a
   container query can drop the AC chip where it would only push the name out. */
.uf-flabel{position:absolute;left:0;bottom:100%;display:flex;align-items:center;gap:6px;width:calc(var(--zk,1) * 100%);
padding-bottom:6px;transform:scale(calc(1 / var(--zk,1)));transform-origin:0 100%;font-size:12px;line-height:16px;
font-weight:600;color:var(--uf-ink);white-space:nowrap;pointer-events:none;transition:opacity .15s ease-out;
container-type:inline-size}
.uf-ltitle{min-width:0;overflow:hidden;text-overflow:ellipsis}
.uf-lac{max-width:45%;padding:1px 7px;font-size:11px}
@container (max-width:180px){.uf-lac{display:none}}
.uf-near .uf-flabel{opacity:0}
.uf-item{position:absolute;padding:0 30px 0 14px;border:1px solid var(--uf-line);border-radius:12px;background:var(--uf-soft);
font-size:15px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-item.uf-linked::after{content:"›";position:absolute;right:12px;top:0;color:var(--uf-ink2);font-size:20px}
.uf-root .uf-dead{border-style:dashed;background:transparent;color:var(--uf-ink2)}
/* a frame drawn from its Zeplin image: buttons are boxes over the design, the title rides on its status bar */
.uf-shot .uf-card{border-radius:54px}
.uf-shot::before,.uf-shot::after{display:none}
.uf-imgbox{position:absolute;inset:0;overflow:hidden;border-radius:inherit;background:var(--uf-screen)}
.uf-img{display:block;width:100%;max-width:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none}
.uf-shot .uf-head{border-radius:54px 54px 0 0;padding-left:44px;background:color-mix(in srgb,var(--uf-screen) 88%,transparent);
border-bottom:1px solid var(--uf-line)}
.uf-item.uf-hot{padding:0 6px;border:2px solid var(--uf-accent);border-radius:10px;background:var(--uf-accent-soft);
color:transparent;font-size:13px}
.uf-item.uf-hot::after{content:none}
.uf-root .uf-hot.uf-dead{border-color:var(--uf-warn);background:transparent;color:transparent}
.uf-hot.uf-edit-on{color:var(--uf-ink)}
.uf-editing .uf-rect{cursor:move}
.uf-rsz{display:none;position:absolute;right:0;bottom:0;width:14px;height:14px;border:2px solid var(--uf-screen);
border-radius:4px;background:var(--uf-accent);cursor:nwse-resize;touch-action:none}
.uf-editing .uf-rect.uf-sel .uf-rsz{display:block}
.uf-drawing .uf-screen.uf-drawon{cursor:crosshair}
.uf-drawing .uf-screen.uf-drawon .uf-imgbox{outline:3px dashed var(--uf-accent);outline-offset:-3px}
.uf-startb{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--uf-accent);
color:var(--uf-on-accent);font-size:11px}
.uf-ptabs{display:flex;gap:4px;padding:4px 4px 6px}
.uf-pfilter{display:flex;flex-wrap:wrap;gap:4px;padding:0 4px 6px}
.uf-pfilter .uf-btn,.uf-ptabs .uf-btn{height:26px;padding:0 10px;font-size:12px}
.uf-paths{margin:0;padding:4px 10px 6px 28px;font-size:13px;line-height:1.45}
.uf-paths li{margin:4px 0;overflow-wrap:anywhere}
.uf-memo{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--uf-hit-soft);
color:var(--uf-ink);font-size:14px;cursor:help}
.uf-screen.uf-match{box-shadow:0 0 0 5px var(--uf-hit),var(--uf-shadow)}
.uf-ov.uf-match .uf-card{box-shadow:0 0 0 5px var(--uf-hit),var(--uf-shadow)}
.uf-find{position:relative;flex:0 1 260px;min-width:140px}
.uf-find .uf-input{width:100%;height:32px;border-radius:999px;padding:0 12px}
.uf-results{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:4;max-height:320px;overflow:auto;padding:4px;
border-radius:12px;background:var(--uf-screen);box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow)}
.uf-res{display:block;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;
font-size:13px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.uf-res[aria-selected=true],.uf-res:hover{background:var(--uf-accent-soft)}
.uf-count{padding:4px 10px;color:var(--uf-ink2);font-size:12px}
.uf-zform{padding:10px}
.uf-zform h2{margin:0 0 6px;font-size:13px;font-weight:700}
.uf-zform .uf-field{margin-top:4px}
.uf-zmsg{margin:8px 2px 0;font-size:13px;color:var(--uf-ink2)}
.uf-zmsg.uf-err{color:var(--uf-warn)}
.uf-area{flex:1;min-width:0;min-height:72px;padding:6px 9px;border:1px solid var(--uf-line);border-radius:9px;
background:var(--uf-bg);color:var(--uf-ink);font:inherit;font-size:13px;resize:vertical}
.uf-area:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-1px}
.uf-num{flex:1 1 52px;min-width:52px}
.uf-focus .uf-screen:not(.uf-on){opacity:.2}
.uf-links{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.uf-link{fill:none;stroke:var(--uf-accent);stroke-width:3;stroke-linecap:round;transition:opacity .2s ease-out}
.uf-open{stroke-width:1.75}
.uf-back{stroke:var(--uf-muted);stroke-width:2;stroke-dasharray:8 7}
.uf-mk-a{fill:var(--uf-accent)}
.uf-mk-b{fill:var(--uf-muted)}
.uf-labels{position:absolute;left:0;top:0;width:1px;height:1px}
.uf-label{position:absolute;left:0;top:0;padding:1px 7px;border-radius:8px;background:var(--uf-bg);color:var(--uf-ink2);
font-size:14px;font-weight:650;white-space:nowrap;pointer-events:none;transition:opacity .2s ease-out}
.uf-focus .uf-link:not(.uf-on),.uf-focus .uf-label:not(.uf-on){opacity:.08}
.uf-panel{position:absolute;top:8px;right:8px;z-index:2;width:min(380px,calc(100% - 16px));max-height:min(60%,520px);
overflow:auto;padding:6px;border-radius:16px;background:var(--uf-screen);box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow);
animation:uf-in .18s ease-out}
@keyframes uf-in{from{opacity:0;transform:translateY(-6px)}}
.uf-issue{display:flex;align-items:flex-start;gap:10px;width:100%;padding:9px 10px;border:0;border-radius:10px;background:none;
color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.uf-issue:hover{background:var(--uf-soft)}
.uf-txt{min-width:0;overflow-wrap:anywhere}
.uf-tag{flex:none;padding:1px 8px;border-radius:999px;background:var(--uf-soft);color:var(--uf-ink2);font-size:11px;font-weight:700}
.uf-tag-orphan,.uf-tag-dead,.uf-tag-broken{background:var(--uf-warn-soft);color:var(--uf-warn)}
.uf-none{margin:0;padding:14px;color:var(--uf-ink2);font-size:13px}
/* prototype: one phone, scaled to fit (--k), centred in the stage; the path walked below it */
.uf-stage{position:relative;flex:1;min-height:0;overflow:hidden}
.uf-phone{position:absolute;left:50%;top:50%;width:${W}px;height:${H}px;margin:${-H / 2}px 0 0 ${-W / 2}px;
transform:scale(var(--k,1));display:flex;flex-direction:column;overflow:hidden;border-radius:54px;background:var(--uf-screen);
box-shadow:0 0 0 ${BEZEL - 1}px var(--uf-bezel),0 0 0 ${BEZEL}px var(--uf-line),var(--uf-shadow);outline:none}
.uf-phone::before,.uf-phone::after{z-index:3;pointer-events:none}
.uf-status{flex:none;height:${STATUS}px;padding:14px 0 0 40px;font-size:15px;font-weight:650}
.uf-nav{flex:none;display:flex;align-items:center;gap:2px;height:${HEAD}px;padding:0 20px 0 6px;border-bottom:1px solid var(--uf-soft)}
.uf-pback{flex:none;display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:12px;background:none;
color:var(--uf-accent);cursor:pointer}
.uf-pback:active{opacity:.5}
.uf-off{visibility:hidden}
.uf-pbody{position:relative;flex:1;min-height:0;overflow:hidden}
.uf-pscreen{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding-bottom:${BOTTOM}px;background:var(--uf-screen)}
.uf-rows{display:flex;flex-direction:column;gap:10px;padding:16px}
.uf-row{position:relative;flex:none;display:block;width:100%;height:52px;padding:0 34px 0 16px;border:1px solid var(--uf-line);
border-radius:14px;background:var(--uf-soft);color:var(--uf-ink);font:inherit;font-size:16px;font-weight:550;line-height:50px;
text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;-webkit-tap-highlight-color:transparent;
transition:transform .1s ease-out,opacity .1s ease-out}
.uf-row:active{transform:scale(.98);opacity:.75}
.uf-row.uf-linked::after{content:"";position:absolute;right:16px;top:50%;width:8px;height:8px;margin-top:-4px;
border-top:2px solid var(--uf-ink2);border-right:2px solid var(--uf-ink2);transform:rotate(45deg)}
.uf-row::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 2px var(--uf-warn);opacity:0;
pointer-events:none}
.uf-flash::before{opacity:1}
.uf-row:focus-visible,.uf-pback:focus-visible,.uf-crumb:focus-visible{outline:2px solid var(--uf-accent);outline-offset:2px}
/* prototype on a Zeplin image: the phone's own bars step aside; tap areas show on hover / focus */
.uf-full .uf-status,.uf-full .uf-nav,.uf-phone.uf-full::before,.uf-phone.uf-full::after{display:none}
.uf-pshot{position:relative}
.uf-phot{position:absolute;padding:0;border:0;border-radius:10px;background:transparent;cursor:pointer;
-webkit-tap-highlight-color:transparent}
.uf-phot:hover{background:var(--uf-accent-soft);box-shadow:inset 0 0 0 2px var(--uf-accent)}
.uf-phot:active{opacity:.6}
.uf-phot:focus-visible{outline:2px solid var(--uf-accent);outline-offset:2px}
.uf-phot::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 2px var(--uf-warn);opacity:0;
pointer-events:none}
.uf-fullov .uf-pscreen{position:absolute;inset:0}
.uf-phone:focus-visible{outline:2px solid var(--uf-accent);outline-offset:${BEZEL + 4}px}
.uf-overlay{position:absolute;inset:0;z-index:2}
.uf-overlay.uf-toast,.uf-leaving{pointer-events:none}
.uf-backdrop{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 35px}
.uf-sheet .uf-backdrop{align-items:flex-end;padding:0}
.uf-scrim{position:absolute;inset:0;background:rgba(10,12,16,.45)}
.uf-pcard{position:relative;width:100%;max-height:80%;overflow-y:auto;border-radius:22px;background:var(--uf-screen);
box-shadow:var(--uf-shadow);outline:none}
.uf-overlay:not(.uf-toast) .uf-pcard.uf-empty{min-height:130px}
.uf-pcard>.uf-title{padding:20px 20px 0}
.uf-pcard .uf-rows{padding:14px 16px 18px}
.uf-sheet .uf-pcard{border-radius:28px 28px 0 0;padding-bottom:${BOTTOM - 16}px}
.uf-toast .uf-pcard{position:absolute;left:24px;right:24px;bottom:56px;width:auto;border-radius:16px;pointer-events:auto;
background:var(--uf-ink);color:var(--uf-screen)}
.uf-toast .uf-pcard>.uf-title{padding:14px 18px;font-size:15px}
.uf-trail{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--uf-line);
background:var(--uf-screen)}
.uf-crumbs{flex:1;min-width:0;display:flex;align-items:center;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
.uf-crumb{flex:none;padding:4px 8px;border:0;border-radius:8px;background:none;color:var(--uf-ink2);font:inherit;font-size:13px;
cursor:pointer}
.uf-crumb:hover:not(:disabled){background:var(--uf-soft);color:var(--uf-ink)}
.uf-crumb:disabled{color:var(--uf-ink);font-weight:650;cursor:default}
.uf-sep{flex:none;color:var(--uf-muted)}
/* edit mode (Sửa): drag handles, dots, selection, the properties panel */
.uf-root:not(.uf-editing) .uf-add,.uf-root[data-mode=play] .uf-add,.uf-root[data-mode=play] .uf-editbtn,
.uf-root[data-mode=play] .uf-insp{display:none}
.uf-dot{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;padding:0;border:2px solid var(--uf-screen);
border-radius:50%;background:var(--uf-accent);box-shadow:0 1px 3px rgba(16,24,40,.3);cursor:crosshair;touch-action:none}
.uf-dot:hover{transform:scale(1.25)}
.uf-handle{fill:var(--uf-screen);stroke:var(--uf-accent);stroke-width:3;pointer-events:auto;cursor:grab;touch-action:none}
.uf-handle:hover{fill:var(--uf-accent-soft)}
.uf-editing .uf-label{pointer-events:auto;cursor:text}
.uf-editing .uf-head{cursor:move}
.uf-temp{fill:none;stroke:var(--uf-accent);stroke-width:2.5;stroke-dasharray:7 6;stroke-linecap:round;pointer-events:none}
.uf-screen.uf-sel{box-shadow:0 0 0 3px var(--uf-accent),var(--uf-shadow)}
.uf-item.uf-sel{border-color:var(--uf-accent);box-shadow:0 0 0 2px var(--uf-accent-soft)}
.uf-link.uf-sel{stroke-width:5}
.uf-edit-on{background:var(--uf-screen);box-shadow:0 0 0 2px var(--uf-accent);cursor:text;text-overflow:clip;
user-select:text;-webkit-user-select:text}
.uf-insp{position:absolute;left:8px;bottom:8px;z-index:2;width:min(320px,calc(100% - 16px));max-height:calc(100% - 16px);overflow:auto;padding:10px;
border-radius:16px;background:var(--uf-screen);box-shadow:0 0 0 1px var(--uf-line),var(--uf-shadow);animation:uf-in .18s ease-out}
.uf-insp h2{margin:0 0 8px;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-chips{display:flex;flex-wrap:wrap;gap:4px}
.uf-chips .uf-btn{height:26px;padding:0 10px;font-size:12px}
.uf-field{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.uf-flab{flex:none;width:62px;color:var(--uf-ink2);font-size:12px;font-weight:650}
.uf-input{flex:1;min-width:0;height:28px;padding:0 9px;border:1px solid var(--uf-line);border-radius:9px;
background:var(--uf-bg);color:var(--uf-ink);font:inherit;font-size:13px}
.uf-input:focus-visible{outline:2px solid var(--uf-accent);outline-offset:-1px}
.uf-acts{display:flex;gap:6px;margin-top:10px}
.uf-bad{display:none;flex-basis:100%;padding:4px 0 0 70px;color:var(--uf-warn);font-size:12px}
.uf-has-bad .uf-bad{display:block}
.uf-has-bad .uf-input{border-color:var(--uf-warn)}
.uf-note{position:absolute;left:50%;bottom:16px;z-index:3;max-width:calc(100% - 32px);padding:8px 14px;
border-radius:999px;background:var(--uf-ink);color:var(--uf-screen);font-size:13px;font-weight:600;
transform:translateX(-50%);animation:uf-in .18s ease-out}
.uf-btn:disabled{opacity:.45;cursor:not-allowed}
.uf-danger{border-color:var(--uf-warn);color:var(--uf-warn)}
/* an exported file: the shell carries no CSS, so the engine makes its host fill the viewport (insets kept clear) */
.uf-file,.uf-file body{height:100%;margin:0;overflow:hidden}
.uf-file #uiflow{position:fixed;inset:0;box-sizing:border-box;padding:env(safe-area-inset-top,0px)
env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
@media (prefers-reduced-motion:reduce){.uf-root *,.uf-root *::before,.uf-root *::after{transition:none!important;animation:none!important}}
`;
  function injectStyle() {
    if (document.getElementById("uf-style")) return;
    const s = h("style", null, CSS);
    s.id = "uf-style";
    document.head.append(s);
  }

  // ------------------------------------------------------------------ standalone helpers
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    return { s: q.get("s"), m: q.get("m") };
  }
  /** Download the page as captured before mount, with the data block replaced by `flow`. */
  function saveFile(src, flow) {
    const json = JSON.stringify(flow).replace(/</g, "\\u003c");
    const html = "<!doctype html>\n" +
      src.replace(/(<script[^>]*\bid=["']?uiflow-data["']?[^>]*>)[\s\S]*?(<\/script>)/i, (_, a, b) => a + json + b);
    const a = h("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `uiflow-${str(flow.ticket, "flow").replace(/[^\w.-]/g, "_")}.html`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }

  // ------------------------------------------------------------------ camera (pan / zoom of one layer)
  /** Owns the transform of `layer` inside `view` and the gestures that drive it (Figma convention): drag pans, two
   *  pointers pinch, ctrl / ⌘ + wheel (also a trackpad pinch) zooms around the cursor, plain wheel / two-finger
   *  scroll pans. One transform write per animation frame; no layout reads while moving. `fit(box)` while the view
   *  has no size (hidden, not laid out yet) waits and applies once it has one; the latest request wins.
   *  onTap(target): a press that did not move. reduced: MediaQueryList for prefers-reduced-motion. */
  function camera(view, layer, { onTap, reduced, onZoom }) {
    let cam = { x: 0, y: 0, k: 1 }, rect = view.getBoundingClientRect(), pending = null;
    let raf = 0, anim = 0, idle = 0, wheel = null;
    const pts = new Map();
    let g = null, tapOn = null, moved = false;

    let zk = NaN; // the zoom last reported: a pan does not call onZoom
    const apply = () => {
      layer.style.transform = `translate3d(${cam.x}px,${cam.y}px,0) scale(${cam.k})`;
      if (cam.k !== zk) onZoom?.((zk = cam.k));
    };
    const moving = (on) => view.classList.toggle("uf-moving", on);
    const schedule = () => { if (!raf) raf = requestAnimationFrame(tick); };
    function stopAnim() {
      if (!anim) return;
      cancelAnimationFrame(anim);
      anim = 0;
      moving(false);
    }
    function move(to, animate) {
      stopAnim();
      if (!animate || reduced.matches) { cam = to; apply(); return; }
      const from = cam, t0 = performance.now();
      moving(true);
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ANIM_MS), e = 1 - (1 - p) ** 3;
        cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
        apply();
        if (p < 1) anim = requestAnimationFrame(step);
        else { anim = 0; moving(false); }
      };
      anim = requestAnimationFrame(step);
    }
    function fit(box, animate) {
      const w = view.clientWidth, h = view.clientHeight;
      if (!w || !h) { pending = box; return; }
      pending = null;
      move(fitCam(box, w, h), animate);
    }
    const ro = new ResizeObserver(() => {
      if (!view.clientWidth || !view.clientHeight) return; // hidden: keep the last real size and camera
      rect = view.getBoundingClientRect();
      if (pending) fit(pending, false);
    });
    ro.observe(view);

    const at = (e) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    function snap() {
      const p = [...pts.values()];
      g = { cam: { ...cam }, p, mid: p[1] && mid(p[0], p[1]), dist: p[1] && (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1) };
    }
    function gestureCam() {
      const p = [...pts.values()];
      if (p.length < 2 || !g.mid) return { k: g.cam.k, x: g.cam.x + p[0].x - g.p[0].x, y: g.cam.y + p[0].y - g.p[0].y };
      const m = mid(p[0], p[1]), k = clamp((g.cam.k * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)) / g.dist, ZMIN, ZMAX);
      const wx = (g.mid.x - g.cam.x) / g.cam.k, wy = (g.mid.y - g.cam.y) / g.cam.k;
      return { k, x: m.x - wx * k, y: m.y - wy * k };
    }
    function tick() {
      raf = 0;
      if (g && pts.size) cam = gestureCam();
      if (wheel) {
        cam = { ...cam, x: cam.x + wheel.dx, y: cam.y + wheel.dy };
        if (wheel.f !== 1) cam = zoomAt(cam, cam.k * wheel.f, wheel.x, wheel.y);
        wheel = null;
      }
      apply();
    }
    const flush = () => { if (raf) { cancelAnimationFrame(raf); tick(); } };

    function onDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("a, button, input, textarea, [contenteditable]")) return;
      stopAnim();
      flush();
      rect = view.getBoundingClientRect();
      try { view.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
      pts.set(e.pointerId, at(e));
      if (pts.size === 1) { tapOn = e.target; moved = false; } else moved = true;
      snap();
      moving(true);
    }
    function onMove(e) {
      if (!pts.has(e.pointerId)) return;
      const p = at(e);
      pts.set(e.pointerId, p);
      if (!moved && Math.hypot(p.x - g.p[0].x, p.y - g.p[0].y) > 4) moved = true;
      schedule();
    }
    function onUp(e) {
      if (!pts.has(e.pointerId)) return;
      flush();
      pts.delete(e.pointerId);
      if (pts.size) return snap();
      g = null;
      moving(false);
      if (!moved && e.type === "pointerup") onTap(tapOn);
    }
    function onWheel(e) {
      e.preventDefault();
      stopAnim();
      if (!idle) { rect = view.getBoundingClientRect(); moving(true); } // once per burst: ancestors may have scrolled
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1, p = at(e);
      wheel ||= { f: 1, x: p.x, y: p.y, dx: 0, dy: 0 };
      if (e.ctrlKey || e.metaKey) Object.assign(wheel, { f: wheel.f * Math.exp(-clamp(e.deltaY * unit, -50, 50) * 0.01), x: p.x, y: p.y });
      else { wheel.dx -= e.deltaX * unit; wheel.dy -= e.deltaY * unit; }
      clearTimeout(idle);
      idle = setTimeout(() => { idle = 0; if (!pts.size) moving(false); }, 160);
      schedule();
    }
    view.addEventListener("pointerdown", onDown);
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerup", onUp);
    view.addEventListener("pointercancel", onUp);
    view.addEventListener("wheel", onWheel, { passive: false });

    return {
      get: () => ({ ...cam }),
      move,
      fit,
      destroy() {
        ro.disconnect();
        cancelAnimationFrame(raf);
        stopAnim();
        clearTimeout(idle);
      },
    };
  }

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
   *  tap, so edits apply); onGo(id): the shown screen changed. */
  function player(host, { flow, t, reduced, onGo }) {
    let path = [], ovs = [], cur = null, flash = null; // ovs: [{id, kind, el, card, scrim, timer}]
    const ui = phoneShell(t);
    const restart = btn(t("restart"), "uf-btn", () => go([startOf(flow())].filter(Boolean), "back"));
    ui.back.addEventListener("click", goBack);
    ui.trail.append(ui.crumbs, restart);
    host.replaceChildren(ui.stage, ui.trail);

    const ro = new ResizeObserver(([e]) => { // scale the frame to fit the stage; ignore 0 × 0 while hidden
      const { width: w, height: hh } = e.contentRect, m = 2 * (BEZEL + GAP);
      if (w && hh) ui.phone.style.setProperty("--k", String(Math.min(1, (hh - m) / H, (w - m) / W)));
    });
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
    function goBack() {
      const l = backLink();
      if (l) follow(l);
      else if (path.length > 1) go(path.slice(0, -1), "back");
    }
    function tap(b, links) {
      if (links.length === 1) follow(links[0]);
      else if (links.length) choose(links);
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
      const { items, back } = hotspots(s, sh), pic = h("div", "uf-pshot");
      pic.append(shotImg(sh, s.title, false));
      s.items.forEach((it, i) => {
        if (!items[i]) return;
        const links = from(`${s.id}.${it.id}`);
        const b = btn(null, "uf-phot " + (links.length ? "uf-linked" : "uf-dead"), () => tap(b, links));
        b.setAttribute("aria-label", it.label);
        box(b, items[i]);
        pic.append(b);
      });
      if (back && !isPop(s)) {
        const b = btn(null, "uf-phot uf-linked", goBack);
        b.setAttribute("aria-label", t("back"));
        box(b, back);
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

    return {
      /** Jump to a screen (an overlay: its parent with the overlay open), as a fresh path. */
      open(id) {
        const s = by(id) || by(startOf(flow()));
        if (!s) return;
        const p = isPop(s) && parents(flow()).get(s.id);
        go([p || s.id], null);
        if (p) openOverlay(s);
      },
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
      },
    };
  }

  // ------------------------------------------------------------------ editing (Sửa)
  /** Edit one label in place: plain text, Enter / blur keeps it, Esc drops it, cut to `max`. done(value | null).
   *  `start` is what to put in the box when the element shows something else (an arrow shows "when · ac"). */
  function inlineEdit(el, max, done, start) {
    if (el.isContentEditable) return;
    // Known limitation: Firefox < 136 ignores contenteditable="plaintext-only", so renaming does nothing there.
    const shown = el.textContent;
    if (start != null) el.textContent = start;
    el.setAttribute("contenteditable", "plaintext-only");
    el.classList.add("uf-edit-on");
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    let over = false;
    const end = (keep) => {
      if (over) return;
      over = true;
      const val = el.textContent.replace(/\s+/g, " ").trim().slice(0, max);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur); // a cancelled edit keeps its node: leave nothing on it
      el.removeAttribute("contenteditable");
      el.classList.remove("uf-edit-on");
      el.textContent = shown; // a commit re-renders with the real value; a cancel keeps what was drawn
      done(keep && val ? val : null);
    };
    const onKey = (e) => {
      e.stopPropagation(); // Delete / ⌘Z belong to the text while it is being edited
      if (e.key === "Enter") { e.preventDefault(); end(true); }
      else if (e.key === "Escape") { e.preventDefault(); end(false); }
    };
    const onBlur = () => end(true);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  }

  /** id plus every overlay hanging off it (a popup of a popup too). */
  function family(f, id) {
    const par = parents(f), out = new Set([id]);
    for (let n = 0; n < 20; n++) {
      const was = out.size;
      for (const [k, p] of par) if (p && out.has(p)) out.add(k);
      if (out.size === was) break;
    }
    return out;
  }
  const nextId = (used, p) => { let n = 1; while (used.has(p + n)) n++; return p + n; };

  /** Edit mode: drag an arrow head to retarget it, drag a dot to add a link, drag a title bar to move a screen,
   *  double-click to rename, click to select (Delete removes, the panel changes what the shape cannot show).
   *  It never writes to the flow itself: every change goes through ctx.commit(flow, before), so undo and `dirty`
   *  stay in one place. ctx: {t, insp, cam, view, layer, get, commit, marks, frames, moveScreens, liveLink,
   *  tempLink, drawAll, centre}. */
  function editor(ctx) {
    let sel = null; // {t: "screen" | "item" | "link", id?, item?, i?}
    let drawFor = null; // {id, item?}: the next drag on that screen's image draws a tap area (for `item`, or a new one)
    let badVal = null; // text in a checked field that cannot be stored; kept so the panel can show it again
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
      badVal = null; // it belonged to the field that is going away
      paint();
      fill();
    }
    /** After a re-render: drop a selection whose shape is gone, then paint the new nodes. A value that could not
     *  be stored belongs to the edit that is now over (undo included), so it goes too. */
    function sync() {
      badVal = null;
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
     *  text survives the re-render that clearing causes (`badVal`). */
    function field(label, value, cap, set, bad) {
      const w = h("label", "uf-field");
      const i = h("input", "uf-input");
      i.type = "text";
      if (!bad) i.maxLength = cap; // a checked field must show what the user typed, over-long included
      i.value = bad && badVal !== null ? badVal : value;
      const mark = (wrong) => {
        w.classList.toggle("uf-has-bad", wrong);
        i.setAttribute("aria-invalid", String(wrong));
      };
      i.addEventListener("change", () => {
        const raw = i.value.trim(), v = bad ? raw : raw.slice(0, cap);
        if (!v || !bad || (bad.ok(v) && v.length <= cap)) {
          mark(false);
          badVal = null;
          return set(v);
        }
        set(""); // never keep a stored value the box does not show
        badVal = v; // the re-render that just happened cleared it; the panel still owes the user their text
        fill();
      });
      i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
      w.append(h("span", "uf-flab", label), i);
      if (bad) {
        w.append(h("span", "uf-bad", bad.text));
        if (badVal !== null) mark(true);
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
    // ---------------- find a screen: title (accents / case ignored), Zeplin link or id. No commit, no undo.
    let matches = [], active = -1;
    const findBox = h("input", "uf-input");
    const results = h("div", "uf-results");
    function finder() {
      const w = h("div", "uf-find");
      findBox.type = "search";
      findBox.placeholder = t("search");
      findBox.setAttribute("aria-label", t("search"));
      findBox.setAttribute("role", "combobox");
      findBox.setAttribute("aria-expanded", "false");
      findBox.setAttribute("aria-controls", uid + "-res");
      findBox.setAttribute("aria-autocomplete", "list");
      results.id = uid + "-res";
      results.setAttribute("role", "listbox");
      results.hidden = true;
      findBox.addEventListener("input", search);
      findBox.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (matches.length) pick((active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length, false);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (matches.length) choose(Math.max(active, 0));
        } else if (e.key === "Escape") {
          e.preventDefault();
          endSearch();
          view.focus({ preventScroll: true });
        }
      });
      findBox.addEventListener("blur", () => setTimeout(() => { if (!w.contains(document.activeElement)) results.hidden = true; findBox.setAttribute("aria-expanded", String(!results.hidden)); }, 150));
      w.append(findBox, results);
      return w;
    }
    function found(q) {
      const raw = q.trim();
      if (!raw) return [];
      const n = norm(raw), url = /^https?:\/\//i.test(raw), low = raw.toLowerCase();
      return cur.screens.filter((s) => (url ? !!s.zeplin && (canon(s.zeplin) === canon(raw) || s.zeplin.includes(raw))
        : (n && (norm(s.title).includes(n) || s.items.some((it) => norm(it.label).includes(n)))) // a button's words find its screen
          || s.id.toLowerCase().includes(low) || (!!s.zeplin && s.zeplin.includes(raw))));
    }
    function search() {
      matches = found(findBox.value).map((s) => s.id);
      active = -1;
      results.replaceChildren(h("div", "uf-count", matches.length ? t("found", { n: matches.length }) : t("noFound")),
        ...matches.map((id, i) => {
          const s = cur.screens.find((x) => x.id === id);
          const b = btn(s.title, "uf-res", () => choose(i));
          b.id = `${uid}-r${i}`;
          b.tabIndex = -1;
          b.setAttribute("role", "option");
          b.setAttribute("aria-selected", "false");
          b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the box focused: blur would hide the list
          return b;
        }));
      results.hidden = !findBox.value.trim();
      findBox.setAttribute("aria-expanded", String(!results.hidden));
      findBox.removeAttribute("aria-activedescendant");
      applyMatch();
    }
    function pick(i, go) {
      active = i;
      for (const b of results.querySelectorAll(".uf-res")) b.setAttribute("aria-selected", String(b.id === `${uid}-r${i}`));
      const b = results.querySelector(`#${uid}-r${i}`);
      if (b) { findBox.setAttribute("aria-activedescendant", b.id); b.scrollIntoView({ block: "nearest" }); }
      if (go !== false) goto(matches[i], !reduced.matches);
    }
    function choose(i) {
      pick(i);
      if (editing && shown === "map") ed.pick({ t: "screen", id: matches[i] }); // keyboard path to the inspector
      results.hidden = true;
      findBox.setAttribute("aria-expanded", "false");
    }
    function endSearch() {
      findBox.value = "";
      search();
    }
    function applyMatch() {
      const on = new Set(matches);
      frames.forEach((f, id) => f.classList.toggle("uf-match", on.has(id)));
    }

    bar.insertBefore(finder(), bFit);

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
      matches = matches.filter((id) => frames.has(id));
      applyMatch();
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
      else if (matches.length) endSearch();
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

  // ------------------------------------------------------------------ standalone auto-run
  function auto() {
    const data = document.getElementById("uiflow-data");
    if (!data) return; // the dashboard mounts the engine itself
    const src = document.documentElement.outerHTML; // before mount: what "Lưu file" writes back
    // the host fills the page (styles above). Added after `src`, so a saved file stays as built and gets it again
    // when it is opened; the dashboard mounts through UIFlow.mount and sizes its own container.
    document.documentElement.classList.add("uf-file");
    let host = document.getElementById("uiflow");
    if (!host) {
      host = h("div");
      host.id = "uiflow";
      document.body.append(host);
    }
    let flow;
    try {
      flow = JSON.parse(data.textContent);
    } catch {
      host.textContent = tr(/^vi/i.test(navigator.language || "") ? "vi" : "en")("bad");
      return;
    }
    let shots = {};
    try {
      shots = JSON.parse(document.getElementById("uiflow-shots")?.textContent || "{}");
    } catch { /* a file without images: plain frames */ }
    host.uiflow = mount(host, flow, { edit: true, shots }, src); // the only handle an exported file has on its engine
  }

  window.UIFlow = Object.freeze({ SCREEN, layout, check, paths: (f, lang) => checklist(normalize(f), tr(lang)), mount: (el, flow, opts) => mount(el, flow, opts, null) });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto, { once: true });
  else auto();
})();
