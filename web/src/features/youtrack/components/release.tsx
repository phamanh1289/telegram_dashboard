"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartBar, CircleCheck, CircleX, Download, FileDown, List, MessageSquare, Printer, TriangleAlert } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { fmtDate, type Key, tMaybe, useT, type Vars } from "@/shared/lib/i18n";
import { useNow } from "@/shared/hooks/use-now";
import { getPref, onPrefs, setPref } from "@/shared/lib/prefs";
import { ago, ymd } from "@/shared/lib/time";
import { cn, downloadText } from "@/shared/lib/utils";
import { AI_MAX, bucket, DAY, isBlocked, isBug, isBuilt, needsPo, rank, shortName, shortSp, tagsOf, type Ticket, titleOf, when, ytApi } from "@/features/youtrack/lib/yt";
import { useAiWait } from "@/shared/components/ai/fetching";
import { AiAsk, Card, Menu, MultiSelect, Person, Tag, YtFetching } from "./bits";
import { runningSprints } from "@/features/youtrack/lib/yt-stats";
import { HBars, Stack } from "./dashboard";
import { PAGE, Pager } from "./home";
import { workDays } from "./report";
import { useYt } from "./state";

// Release / go-live check: one question, "will this release make it?". Pick the go-live day and the scope (by sprint, or by
// day: tickets created, updated, closed or due between a start day and go-live). The page answers with a verdict and its
// reasons, the scope's progress along the flow, and the tickets to act on (each with what is wrong, the next step and who).
// Open tickets linked to the scope but outside it count too: they can hold the release. The whole project, not the header's
// people filter. The go-live day is the AI release report's one (`ytRelease:<project>`).

type Trace = Record<string, { desc?: string; links:{ rel: string; issues: Ticket[] }[]; last: { text: string; created: number; author: string | null } | null }>;
type St = "block" | "po" | "todo" | "doing" | "qc" | "ready" | "done";
type Tr = (key: Key, v?: Vars) => string;
const ST: Record<St, { label: Key; chip: string; bar: string; next: (t: Tr, i: Ticket, day: string) => string }> = {
  block: { label: "Blocked", chip: "bg-error-wash text-error", bar: "var(--color-error)", next: (t) => t("Gỡ block") },
  po: { label: "Chờ PO", chip: "bg-signal-wash text-signal-2", bar: "var(--color-signal-2)", next: (t) => t("PO chốt định nghĩa / design") },
  todo: { label: "Chưa làm", chip: "bg-paper-3 text-ink-2", bar: "var(--color-rule-2)", next: (t, i) => t(i.assignee ? "Bắt đầu làm" : "Giao người làm") },
  doing: { label: "Đang làm", chip: "bg-info-wash text-info", bar: "var(--color-info)", next: (t) => t("Xong code, chuyển QC") },
  qc: { label: "Chờ QC", chip: "bg-warn-wash text-warn", bar: "var(--color-warn)", next: (t, i) => (i.qc ? "QC test pass" : t("Giao người QC")) },
  ready: { label: "Chờ release", chip: "bg-ok-wash text-ok", bar: "color-mix(in oklch, var(--color-ok) 55%, transparent)", next: (t, _, day) => t("Lên prod {d}", { d: fmtShort(day) }) },
  done: { label: "Xong", chip: "bg-ok-wash text-ok", bar: "var(--color-ok)", next: () => "—" },
};
const FLOW: St[] = ["block", "po", "todo", "doing", "qc", "ready", "done"]; // list order: the furthest from shipping first
const BAR: St[] = ["done", "ready", "qc", "doing", "todo", "po", "block"]; // the bar fills from the left as tickets ship
const statusOf = (i: Ticket): St => (i.resolved ? "done" : isBuilt(i) ? "ready" : isBlocked(i) || /ON HOLD/i.test(i.state ?? "") ? "block"
  : needsPo(i) ? "po" : bucket(i) === 2 ? "qc" : bucket(i) === 1 ? "doing" : "todo");
const shipped = (s: St) => s === "ready" || s === "done";

/** One thing that threatens the release; `key` groups them in the verdict. WHY: a noun phrase after a count ("3 ticket bị block"). */
type Why = { sev: "bad" | "warn"; key: keyof typeof WHY; text: string };
const WHY = {
  passed: "ticket chưa xong khi đã qua go-live", block: "ticket bị block", wait: "ticket chờ ticket khác chưa xong", late: "ticket chưa tới QC khi sắp go-live", crit: "bug Critical / Highest chưa xong",
  linkbug: "bug liên kết còn mở", outside: "ticket liên kết nằm ngoài phạm vi", start: "ticket chưa bắt đầu", due: "ticket có hạn sau go-live",
  owner: "ticket chưa có người làm", noqc: "ticket chờ test chưa có QC", stale: "ticket đứng yên quá 3 ngày",
} as const;

