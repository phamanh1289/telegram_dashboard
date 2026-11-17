import { acCodes, itm, scr, startOf } from './values.js';
import { shotOf } from './shots.js';
import { rowsOf } from './geometry.js';
import { sanitize } from './model.js';
import { tr } from './i18n.js';

/** Rows for what `sanitize` dropped (kind "broken"); screen set when there is one to go to. */
function brokenRows(d, t) {
  return [
    ...d.screens.map((id) => ({ kind: "broken", screen: id, text: t("dupScreen", { s: id }) })),
    ...d.items.map((src) => ({ kind: "broken", screen: scr(src), item: itm(src), text: t("dupItem", { i: itm(src), s: scr(src) }) })),
    ...(d.links ? [{ kind: "broken", text: t("badLinks", { n: d.links }) }] : []),
    ...(d.bad ? [{ kind: "broken", text: t("badEntries", { n: d.bad }) }] : []),
  ];
}
/** Gaps in a normalized flow: nostart (no start screen chosen), orphan, dead, offshot (a button its design image does not show), noback, noac, nosrc
 *  (a screen with no design link). offshot needs the images (SHOTS): without them it reports nothing. */
function gaps(f, t) {
  const out = [], first = startOf(f);
  const by = new Map(f.screens.map((s) => [s.id, s]));
  const into = new Set(f.links.map((l) => l.to));
  const from = new Set(f.links.map((l) => l.src));
  const back = new Set(f.links.filter((l) => l.act === "back").map((l) => scr(l.src)));
  // steps left out of the map for want of a design: where each is reached from, when the ticket said
  for (const p of f.pending || []) {
    const s = p.src ? by.get(scr(p.src)) : null, i = s && itm(p.src);
    const at = !s ? "" : t(i ? "pendingFromBtn" : "pendingFrom", { s: s.title, i: i ? s.items.find((it) => it.id === i).label : "" });
    out.push({ kind: "pending", pending: p.title, ...(s ? { screen: s.id } : {}), ...(i ? { item: i } : {}),
      text: [t("pendingRow", { s: p.title }) + at, p.when, p.ac].filter(Boolean).join(" · ") });
  }
  // none chosen (or the chosen one is gone): Prototype and the test paths quietly start at the first screen
  if (first && f.start !== first) out.push({ kind: "nostart", screen: first, text: t("nostart", { s: by.get(first).title }) });
  for (const s of f.screens) {
    if (s.id !== first && !into.has(s.id)) out.push({ kind: "orphan", screen: s.id, text: t("orphan", { s: s.title }) });
    for (const it of s.items)
      if (!from.has(`${s.id}.${it.id}`))
        out.push({ kind: "dead", screen: s.id, item: it.id, text: t("dead", { s: s.title, i: it.label }) });
    if (s.kind === "screen" && s.id !== first && s.items.length && !back.has(s.id))
      out.push({ kind: "noback", screen: s.id, text: t("noback", { s: s.title }) });
    if (shotOf(s)) rowsOf(s).forEach(({ hot }, i) => {
      if (!hot) out.push({ kind: "offshot", screen: s.id, item: s.items[i].id, text: t("offshot", { s: s.title, i: s.items[i].label }) });
    });
    if (s.kind === "screen" && !s.zeplin) out.push({ kind: "nosrc", screen: s.id, text: t("nosrc", { s: s.title }) });
  }
  // the ticket's AC no screen, arrow or waiting step carries (f.acs: read from the ticket at the last render). A code
  // stands for its sub-codes and the other way round ("AC1" on a screen covers AC1.2; "AC1.2" on an arrow, AC1).
  const have = [...f.screens, ...f.links, ...(f.pending || [])].flatMap((x) => acCodes(x.ac).map((c) => c.replace(/[\s-]+/g, "").toUpperCase()));
  const lost = (f.acs || []).filter((c) => !have.some((x) => x === c || x.startsWith(c + ".") || c.startsWith(x + ".")));
  if (lost.length) out.push({ kind: "noflow", text: t("noflow", { n: lost.length, s: lost.join(", ") }) });
  for (const l of f.links) {
    if (l.ac) continue;
    const s = by.get(scr(l.src)), i = itm(l.src), name = i ? s.items.find((it) => it.id === i).label : s.title;
    out.push({ kind: "noac", screen: s.id, ...(i ? { item: i } : {}), text: t("noacLink", { i: name, s: by.get(l.to).title }) });
  }
  return out;
}
const KIND_ORDER = ["broken", "unclear", "pending", "nostart", "orphan", "dead", "offshot", "noback", "noac", "noflow", "nosrc"];
/** The steps without a design as messages for whoever owns it (PO / designer), in plain words: the ticket, then at
 *  most three steps a message, one a line; a lone fourth joins the message before it (= ASK_MSG, splitAsks). */
function pendingAsk(f, t) {
  const by = new Map(f.screens.map((s) => [s.id, s]));
  const rows = (f.pending || []).map((p) => {
    const s = p.src ? by.get(scr(p.src)) : null, i = s && itm(p.src);
    const at = !s ? "" : t(i ? "pendingFromBtn" : "pendingFrom", { s: s.title, i: i ? s.items.find((it) => it.id === i)?.label ?? "" : "" });
    return [p.title + at, p.when, p.ac].filter(Boolean).join(" · ");
  });
  const msgs = [];
  for (let k = 0; k < rows.length; k += 3) msgs.push(rows.slice(k, k + 3));
  if (msgs.length > 1 && msgs[msgs.length - 1].length === 1) msgs[msgs.length - 2].push(...msgs.pop());
  return msgs.map((m) => [t("askHead", { s: f.ticket }), ...m.map((r, n) => `${n + 1}. ${r}`)].join("\n")).join("\n\n");
}
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
/** [{kind: "broken" | "pending" | "nostart" | "orphan" | "dead" | "offshot" | "noback" | "noac" | "noflow" | "nosrc", screen?, item?, text}] for a raw flow. */
function check(flow, lang) {
  const { flow: f, dropped } = sanitize(flow), t = tr(lang);
  return [...brokenRows(dropped, t), ...gaps(f, t)];
}

export { brokenRows, gaps, KIND_ORDER, pendingAsk, testPaths, stepText, checklist, check };
