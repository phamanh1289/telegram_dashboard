import { btn, h, ibtn } from './dom.js';
import { scr, startOf } from './values.js';
import { KIND_ORDER, brokenRows, checklist, gaps, pendingAsk, stepText, testPaths } from './checks.js';

// ------------------------------------------------------------------ flow check panel ("Soát luồng")
/** The review list (gaps of the flow, filtered by kind) and the test checklist, in `panel`; `bCheck` opens it and
 *  `nCheck` counts the rows. ctx: {t, panel, bCheck, nCheck, get(): flow, dropped(): what sanitize dropped,
 *  editing(): the map is being edited, goto(id), pick(sel), zeplinForm(open, pending), zformOpen(), commit(flow),
 *  walk(links): Prototype walks that test path}. */
function checkPanel(ctx) {
  const { t, panel, bCheck, nCheck } = ctx;
  let notes = []; // the host's warnings about how this flow was built: rows of their own, no screen to go to
  let issues = [], tab = "gaps", kind = null; // what the panel shows: the review list (filtered by kind) or the checklist

  function refresh() {
    issues = [...brokenRows(ctx.dropped(), t), ...notes.map((text) => ({ kind: "unclear", text })), ...gaps(ctx.get(), t)];
    bCheck.setAttribute("aria-label", t("check", { n: issues.length }));
    nCheck.textContent = String(issues.length);
    bCheck.classList.toggle("uf-clean", !issues.length);
    if (!panel.hidden) fill();
  }
  const chip = (label, on, fn) => {
    const b = btn(label, "uf-btn", fn);
    b.setAttribute("aria-pressed", String(on));
    return b;
  };
  /** "Sao chép" + the line that says it worked (or that it did not: select and copy by hand). */
  function copyRow(text) {
    const msg = h("p", "uf-zmsg"), acts = h("div", "uf-acts");
    msg.setAttribute("role", "status");
    acts.append(btn(t("copy"), "uf-btn", async () => {
      try {
        await navigator.clipboard.writeText(text);
        msg.textContent = t("copied");
      } catch {
        msg.textContent = t("copyFail");
      }
    }));
    return [acts, msg];
  }
  function fill() {
    const tabs = h("div", "uf-ptabs");
    tabs.setAttribute("role", "group");
    tabs.append(chip(t("gapsTab", { n: issues.length }), tab === "gaps", () => { tab = "gaps"; fill(); }),
      chip(t("testsTab"), tab === "tests", () => { tab = "tests"; fill(); }));
    if (tab === "tests") return panel.replaceChildren(tabs, ...testsView());
    if (!issues.length) return panel.replaceChildren(tabs, h("p", "uf-none", t("ok")));
    const counts = new Map();
    for (const it of issues) counts.set(it.kind, (counts.get(it.kind) || 0) + 1);
    if (kind && !counts.has(kind)) kind = null;
    const filter = h("div", "uf-pfilter");
    filter.setAttribute("role", "group");
    filter.append(chip(t("all", { n: issues.length }), !kind, () => { kind = null; fill(); }),
      ...KIND_ORDER.filter((k) => counts.has(k)).map((k) =>
        chip(`${t("k_" + k)} (${counts.get(k)})`, kind === k, () => { kind = k; fill(); })));
    const rows = issues.filter((it) => !kind || it.kind === kind).map((it) => {
      const b = btn(null, "uf-issue", () => {
        toggle();
        if (!it.screen) return;
        ctx.goto(it.screen);
        // editing: open what the row is about, so its fix (draw the area, link it, add the AC) is one click away
        if (ctx.editing()) ctx.pick(it.item ? { t: "item", id: it.screen, item: it.item } : { t: "screen", id: it.screen });
      });
      b.append(h("span", "uf-tag uf-tag-" + it.kind, t("k_" + it.kind)), h("span", "uf-txt", it.text));
      if (it.kind !== "pending" || !ctx.editing()) return b;
      // editing: the row asks for the step's Zeplin link (the screen comes linked from where the step was reached);
      // ✕ takes a step that will never get a screen off the list
      b.addEventListener("click", () => ctx.zeplinForm(true, it.pending));
      b.title = t("pendingAdd", { s: it.pending });
      const row = h("div", "uf-prow");
      row.append(b, ibtn("x", t("pendingSkip"), "uf-btn", () => {
        const f = structuredClone(ctx.get());
        f.pending = (f.pending || []).filter((x) => x.title !== it.pending);
        ctx.commit(f);
      }));
      return row;
    });
    // the steps without a design, as a message to whoever owns it: copied, pasted into the ticket or the group
    const ask = kind === "pending" ? copyRow(pendingAsk(ctx.get(), t)) : [];
    panel.replaceChildren(tabs, filter, ...rows, ...ask);
  }
  function testsView() {
    const cur = ctx.get(), { paths, missed } = testPaths(cur), first = startOf(cur);
    const title = (id) => cur.screens.find((s) => s.id === id)?.title;
    if (!paths.length) return [h("p", "uf-none", t("noPaths"))];
    const text = checklist(cur, t);
    const list = h("ol", "uf-paths");
    for (const p of paths) {
      // a path is a button: Prototype walks it by itself, a step at a time, so each line can be watched as written
      const li = h("li"), b = btn(`${title(first)} → ${p.map((l) => stepText(cur, l, t)).join(" → ")}`, "uf-path", () => {
        toggle();
        ctx.walk(p);
      });
      b.title = t("walkPath");
      li.append(b);
      list.append(li);
    }
    const out = [h("p", "uf-count", text.split("\n")[0]), list];
    if (missed.length) out.push(h("p", "uf-none", t("missed", { s: missed.map((l) => `${title(scr(l.src))} → ${title(l.to)}`).join("; ") })));
    out.push(...copyRow(text));
    return out;
  }
  function toggle() {
    if (panel.hidden && ctx.zformOpen()) ctx.zeplinForm(false);
    panel.hidden = !panel.hidden;
    bCheck.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) fill();
  }
  return {
    refresh,
    toggle,
    isOpen: () => !panel.hidden,
    /** What the render could not make sure of (plain text lines); [] clears them. */
    notes(list) {
      notes = (Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && x).slice(0, 20);
      refresh();
    },
  };
}

export { checkPanel };