const NO_TRACE: Trace = {};
const day0 = (s: string) => +new Date(`${s}T00:00`);
const fmtDay = (s: string) => fmtDate(day0(s), { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
const fmtShort = (s: string) => fmtDate(day0(s), { day: "2-digit", month: "2-digit" });
const plain = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`#>_]/g, "").replace(/\s+/g, " ").trim();
const brief = (s?: string) => { const t = plain(s ?? ""); return t.length > 200 ? `${t.slice(0, 197)}…` : t; };
/** Link names (read from this ticket's side) meaning "can't ship before the other one": YouTrack's Depend and Subtask. */
const WAIT_RE = /depends on|blocked by|parent for/i;
const usePrefValue =(key: string) => useSyncExternalStore(onPrefs, () => getPref(key) ?? "", () => "");

export function ReleasePage() {
  const y = useYt();
  const t = useT();
  const now = useNow();
  const relPref = usePrefValue(`ytRelease:${y.project}`);
  const spPref = usePrefValue(`ytRelSprints:${y.project}`);
  const by = usePrefValue(`ytRelBy:${y.project}`) === "day" ? "day" : "sprint";
  const fromPref = usePrefValue(`ytRelFrom:${y.project}`);
  const [pick, setPick] = useState<St | "all" | "act" | null>(null); // null: "act" while something needs acting on, else all
  const [page, setPage] = useState(0);
  const chart = usePrefValue("ytRelChart") === "1";

  // the whole project (same cache as the header's "everyone" preset; the header's refresh reloads it)
  const all = useQuery({
    queryKey: ["yt", "issues", y.project, "*"],
    queryFn: ({ signal }) => ytApi<Ticket[]>(`/issues?project=${encodeURIComponent(y.project)}`, { signal }),
    enabled: !!y.config && !y.config.mock, staleTime: 60_000,
  });

  // scope: the picked sprints (default: the ones running now, else the latest), or a day range ending on go-live
  const sprintList = useMemo(() => [...y.sprints.values()].sort((a, b) => b.start - a.start), [y.sprints]);
  const picked = useMemo(() => { try { const a = JSON.parse(spPref || "null"); return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : null; } catch { return null; } }, [spPref]);
  // the same default sprint(s) as the dashboard KPIs
  const auto = runningSprints(y, now);
  const starts = auto.flatMap((n) => y.sprints.get(n)?.start ?? []);
  const sprints = picked ?? auto;
  const sprintEnd = Math.max(0, ...sprints.map((n) => y.sprints.get(n)?.finish ?? 0));
  const day = relPref || ymd(sprintEnd || now + 7 * DAY);
  const from = fromPref || ymd(starts.length ? Math.min(...starts) : day0(day) - 14 * DAY);
  const rel = day0(day) + DAY - 1; // the end of go-live day

  const rows = useMemo(() => {
    if (by === "sprint") return (all.data ?? []).filter((i) => i.sprints.some((s) => sprints.includes(s)));
    const a = day0(from), inRange = (t: number | null) => !!t && t >= a && t <= rel;
    return (all.data ?? []).filter((i) => inRange(i.created) || inRange(i.updated) || inRange(i.resolved) || inRange(i.due));
  }, [all.data, sprints, by, from, rel]);
  const ids = useMemo(() => rows.map((i) => i.id).sort().slice(0, 300), [rows]);
  const trace = useQuery({
    queryKey: ["yt", "trace", ids.join(",")],
    queryFn: ({ signal }) => ytApi<Trace>(`/trace?ids=${encodeURIComponent(ids.join(","))}`, { signal }),
    enabled: ids.length > 0, staleTime: 60_000,
  });
  const tr = trace.data ?? NO_TRACE;

  const left = workDays(now, day);
  const passed = now > rel;

  // open tickets linked to the scope but outside it, with the scope tickets they hang on
  const outside = useMemo(() => {
    const inScope = new Set(rows.map((i) => i.id)), m = new Map<string, { i: Ticket; from: string[] }>();
    for (const i of rows) for (const l of tr[i.id]?.links ?? []) for (const x of l.issues) {
      if (inScope.has(x.id) || x.resolved) continue;
      const e = m.get(x.id) ?? { i: x, from: [] };
      e.from.push(i.id);
      m.set(x.id, e);
    }
    return [...m.values()];
  }, [rows, tr]);

  // the unshipped tickets this one waits on (depends on / blocked by / its subtasks)
  const waitsOf = (id: string) => (tr[id]?.links ?? []).filter((l) => WAIT_RE.test(l.rel)).flatMap((l) => l.issues).filter((x) => !shipped(statusOf(x)));

  function whyOf(i: Ticket, out?: string[]): Why[] {
    const s = statusOf(i), w: Why[] = [];
    if (shipped(s)) return w;
    const crit = isBug(i) && rank(i) <= 1;
    if (out) w.push({ sev: crit ? "bad" : "warn", key: "outside", text: t("Ngoài phạm vi, liên kết với {x}", { x: out.join(", ") }) });
    if (passed) w.push({ sev: "bad", key: "passed", text: t("Đã qua ngày go-live") });
    if (s === "block") w.push({ sev: "bad", key: "block", text: "Blocked" });
    if (!passed && left <= 1 && ["po", "todo", "doing", "block"].includes(s)) w.push({ sev: "bad", key: "late", text: t(left ? "Chưa tới QC, còn 1 ngày" : "Chưa tới QC, go-live hôm nay") });
    else if (!passed && left <= 3 && (s === "po" || s === "todo")) w.push({ sev: "warn", key: "start", text: t("Chưa bắt đầu, còn {n} ngày", { n: left }) });
    if (crit && !out) w.push({ sev: "bad", key: "crit", text: `Bug ${i.priority}` });
    const waits = waitsOf(i.id);
    for (const x of waits) {
      const xs = statusOf(x), far = xs === "block" || passed || (left <= 3 && ["po", "todo", "doing"].includes(xs));
      w.push({ sev: far ? "bad" : "warn", key: "wait", text: t("Chờ {id} ({x})", { id: x.id, x: t(ST[xs].label) + (x.assignee ? `, ${shortName(x.assignee)}` : "") }) });
    }
    for (const x of (tr[i.id]?.links ?? []).flatMap((l) => l.issues)) if (!x.resolved && isBug(x) && !waits.some((y) => y.id === x.id)) w.push({ sev: rank(x) <= 1 ? "bad" : "warn", key: "linkbug", text: t("Bug {id} chưa xong", { id: x.id }) });
    if (i.due && i.due > rel) w.push({ sev: "warn", key: "due", text: t("Hạn {d}, sau go-live", { d: fmtDate(i.due, { day: "2-digit", month: "2-digit" }) }) });
    if (!i.assignee) w.push({ sev: "warn", key: "owner", text: t("Chưa có người làm") });
    if (s === "qc" && !i.qc) w.push({ sev: "warn", key: "noqc", text: t("Chưa có QC") });
    const idle = Math.floor((now - i.updated) / DAY);
    if (idle > 3 && (s === "doing" || s === "qc" || s === "block")) w.push({ sev: "warn", key: "stale", text: t("Đứng yên {n} ngày", { n: idle }) });
    return w;
  }

  type Row = { i: Ticket; s: St; why: Why[]; out: boolean };
  const scoped: Row[] = rows.map((i) => ({ i, s: statusOf(i), why: whyOf(i), out: false }));
  const extra: Row[] = outside.map(({ i, from: f }) => ({ i, s: statusOf(i), why: whyOf(i, f), out: true }));
  const bad = (r: Row) => r.why.some((w) => w.sev === "bad");
  const act = [...scoped, ...extra].filter((r) => r.why.length)
    .sort((a, b) => Number(bad(b)) - Number(bad(a)) || b.why.length - a.why.length || FLOW.indexOf(a.s) - FLOW.indexOf(b.s));
  const n = (s: St) => scoped.filter((r) => r.s === s).length;
  const ready = n("ready") + n("done");

  // the verdict: bad if anything holds the date, at risk if anything could, else fine; its reasons counted per ticket
  const level = !rows.length ? null : act.some(bad) ? "bad" : act.length ? "warn" : "ok";
  const tally = new Map<Why["key"], { n: number; bad: boolean; is: Ticket[] }>();
  for (const r of act) for (const w of new Map(r.why.map((x) => [x.key, x])).values()) {
    const e = tally.get(w.key) ?? { n: 0, bad: false, is: [] };
    tally.set(w.key, { n: e.n + 1, bad: e.bad || w.sev === "bad", is: [...e.is, r.i] });
  }
  const reasons = [...tally].map(([k, e]) => ({ k, ...e })).sort((a, b) => Number(b.bad) - Number(a.bad) || b.n - a.n);

  // the short why, in words: what holds the release (or what could), else why it is fine
  const said = (rs: typeof reasons) => rs.map((r) => `${r.n} ${t(WHY[r.k], { n: r.n })}`).join(", ");
  const blockers = reasons.filter((r) => r.bad), risks = reasons.filter((r) => !r.bad), rest = rows.length - ready;
  const summary = !level ? "" : level === "ok"
    ? t("Đạt vì {a}/{b} ticket đã xong hoặc chờ release", { a: ready, b: rows.length }) + (rest ? t(", {n} ticket còn lại đúng tiến độ (còn {d} ngày làm việc)", { n: rest, d: left }) : "")
      + t("; không ticket nào bị block, trễ, thiếu người hay vướng bug.")
    : [level === "bad" ? t("Chưa release được vì {x}.", { x: said(blockers) }) : t("Release được nếu xử lý {x}; chưa có gì chặn go-live.", { x: said(risks.slice(0, 3)) }),
      level === "bad" && risks.length ? t("Thêm rủi ro: {x}.", { x: said(risks.slice(0, 2)) }) : "", t("Đã sẵn sàng {a}/{b}.", { a: ready, b: rows.length })].filter(Boolean).join(" ");
  const V = {
    ok: { icon: CircleCheck, text: t(passed ? "Đã go-live, mọi ticket xong" : "Ổn để go-live"), bg: "bg-ok-wash", fg: "text-ok" },
    warn: { icon: TriangleAlert, text: t("Có rủi ro"), bg: "bg-warn-wash", fg: "text-warn" },
    bad: { icon: CircleX, text: t(passed ? "Trễ go-live" : "Khó kịp go-live"), bg: "bg-error-wash", fg: "text-error" },
  };
  const v = level && V[level];

  // the bottleneck: the stage, the person and the ticket holding the most unfinished work
  const open = [...scoped, ...extra].filter((r) => !shipped(r.s));
  const most = (key: (r: Row) => string) => {
    const m = new Map<string, Row[]>();
    for (const r of open) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m].sort((a, b) => b[1].length - a[1].length)[0];
  };
  const stage = most((r) => r.s), owner = most((r) => (r.s === "qc" ? (r.i.qc ?? "Chưa có QC") : (r.i.assignee ?? "Chưa có người")));
  const holds = new Map<string, { i: Ticket; is: Ticket[] }>();
  for (const r of open) for (const x of waitsOf(r.i.id)) { const e = holds.get(x.id) ?? { i: x, is: [] }; e.is.push(r.i); holds.set(x.id, e); }
  const blocker = [...holds.values()].sort((a, b) => b.is.length - a.is.length)[0];
  const necks: { label: string; text: string; is: Ticket[] }[] = [];
  if (stage) necks.push({ label: t("Giai đoạn"), text: t("{a}/{b} ticket chưa xong đang ở {x}", { a: stage[1].length, b: open.length, x: t(ST[stage[0] as St].label) }), is: stage[1].map((r) => r.i) });
  if (owner && owner[1].length > 1) {
    const k = owner[1].filter((r) => r.why.length).length;
    necks.push({ label: t("Người"), text: t("{p} giữ {a}/{b} ticket chưa xong", { p: tMaybe(owner[0]), a: owner[1].length, b: open.length }) + (k ? t(", {n} có vấn đề", { n: k }) : ""), is: owner[1].map((r) => r.i) });
  }
  if (blocker) necks.push({ label: t("Ticket chặn"), text: t("{id} ({x}) chặn {n} ticket: {ids}", { id: blocker.i.id, x: t(ST[statusOf(blocker.i)].label), n: blocker.is.length, ids: blocker.is.slice(0, 3).map((i) => i.id).join(", ") }) + (blocker.is.length > 3 ? "…" : ""), is: [blocker.i, ...blocker.is] });

  const view = pick === "act" && !act.length ? "all" : pick ?? (act.length ? "act" : "all");
  const shown = view === "act" ? act : scoped.filter((r) => view === "all" || r.s === view)
    .sort((a, b) => FLOW.indexOf(a.s) - FLOW.indexOf(b.s) || rank(a.i) - rank(b.i));
  const pages = Math.ceil(shown.length / PAGE), pg = Math.min(page, Math.max(0, pages - 1)); // the list shrank: stay in range
  const filter = (x: St | "all" | "act") => { setPick(x); setPage(0); };
  const list = (title: string, is: Ticket[]) => y.setSheet({ kind: "list", title, rows: is });
  const scopeText = by === "sprint" ? `Sprint ${sprints.map(shortSp).join(", ") || "—"}` : t("Từ {a} tới {b}", { a: fmtShort(from), b: fmtShort(day) });

  function md() {
    const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    const head = `# Go-live ${fmtDay(day)}: ${y.project}\n\n**${v?.text ?? t("Chưa có ticket")}** · ${t("{a}/{b} sẵn sàng", { a: ready, b: rows.length })} · ${t("còn {n} ngày làm việc", { n: left })} · ${scopeText} · ${t("tạo lúc {w}", { w: when(now) })}\n`;
    const why = summary ? `\n**${t("Tóm tắt:")}** ${summary}\n${reasons.map((r) => `\n- ${r.n} ${t(WHY[r.k], { n: r.n })}: ${r.is.map((i) => i.id).join(", ")}`).join("")}\n` : "";
    const neck = necks.length ? `\n**${t("Nút thắt:")}**\n${necks.map((x) => `\n- ${x.label}: ${x.text}`).join("")}\n` : "";
    const todo = act.length ? `\n## ${t("Cần xử lý")}\n\n| Ticket | ${t("Mô tả")} | ${t("Vấn đề")} | ${t("Việc tiếp theo")} | ${t("Ai")} | ${t("Giai đoạn")} |\n|---|---|---|---|---|---|\n${act.map((r) =>
      `| ${r.i.id} ${cell(titleOf(r.i))} | ${cell(brief(tr[r.i.id]?.desc)) || "—"} |${cell(r.why.map((w) => w.text).join("; "))} | ${cell(ST[r.s].next(t, r.i, day))} | ${r.i.assignee ?? "—"}${r.i.qc ? ` / QC ${r.i.qc}` : ""} | ${t(ST[r.s].label)} |`).join("\n")}\n` : "";
    const flow = FLOW.filter((s) => n(s)).map((s) => `\n### ${t(ST[s].label)} (${n(s)})\n\n${scoped.filter((r) => r.s === s).map((r) => `- ${r.i.id} ${titleOf(r.i)} (${r.i.assignee ?? t("chưa có người")})`).join("\n")}\n`).join("");
    downloadText(`${head}${why}${neck}${todo}\n## ${t("Theo giai đoạn")}\n${flow}`, `go-live-${y.project}-${day}.md`);
  }
  const askAi = () => y.setSheet({ kind: "work", title: `AI · Go-live ${fmtShort(day)}`, ids: [...act.map((r) => r.i.id), ...scoped.filter((r) => !shipped(r.s) && !r.why.length).map((r) => r.i.id)].slice(0, AI_MAX) });

  const loading = useAiWait(all.isPending || (ids.length > 0 && trace.isPending && !trace.isError));
  if (y.config?.mock) return <p className="text-sm text-ink-2">{t("Cần token YouTrack để theo dõi release.")}</p>;
  return (
    <div className="grid grid-cols-1 gap-4">
      {/* the question: which release (scope + go-live day) */}
      <div className="yt-noprint flex flex-wrap items-center gap-2">
        <Segmented id="yt-release-by" label={t("Phạm vi")} value={by} onChange={(x) => setPref(`ytRelBy:${y.project}`, x === "day" ? "day" : null)} items={[
          { value: "sprint", label: t("Theo sprint"), title: t("Mọi ticket trong sprint phát hành") },
          { value: "day", label: t("Theo ngày"), title: t("Ticket tạo, cập nhật, xong hoặc tới hạn trong khoảng ngày") },
        ]} />
        {by === "sprint" ? <MultiSelect label="Sprint" all={t("Chọn sprint")} options={sprintList.map((s) => s.name)} value={sprints} render={shortSp} className="w-44"
          onChange={(x) => setPref(`ytRelSprints:${y.project}`, JSON.stringify(x))} />
          : <Input type="date" className="h-8 w-36" value={from} max={day} onChange={(e) => setPref(`ytRelFrom:${y.project}`, e.target.value || null)} aria-label={t("Từ ngày")} />}
        <label className="flex items-center gap-1.5 text-xs text-ink-3">{by === "day" ? t("tới go-live") : "Go-live"}
          <Input type="date" className="h-8 w-36" value={day} onChange={(e) => setPref(`ytRelease:${y.project}`, e.target.value || null)} aria-label={t("Ngày go-live")} />
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          {y.aiOn && rows.length > 0 && <AiAsk label={t("Hỏi AI về release này")} hint={t("AI đọc các ticket cần xử lý và ticket chưa xong")} onClick={askAi} />}
          <Menu align="right" title={t("Xuất báo cáo")} label={<span className="inline-flex items-center gap-1.5"><Download className="size-4" />{t("Xuất")}</span>} items={[
            { label: <><FileDown /> Markdown (.md)</>, on: md, disabled: !rows.length },
            { label: <><Printer /> {t("In / PDF")}</>, hint: t("Chọn Lưu dạng PDF trong hộp in"), on: () => window.print(), disabled: !rows.length },
          ]} />
        </div>
      </div>

      {/* the answer: verdict, countdown, progress along the flow, why */}
      <section aria-label={t("Kết luận release")} className={cn("grid gap-4 rounded-[var(--radius-card)] p-5 shadow-stock", v?.bg ?? "bg-cotton")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <p className="text-xs font-bold text-ink-3">Go-live {fmtDay(day)} · {y.project}</p>
            {loading ? <Skeleton className="h-9 w-64" /> : (
              <h2 className={cn("flex items-center gap-2 text-2xl font-bold sm:text-3xl", v?.fg ?? "text-ink-2")}>
                {v && <v.icon className="size-7 shrink-0" aria-hidden />}{v?.text ?? t("Chưa có ticket trong phạm vi")}
              </h2>
            )}
            <p className="text-sm text-ink-2">{t.n("{s} · {n} ticket sẵn sàng (xong hoặc chờ release)", { s: scopeText, n: <b className="font-bold text-ink tabular-nums">{ready}/{rows.length}</b> })}</p>
          </div>
          <div className="grid justify-items-start leading-tight sm:justify-items-end">
            <span className={cn("font-mono text-4xl font-bold tabular-nums", passed || left <= 1 ? "text-error" : left <= 3 ? "text-warn" : "text-ink")}>{passed ? 0 : left}</span>
            <span className="text-xs text-ink-3">{t(passed ? "đã qua go-live" : "ngày làm việc còn lại")}</span>
          </div>
        </div>
        {rows.length > 0 && (
          <div role="img" aria-label={t("Tiến độ: {x}", { x: BAR.filter((s) => n(s)).map((s) => `${t(ST[s].label)} ${n(s)}`).join(", ") })} className="flex h-3 gap-px overflow-hidden rounded-full bg-paper-3">
            {BAR.map((s) => n(s) > 0 && <i key={s} className="h-full" style={{ width: `${(n(s) / rows.length) * 100}%`, background: ST[s].bar }} />)}
          </div>
        )}
        {summary && !loading && (
          <p className="max-w-[75ch] text-sm text-ink"><b className="font-bold">{t("Tóm tắt:")} </b>{summary}</p>
        )}
        {reasons.length > 0 && (
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {reasons.slice(0, 6).map((r) => (
              <li key={r.k} className="flex items-baseline gap-2">
                <i aria-hidden className={cn("size-2 shrink-0 rounded-full", r.bad ? "bg-error" : "bg-warn")} />
                <span className="min-w-0"><b className="font-bold tabular-nums">{r.n}</b> {t(WHY[r.k], { n: r.n })}{r.bad && <span className="sr-only"> ({t("chặn go-live")})</span>}
                  {" "}<span className="font-mono text-xs text-ink-3">
                    {r.is.slice(0, 3).map((i, k) => <span key={i.id}>{k > 0 && ", "}<button type="button" className="hover:text-hl-2 hover:underline" onClick={() => y.openTicket(i.id, r.is)}>{i.id}</button></span>)}
                    {r.n > 3 && <>, <button type="button" className="hover:text-hl-2 hover:underline" onClick={() => list(t(WHY[r.k]), r.is)}>+{r.n - 3}</button></>}
                  </span>
                </span>
              </li>
            ))}
            {reasons.length > 6 && <li className="text-ink-3">{t("và {n} lý do nhẹ hơn, xem Cần xử lý", { n: reasons.length - 6 })}</li>}
          </ul>
        )}
        {necks.length > 0 && !loading && (
          <div className="grid gap-1 border-t border-rule/60 pt-3 text-sm">
            <p className="font-bold text-ink">{t("Nút thắt")}</p>
            <ul className="grid gap-1">
              {necks.map((x) => (
                <li key={x.label} className="flex items-baseline gap-2">
                  <span className="w-24 shrink-0 text-xs text-ink-3">{x.label}</span>
                  <button type="button" className="min-w-0 text-left text-ink hover:text-hl-2 hover:underline" onClick={() => list(`${t("Nút thắt")} · ${x.label}`, x.is)}>{x.text}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* what to do about it */}
      <Card title="Ticket" meta={rows.length > 0 && <span className="yt-noprint">
        <Segmented id="yt-release-mode" label={t("Kiểu xem")} value={chart ? "chart" : "list"} onChange={(x) => setPref("ytRelChart", x === "chart" ? "1" : null)} items={[
          { value: "list", label: <span className="inline-flex items-center gap-1.5"><List className="size-3.5" aria-hidden />{t("Danh sách")}</span> },
          { value: "chart", label: <span className="inline-flex items-center gap-1.5"><ChartBar className="size-3.5" aria-hidden />{t("Biểu đồ")}</span>, title: t("Ticket theo giai đoạn, người làm và lý do rủi ro") },
        ]} />
      </span>}>
        {chart && rows.length > 0 && !loading ? <ReleaseCharts scoped={scoped} reasons={reasons} n={n} list={list} /> : <>
        <div className="yt-noprint -mx-1 overflow-x-auto px-1">
          <Segmented id="yt-release-view" label={t("Lọc ticket")} value={view} onChange={filter} items={[
            ...(act.length ? [{ value: "act" as const, label: <>{t("Cần xử lý")} <b className="tabular-nums">{act.length}</b></>, title: t("Ticket có vấn đề có thể làm trễ go-live, nặng nhất trước") }] : []),
            { value: "all" as const, label: <>{t("Tất cả")} <b className="tabular-nums">{rows.length}</b></> },
            ...FLOW.filter((s) => n(s)).map((s) => ({ value: s, label: <span className="inline-flex items-center gap-1.5"><i aria-hidden className="size-2 rounded-[2px]" style={{ background: ST[s].bar }} />{t(ST[s].label)} <b className="tabular-nums">{n(s)}</b></span> })),
          ]} />
        </div>
        {trace.isError && (
          <p role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-warn-wash px-3 py-2 text-sm text-warn">
            {t("Chưa đọc được liên kết và bình luận: {e}", { e: trace.error.message })}
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => void trace.refetch()}>{t("Thử lại")}</Button>
          </p>
        )}
        {loading ? <YtFetching kind="release" />
          : all.isError ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-error-wash px-3 py-2 text-sm text-error">
              {t("Không đọc được ticket từ YouTrack: {e}", { e: all.error.message })}
              <Button size="xs" variant="outline" className="ml-auto" onClick={() => void all.refetch()}>{t("Thử lại")}</Button>
            </p>
          ) : !rows.length ? <p className="text-sm text-ink-2">{t(by === "sprint" ? "Sprint đã chọn chưa có ticket. Chọn sprint phát hành ở trên." : "Không có ticket nào thay đổi hay tới hạn trong khoảng ngày này. Lùi ngày bắt đầu ở trên.")}</p>
          : (
            <ul className="zebra grid grid-cols-1">
              {shown.map(({ i, s, why, out }, k) => {
                const c = tr[i.id]?.last, tag = tagsOf(i)[0], desc = brief(tr[i.id]?.desc);
                // other pages stay in the DOM, hidden on screen: In / PDF prints the whole list
                return (
                  <li key={i.id} className={cn(Math.floor(k / PAGE) === pg ? "grid" : "hidden print:grid", "grid-cols-1 gap-x-6 gap-y-1.5 border-b border-rule/60 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_13rem_6.5rem]")}>
                    <div className="grid min-w-0 gap-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <button type="button" onClick={() => y.openTicket(i.id, shown.map((r) => r.i))} className="font-mono text-sm font-bold text-hl-2 hover:underline">{i.id}</button>
                        {isBug(i) && <span className="rounded-[4px] bg-error-wash px-1 text-xs font-bold text-error">Bug</span>}
                        {tag && <Tag name={tag} />}
                        <span className="min-w-0 text-sm text-ink">{titleOf(i)}</span>
                      </p>
                      {desc && <p className="line-clamp-2 text-xs text-ink-2">{desc}</p>}
                      {why.length > 0 && (
                        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-medium">
                          {why.map((w) => <li key={w.text} className={cn("inline-flex items-center gap-1", w.sev === "bad" ? "text-error" : "text-warn")}>
                            {w.sev === "bad" ? <CircleX className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}{w.text}</li>)}
                        </ul>
                      )}
                      <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
                        {c ? <><MessageSquare className="size-3.5 shrink-0" aria-hidden /><span className="shrink-0">{c.author ? shortName(c.author) : "?"} · {ago(c.created, now)}:</span><span className="truncate">{plain(c.text) || t("(ảnh / file)")}</span></>
                          : <>{t("Cập nhật {x}", { x: ago(i.updated, now) })}</>}
                      </p>
                    </div>
                    <div className="grid content-start gap-1 text-sm">
                      <span className="text-ink">{ST[s].next(t, i, day)}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2"><Person name={i.assignee} empty={t("Chưa có người")} />{i.qc && <span className="text-ink-3">QC {shortName(i.qc)}</span>}</span>
                    </div>
                    <div className="grid content-start justify-items-start gap-0.5 sm:justify-items-end">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", ST[s].chip)}>{t(ST[s].label)}</span>
                      <span className="text-xs text-ink-3">{out ? t("ngoài phạm vi") : i.state}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        {!loading && pages > 1 && <div className="yt-noprint"><Pager page={pg} pages={pages} total={shown.length} onGo={(x) => x >= 0 && x < pages && setPage(x)} /></div>}
        </>}
        {ids.length === 300 && <p className="text-xs text-ink-3">{t("Chỉ đọc liên kết và bình luận của 300 ticket đầu.")}</p>}
      </Card>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h4 className="text-xs font-bold text-ink-3">{children}</h4>; // sentence case (DESIGN.md)
const Dot = ({ c }: { c: string }) => <i aria-hidden className="mr-1.5 inline-block size-2 rounded-[2px]" style={{ background: c }} />;

/** The scope at a glance: tickets per stage, per person (stacked by stage), and per risk reason. A bar opens its tickets. */
function ReleaseCharts({ scoped, reasons, n, list }: {
  scoped: { i: Ticket; s: St }[]; reasons: { k: keyof typeof WHY; n: number; bad: boolean; is: Ticket[] }[]; n: (s: St) => number; list: (title: string, is: Ticket[]) => void;
}) {
  const t = useT();
  const of = (s: St) => scoped.filter((r) => r.s === s).map((r) => r.i);
  const people = new Map<string, { i: Ticket; s: St }[]>();
  for (const r of scoped) { const p = r.i.assignee ?? "Chưa có người"; people.set(p, [...(people.get(p) ?? []), r]); }
  const who = [...people].map(([p, rs]) => ({ p, rs, open: rs.filter((r) => !shipped(r.s)).length }))
    .sort((a, b) => b.open - a.open || b.rs.length - a.rs.length).slice(0, 12);
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid content-start gap-2">
        <H>{t("Theo giai đoạn")}</H>
        <HBars empty="" rows={FLOW.filter((s) => n(s)).map((s) => ({ label: <><Dot c={ST[s].bar} />{t(ST[s].label)}</>, v: n(s), c: ST[s].bar, on: () => list(t(ST[s].label), of(s)) }))} />
      </div>
      <div className="grid content-start gap-2">
        <H>{t("Lý do rủi ro")}</H>
        <HBars label="15rem" empty={t("Không có ticket nào làm trễ go-live.")} rows={reasons.map((r) => ({
          label: <span className={r.bad ? "text-error" : "text-warn"}>{t(WHY[r.k])}</span>, v: r.n, c: r.bad ? "var(--color-error)" : "var(--color-warn)", on: () => list(t(WHY[r.k]), r.is),
        }))} />
      </div>
      <div className="grid content-start gap-2">
        <H>{t("Theo người làm")} <span className="font-normal normal-case">{t("(số ticket sẵn sàng / tổng)")}</span></H>
        <Stack empty="" rows={who.map(({ p, rs }) => ({
          label: tMaybe(p), text: `${rs.filter((r) => shipped(r.s)).length}/${rs.length}`, on: () => list(tMaybe(p), rs.map((r) => r.i)),
          parts: BAR.map((s) => [rs.filter((r) => r.s === s).length, ST[s].bar] as [number, string]).filter(([x]) => x),
        }))} />
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">{BAR.filter((s) => n(s)).map((s) => <span key={s}><Dot c={ST[s].bar} />{t(ST[s].label)}</span>)}</p>
      </div>
    </div>
  );
}
