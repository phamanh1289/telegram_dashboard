import { itm, scr, startOf } from './values.js';
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

export { brokenRows, gaps, KIND_ORDER, testPaths, stepText, checklist, check };
