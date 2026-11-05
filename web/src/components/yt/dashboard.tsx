"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bug, CheckCheck, FlaskConical, Gauge, Hammer, Layers, type LucideIcon, RotateCcw, Target, TestTubes, Timer, Undo2, Users } from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNow } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { AI_MAX, byAs, bySp, DAY, dm, fmt, PCOL, QUICK, rank, shortName, shortSp, stateColor, type Ticket, type Verdict, verdicts, yt } from "@/lib/yt";
import { AGE, dashStats, reportData, type Stats } from "@/lib/yt-stats";
import { AiAsk, Card, CardAi, MultiSelect, Person, StatePill } from "./bits";
import { type Mode, useYt } from "./state";

// The bento dashboard, laid out per role (LAYOUT): what needs that role first, then its figures. Every number opens its tickets.

export function useStats() {
  const y = useYt();
  const agingSet = useMemo(() => new Set(y.agingStates), [y.agingStates]);
  const now = useNow();
  const d = useMemo(() => dashStats({
    rows: y.rows, f: y.filters, sprints: y.sprints, latestSprint: y.sprintOptions[0] ?? null, range: y.range,
    hist: y.config?.hist ?? 0, aging: agingSet, since: y.since, now,
  }), [y.rows, y.filters, y.sprints, y.sprintOptions, y.range, y.config?.hist, agingSet, y.since, now]);
  const { loadSince } = y;
  useEffect(() => { if (d.aging.need.length) loadSince(d.aging.need); }, [d.aging.need, loadSince]);
  return d;
}

/** Open the tickets behind a number. */
const useDrill = (d: Stats) => {
  const y = useYt();
  return (key: string, arg?: string) => { const r = d.detail(key, arg); if (r) y.setSheet({ kind: "list", title: r[0], rows: r[1] }); };
};

type Block = "attn" | "aging" | "kpis" | "progress" | "burn" | "vel" | "lead" | "wip" | "qcload" | "dist" | "thru" | "carry" | "bugsp" | "bugflow" | "bugusr" | "ready" | "mix" | "bugprio" | "bugmod" | "qckpi" | "qcdays" | "qcwho" | "qcdev" | "qcpong";
type Layout = [id: string, title: string, blocks: [Block, string][]][];
/** Each role reads the same numbers for a different job: Dev its own flow (the scope is "me"), QA quality and the QC queue,
 *  PO decisions, delivery forecast and load. Spans are literal classes (Tailwind sees them). */
const LAYOUT: Record<Mode, Layout> = {
  dev: [
    ["need", "Cần xử lý", [["attn", "lg:col-span-5"], ["aging", "lg:col-span-7"]]],
    ["sprint", "Sprint", [["kpis", ""], ["progress", "lg:col-span-6"], ["burn", "lg:col-span-6"]]],
    ["flow", "Nhịp làm việc", [["thru", "lg:col-span-6"], ["lead", "lg:col-span-6"], ["carry", ""]]],
    ["qc", "Kiểm thử", [["qckpi", ""], ["qcpong", "lg:col-span-6"], ["qcdays", "lg:col-span-6"]]],
    ["bug", "Bug", [["bugsp", "md:col-span-4"], ["bugflow", "md:col-span-8"]]],
  ],
  qa: [
    ["need", "Hàng đợi QC", [["attn", "lg:col-span-4"], ["qcload", "lg:col-span-4"], ["dist", "lg:col-span-4"], ["aging", ""]]],
    ["qc", "Kết quả kiểm thử", [["qckpi", ""], ["qcdays", "lg:col-span-8"], ["qcwho", "lg:col-span-4"], ["qcdev", "lg:col-span-6"], ["qcpong", "lg:col-span-6"]]],
    ["bug", "Chất lượng", [["bugsp", "md:col-span-4"], ["bugflow", "md:col-span-8"], ["bugprio", "lg:col-span-4"], ["bugmod", "lg:col-span-4"], ["mix", "lg:col-span-4"], ["bugusr", ""]]],
    ["sprint", "Sprint", [["kpis", ""], ["progress", "lg:col-span-6"], ["burn", "lg:col-span-6"]]],
  ],
  po: [
    ["need", "Cần quyết định", [["attn", "lg:col-span-5"], ["ready", "lg:col-span-7"], ["aging", ""]]],
    ["sprint", "Sprint", [["kpis", ""], ["progress", "lg:col-span-6"], ["burn", "lg:col-span-6"]]],
    ["speed", "Tốc độ & dự báo", [["vel", "lg:col-span-6"], ["lead", "lg:col-span-6"], ["thru", "lg:col-span-6"], ["carry", "lg:col-span-6"]]],
    ["load", "Tải việc", [["wip", "md:col-span-6 xl:col-span-4"], ["qcload", "md:col-span-6 xl:col-span-4"], ["dist", "xl:col-span-4"]]],
    ["bug", "Chất lượng", [["qckpi", ""], ["bugsp", "md:col-span-4"], ["bugflow", "md:col-span-8"], ["mix", "lg:col-span-6"], ["bugprio", "lg:col-span-6"]]],
  ],
};

export function DashboardPage() {
  const y = useYt();
  const d = useStats();
  const drill = useDrill(d);
  const B: Record<Block, (c: string) => React.ReactNode> = {
    attn: (c) => <Card title="Cần chú ý" meta="ticket đang mở" className={c}><Attention d={d} /></Card>,
    aging: (c) => <Card title={y.mode === "qa" ? "Chờ test quá lâu" : "Cảnh báo ticket kéo dài"} className={c}><Aging d={d} /></Card>,
    kpis: () => <Kpis d={d} />,
    progress: (c) => <Card title="Tiến độ sprint" meta="vạch dọc = thời gian đã qua" className={c}><Progress d={d} /></Card>,
    burn: (c) => <Card title="Burndown sprint" className={c}
      meta={<span className="flex gap-3"><Lg c="var(--color-hl)">thực tế</Lg><Lg c="var(--color-ink-3)" dash>lý tưởng</Lg><Lg c="var(--color-hl-2)" dash>dự báo</Lg></span>}><Burn d={d} /></Card>,
    vel: (c) => <Card title="Velocity" meta={d.vel.avg == null ? "" : `TB ${fmt(d.vel.avg)} ticket / sprint`} className={c}>
      <HBars rows={d.vel.rows.map((r) => ({ label: <>{shortSp(r.name)}{r.running && <span className="text-ink-3"> (đang chạy)</span>}</>, v: r.n, c: r.running ? "var(--color-ink-3)" : "var(--color-hl)", on: () => drill("vel", r.name) }))} empty="Chưa có sprint có ngày bắt đầu / kết thúc." />
    </Card>,
    lead: (c) => <Card title="Lead time" meta={`${fmt(d.lead.n)} ticket, ${d.days.length} ngày qua`} onMeta={() => drill("lead")} className={c}><Lead d={d} /></Card>,
    wip: (c) => <Card title="Công việc đang làm" className={c}
      meta={<label className="flex items-center gap-1">ngưỡng WIP <select value={y.wip} onChange={(e) => y.setWip(+e.target.value)} className="h-6 rounded border border-rule bg-cotton px-1">{[2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>}><Wip d={d} /></Card>,
    qcload: (c) => <Card title="Chờ QC theo người" className={c}>
      <HBars rows={d.qcLoad.map(([n, k]) => ({ label: n === "Chưa có QC" ? n : <Person name={n} />, v: k, c: n === "Chưa có QC" ? "var(--color-warn)" : "var(--color-hl)", on: () => drill("qcl", n) }))} empty="Không có ticket chờ QC." />
    </Card>,
    dist: (c) => <Card title="Ticket đang mở theo state" className={c}>
      <HBars rows={d.dist.map(([s, n]) => ({ label: s, v: n, c: stateColor(s), on: () => drill("dist", s) }))} empty="Không có ticket mở." />
    </Card>,
    thru: (c) => <Card title="Ticket xong mỗi ngày" className={c}
      meta={<select value={y.range} onChange={(e) => y.setRange(+e.target.value)} aria-label="Khoảng thời gian biểu đồ" className="h-6 rounded border border-rule bg-cotton px-1">{[7, 14, 30].map((n) => <option key={n} value={n}>{n} ngày</option>)}</select>}>
      <Columns days={d.days} series={[{ v: d.thru, c: "var(--color-hl)", on: (k) => drill("thru", String(k)) }]} /><BulkNote d={d} />
    </Card>,
    carry: (c) => <Card title="Ticket chuyển sprint nhiều lần" meta={`${fmt(d.carry.length)} ticket`} onMeta={() => drill("carry")} className={c}><Carry d={d} /></Card>,
    bugsp: (c) => <Card title="Bug trong sprint" className={c}>
      <button type="button" onClick={() => drill("bugs")} className="grid justify-items-start gap-2 text-left">
        <span className="flex items-baseline gap-2"><b className="font-mono text-3xl font-medium tabular-nums"><Count n={d.bug.sp} /></b><span className="text-sm text-ink-3">bug trong sprint</span></span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
          <Lg c="var(--color-error)">Đang mở <b>{fmt(d.bug.spOpen)}</b></Lg><Lg c="var(--color-ink-3)">Đã xong <b>{fmt(d.bug.sp - d.bug.spOpen)}</b></Lg>
          <span className="text-ink-3">Mở toàn project: {fmt(d.bug.open)}</span>
        </span>
      </button>
    </Card>,
    bugflow: (c) => <Card title="Bug mới và đã sửa" meta={<span className="flex gap-3"><Lg c="var(--color-error)">mới</Lg><Lg c="var(--color-ink-3)">đã sửa</Lg></span>} className={c}>
      <Columns days={d.days} series={[{ v: d.bugNew, c: "var(--color-error)", on: (k) => drill("bugnew", String(k)) }, { v: d.bugFix, c: "var(--color-ink-3)", on: (k) => drill("bugfix", String(k)) }]} />
    </Card>,
    bugusr: (c) => <Card title="Bug của user" meta={<span className="flex gap-3"><Lg c="var(--color-error)">mở</Lg><Lg c="var(--color-ink-3)">xong</Lg></span>} className={c}>
      <Stack rows={d.bug.spUser.map(([n, [o, x]]) => ({ label: n === "Chưa assign" ? n : <Person name={n} />, parts: [[o, "var(--color-error)"], [x, "var(--color-ink-3)"]], text: `${o}${x ? ` / ${x}` : ""}`, on: () => drill("bugu", n) }))} empty="Sprint này chưa có bug." />
    </Card>,
    ready: (c) => <Card title="Chưa sẵn sàng vào sprint" meta={`${fmt(d.ready.n)} ticket mở`} className={c}>
      <HBars max={d.ready.n} rows={d.ready.rows.map(([l, n]) => ({ label: l, v: n, c: n ? "var(--color-warn)" : "var(--color-ok)", on: () => drill("ready", l) }))} empty="" />
    </Card>,
    mix: (c) => <Card title="Bug so với Feature" meta="xong trong sprint" className={c}><Mix d={d} /></Card>,
    bugprio: (c) => <Card title="Bug đang mở theo priority" meta={`${fmt(d.bug.open)} bug`} className={c}>
      <HBars rows={[...d.bugPrio].sort((a, b) => rank({ priority: a[0] }) - rank({ priority: b[0] })).map(([p, n]) => ({ label: p, v: n, c: PCOL[p] || "var(--color-ink-3)", on: () => drill("bugp", p) }))} empty="Không có bug đang mở." />
    </Card>,
    qckpi: () => <QcKpis />,
    qcdays: (c) => <Card title="Kết quả test mỗi ngày" meta={<span className="flex gap-3"><Lg c="var(--color-ok)">pass</Lg><Lg c="var(--color-error)">trả lại</Lg></span>} className={c}><QcDays d={d} /></Card>,
    qcwho: (c) => <Card title="Theo người test" meta={<span className="flex gap-3"><Lg c="var(--color-ok)">pass</Lg><Lg c="var(--color-error)">trả lại</Lg></span>} className={c}><QcWho /></Card>,
    qcdev: (c) => <Card title="Bị trả lại theo dev" meta="lượt fail, theo assignee" className={c}><QcDev /></Card>,
    qcpong: (c) => <Card title="Trả lại nhiều lần / reopen" className={c}><QcPong /></Card>,
    bugmod: (c) => <Card title="Bug đang mở theo module" meta="tag đầu tiên trong tiêu đề" className={c}>
      <HBars rows={d.bugMod.slice(0, 10).map(([m, n]) => ({ label: m, v: n, c: "var(--color-error)", on: () => drill("bugm", m) }))} empty="Không có bug đang mở." />
    </Card>,
  };
  const qc = useQc();
  /** A chat about one report: opens empty, the first prompt sends the dashboard's figures (+ QC verdicts when read), then follow-ups. */
  const ask = (title: string) => y.setSheet({ kind: "work", title: `AI · ${title}`, ids: [], start: { label: `AI đang phân tích “${title}”`, ask: (q, sig) => yt.aiData("ask", {
    focusReport: title, role: y.mode, rangeDays: y.range, ...reportData(d, y.wip),
    qc: qc.q.data && { tests: qc.pass.length + qc.fail.length, ticketsTested: qc.tested, firstPass: qc.firstPass, returned: qc.fail.length, reopened: qc.reopen.length,
      byTester: Object.fromEntries(qc.who), returnedByDev: Object.fromEntries(qc.dev.map(([n, [, f]]) => [n, f])),
      pingPong: qc.pong.slice(0, AI_MAX).map(({ i, n, re }) => ({ id: i.id, summary: i.summary, returned: n, reopened: re })) },
  }, sig, `Về báo cáo “${title}” trên dashboard (nêu ID ticket khi có): ${q}`) } });
  const layout = LAYOUT[y.mode];
  return (
    <CardAi value={y.aiOn ? ask : null}>
    <div className="grid grid-cols-12 gap-3">
      <JumpNav items={layout.map(([id, title]) => [id, title])} onAi={y.aiOn ? () => ask("Tổng quan dashboard") : undefined} />
      {layout.map(([id, title, blocks]) => (
        <Fragment key={id}>
          <Section id={`yt-${id}`} title={title} />
          {blocks.map(([k, span]) => <Fragment key={k}>{B[k](cn("col-span-12", span))}</Fragment>)}
        </Fragment>
      ))}
    </div>
    </CardAi>
  );
}

/** QC verdicts over the chart range, limited to the tickets the current Sprint / Người filter shows (Dev: their own). */
export function useQc() {
  const y = useYt();
  const q = useQuery({
    queryKey: ["yt", "trans", y.project, y.range], queryFn: ({ signal }) => yt.transitions(y.project, y.range, signal),
    enabled: !!y.config && !y.config.mock, staleTime: 5 * 60_000,
  });
  const f = y.filters;
  const s = useMemo(() => {
    const as = byAs(f), sp = bySp(f);
    const byId = new Map(y.rows.filter((i) => as(i) && sp(i)).map((i) => [i.id, i]));
    const v = verdicts(q.data ?? []).filter((x) => byId.has(x.id));
    const of = (k: Verdict["kind"]) => v.filter((x) => x.kind === k);
    const pass = of("pass"), fail = of("fail"), reopen = of("reopen");
    const fails = new Map<string, number>();
    for (const x of fail) fails.set(x.id, (fails.get(x.id) || 0) + 1);
    const tested = new Set([...pass, ...fail].map((x) => x.id));
    const reopened = new Set(reopen.map((x) => x.id));
    const tickets = (list: Verdict[]) => [...new Set(list.map((x) => x.id))].map((id) => byId.get(id)!);
    const tally = (list: Verdict[], key: (x: Verdict) => string) => { const c = new Map<string, [number, number]>(); for (const x of list) (c.get(key(x)) ?? c.set(key(x), [0, 0]).get(key(x))!)[x.kind === "pass" ? 0 : 1]++; return [...c].sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]); };
    return {
      pass, fail, reopen, tested: tested.size, firstPass: [...tested].filter((id) => !fails.has(id)).length, tickets, byId,
      // tickets bounced twice or more, or reopened: the ones worth a look
      pong: [...new Set([...fails.keys(), ...reopened])].filter((id) => (fails.get(id) || 0) >= 2 || reopened.has(id))
        .map((id) => ({ i: byId.get(id)!, n: fails.get(id) || 0, re: reopened.has(id) })).sort((a, b) => b.n - a.n || +b.re - +a.re),
      who: tally([...pass, ...fail], (x) => x.by || "—"),
      dev: tally(fail, (x) => byId.get(x.id)!.assignee || "Chưa assign"),
    };
  }, [q.data, y.rows, f]);
  return { ...s, q };
}
const QcState = ({ q }: { q: ReturnType<typeof useQc>["q"] }) => {
  const y = useYt();
  return <p className="text-sm text-ink-3">{y.config?.mock ? "Cần token YouTrack để đọc lịch sử state." : y.configError ? "Chưa kết nối được YouTrack." : q.isError ? `Không đọc được lịch sử state: ${(q.error as Error).message}` : "Đang đọc lịch sử state…"}</p>;
};
const useList = () => { const y = useYt(); return (title: string, rows: Ticket[]) => y.setSheet({ kind: "list", title, rows }); };

const QC_ICON = [TestTubes, CheckCheck, Undo2, RotateCcw];
function QcKpis() {
  const y = useYt();
  const s = useQc();
  const list = useList();
  const pc = (a: number, b: number) => (b ? Math.round(a / b * 100) : null);
  const tiles: [string, number | null, string, string, () => void][] = [
    ["Lượt test", s.pass.length + s.fail.length, "", `${s.tested} ticket, ${y.range} ngày qua`, () => list("Ticket đã test", s.tickets([...s.pass, ...s.fail]))],
    ["Pass ngay lần đầu", pc(s.firstPass, s.tested), "%", `${s.firstPass}/${s.tested} ticket không bị trả lại`, () => list("Pass không bị trả lại", s.tickets(s.pass).filter((i) => !s.fail.some((x) => x.id === i.id)))],
    ["Bị trả lại", s.fail.length, "", `lượt QC chuyển về dev · ${pc(s.fail.length, s.pass.length + s.fail.length) ?? 0}%`, () => list("Bị QC trả lại", s.tickets(s.fail))],
    ["Reopen", s.reopen.length, "", "đã xong rồi mở lại", () => list("Ticket reopen", s.tickets(s.reopen))],
  ];
  if (!s.q.data) return <div className="col-span-12 rounded-[var(--radius-card)] bg-cotton p-4 shadow-stock"><QcState q={s.q} /></div>;
  return (
    <div className="col-span-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(([l, v, suf, sub, on], k) => (
        <Tile key={l} label={l} icon={QC_ICON[k]} value={v} suffix={suf} bad={k >= 2 && !!v} onClick={on}><span className="text-xs text-ink-3">{sub}</span></Tile>
      ))}
    </div>
  );
}

function QcDays({ d }: { d: Stats }) {
  const s = useQc();
  const list = useList();
  if (!s.q.data) return <QcState q={s.q} />;
  const day = (l: Verdict[]) => d.days.map((t) => l.filter((x) => x.at >= t && x.at < t + DAY));
  const p = day(s.pass), f = day(s.fail), dl = (k: number) => new Date(d.days[k]).toLocaleDateString("vi-VN");
  return <Columns days={d.days} series={[
    { v: p.map((x) => x.length), c: "var(--color-ok)", on: (k) => list(`Pass ngày ${dl(k)}`, s.tickets(p[k])) },
    { v: f.map((x) => x.length), c: "var(--color-error)", on: (k) => list(`Trả lại ngày ${dl(k)}`, s.tickets(f[k])) },
  ]} />;
}

function QcWho() {
  const s = useQc();
  const list = useList();
  if (!s.q.data) return <QcState q={s.q} />;
  return <Stack rows={s.who.map(([n, [p, f]]) => ({ label: n === "—" ? n : <Person name={n} />, parts: [[p, "var(--color-ok)"], [f, "var(--color-error)"]], text: `${p} / ${f}`,
    on: () => list(`Đã test · ${n}`, s.tickets([...s.pass, ...s.fail].filter((x) => (x.by || "—") === n))) }))} empty="Chưa có lượt test nào." />;
}

function QcDev() {
  const s = useQc();
  const list = useList();
  if (!s.q.data) return <QcState q={s.q} />;
  return <HBars rows={s.dev.map(([n, [, f]]) => ({ label: n === "Chưa assign" ? n : <Person name={n} />, v: f, c: "var(--color-error)",
    on: () => list(`Bị trả lại · ${n}`, s.tickets(s.fail.filter((x) => (s.byId.get(x.id)!.assignee || "Chưa assign") === n))) }))} empty="Chưa có ticket nào bị trả lại." />;
}

function QcPong() {
  const s = useQc();
  const list = useList();
  if (!s.q.data) return <QcState q={s.q} />;
  const SHOW = 8;
  return <TicketRows rows={s.pong.slice(0, SHOW).map(({ i, n, re }) => ({ i, right: <span className={cn("font-mono text-xs whitespace-nowrap", n >= 3 || re ? "font-semibold text-error" : "text-warn")}>{[n ? `${n} lần trả lại` : "", re ? "reopen" : ""].filter(Boolean).join(" · ")}</span> }))}
    all={s.pong.map((x) => x.i)} more={s.pong.length > SHOW ? () => list("Trả lại nhiều lần / reopen", s.pong.map((x) => x.i)) : undefined} moreN={s.pong.length - SHOW}
    empty="Không có ticket nào bị trả lại từ 2 lần hay reopen." />;
}

const SECTION_ICON: Record<string, LucideIcon> = { need: AlertTriangle, sprint: Timer, flow: Activity, qc: FlaskConical, bug: Bug, speed: Gauge, load: Users };
const Section = ({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) => {
  const Icon = SECTION_ICON[id.slice(3)] ?? Layers;
  return (
    <div id={id} className="col-span-12 mt-4 flex scroll-mt-[calc(var(--yt-top)+3rem)] flex-wrap items-center gap-2.5 first:mt-0">
      <span className="grid size-7 place-items-center rounded-lg bg-hl-wash text-hl-2"><Icon className="size-4" aria-hidden /></span>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-rule to-transparent" />
      {children && <div className="flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
};
/** The dashboard is long: a sticky row of its sections (the one on screen lit), a click scrolls there; the whole-dashboard AI at the end. */
function JumpNav({ items, onAi }: { items: [string, string][]; onAi?: () => void }) {
  const [on, setOn] = useState(items[0]?.[0]);
  const ids = items.map(([k]) => k).join(",");
  useEffect(() => {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) setOn(e.target.id.slice(3)); }, { rootMargin: "-25% 0px -65% 0px" });
    for (const k of ids.split(",")) { const el = document.getElementById(`yt-${k}`); if (el) io.observe(el); }
    return () => io.disconnect();
  }, [ids]);
  const go = (k: string) => {
    setOn(k);
    document.getElementById(`yt-${k}`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return (
    <nav aria-label="Mục dashboard" className="yt-noprint sticky top-(--yt-top) z-10 col-span-12 -mx-1 flex items-center gap-1 bg-paper/90 px-1 py-1.5 backdrop-blur">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {items.map(([k, l]) => {
          const Icon = SECTION_ICON[k] ?? Layers, cur = on === k;
          return (
            <button key={k} type="button" aria-current={cur ? "location" : undefined} onClick={() => go(k)}
              className={cn("relative flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-(--dur-micro)", cur ? "text-hl-ink" : "text-ink-2 hover:bg-paper-3 hover:text-ink")}>
              {cur && <motion.span layoutId="yt-jump" className="absolute inset-0 rounded-full bg-hl shadow-stock" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <Icon className="relative size-3.5" aria-hidden /><span className="relative">{l}</span>
            </button>
          );
        })}
      </div>
      {onAi && <AiAsk big label="Hỏi AI về toàn bộ dashboard" hint="Hỏi mình về cả dashboard nhé!" onClick={onAi} />}
    </nav>
  );
}

/** A KPI tile: label + icon, a big counting number, a sub line; a click lists its tickets. */
function Tile({ label, icon: Icon, value, suffix = "", bad, onClick, children }: { label: string; icon: LucideIcon; value: number | null; suffix?: string; bad?: boolean; onClick: () => void; children?: React.ReactNode }) {
  return (
    <motion.button type="button" onClick={onClick} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} title="Xem danh sách ticket"
      initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className="yt-card group relative grid content-start justify-items-start gap-1 overflow-hidden rounded-[var(--radius-card)] bg-cotton p-4 text-left shadow-stock transition-shadow duration-(--dur-short) hover:shadow-pop">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-(--dur-short) group-hover:scale-x-100", bad ? "bg-error" : "bg-hl")} />
      <span className="flex w-full items-center justify-between gap-2 text-xs text-ink-3">{label}
        <span className={cn("grid size-7 place-items-center rounded-lg", bad ? "bg-error-wash text-error" : "bg-hl-wash text-hl-2")}><Icon className="size-4" aria-hidden /></span>
      </span>
      <b className={cn("font-mono text-3xl font-medium tabular-nums", bad && "text-error")}><Count n={value} suffix={suffix} /></b>
      {children}
    </motion.button>
  );
}

const Lg = ({ c, dash, children }: { c: string; dash?: boolean; children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1"><u className={cn("inline-block h-0.5 w-3 no-underline", dash && "bg-[length:4px_2px] bg-repeat-x")}
    style={dash ? { backgroundImage: `linear-gradient(90deg, ${c} 50%, transparent 50%)` } : { background: c }} />{children}</span>
);

/** Counts from the previous value to the new one. */
function Count({ n, suffix = "" }: { n: number | null; suffix?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => fmt(Math.round(v)) + suffix);
  useEffect(() => { if (n != null) { const c = animate(mv, n, { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }); return () => c.stop(); } }, [n, mv]);
  return n == null ? <>—</> : <motion.span>{text}</motion.span>;
}

const SEV = { bad: 0, warn: 1 };
/** What each role must act on: QUICK keys with how bad a non-zero count is. */
const ATTN: Record<Mode, [string, keyof typeof SEV][]> = {
  dev: [["blocked", "bad"], ["overdue", "bad"], ["critical", "bad"], ["noest", "warn"]],
  qa: [["bugcrit", "bad"], ["noqc", "warn"], ["blocked", "bad"], ["bugnew", "warn"], ["stale", "warn"]],
  po: [["waitpo", "bad"], ["critical", "bad"], ["overdue", "bad"], ["blocked", "bad"], ["unassigned", "warn"], ["noest", "warn"], ["stale", "warn"]],
};
function Attention({ d }: { d: Stats }) {
  const y = useYt();
  const drill = useDrill(d);
  const est = y.rows.some((i) => i.estimate != null); // a team that never estimates: "chưa estimate" is noise
  const ranked = ATTN[y.mode].filter(([q]) => q !== "noest" || est).map(([q, sev]) => ({ q, sev, n: d.detail("q", q)?.[1].length ?? 0 })).sort((a, b) => +!a.n - +!b.n || SEV[a.sev] - SEV[b.sev] || b.n - a.n);
  return (
    <div className="grid gap-1.5">
      {ranked.map(({ q, sev, n }) => (
        <motion.button layout key={q} type="button" onClick={() => drill("q", q)} title="Xem danh sách ticket"
          className={cn("flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors duration-(--dur-micro)",
            !n ? "bg-paper-2 text-ink-3" : sev === "bad" ? "bg-error-wash text-error hover:bg-error-wash/70" : "bg-warn-wash text-warn hover:bg-warn-wash/70")}>
          <span className={cn(n && "font-medium")}>{QUICK[q].label}</span><b className="font-mono tabular-nums">{fmt(n)}</b>
        </motion.button>
      ))}
    </div>
  );
}

function Aging({ d }: { d: Stats }) {
  const y = useYt();
  const drill = useDrill(d);
  const { rows, need, states } = d.aging, bad = rows.filter((x) => x.d > AGE.bad).length, SHOW = 8;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect label="State" all="Chọn state" search={false} options={states.map(([s]) => s)} value={y.agingStates} onChange={y.setAgingStates} />
        <button type="button" onClick={() => drill("aging")} className="flex gap-1.5 text-xs">
          <span className="rounded-full bg-error-wash px-2 py-0.5 font-medium text-error">{bad} đỏ</span>
          <span className="rounded-full bg-warn-wash px-2 py-0.5 font-medium text-warn">{rows.length - bad} vàng</span>
        </button>
        <span className="text-xs text-ink-3">Ở cùng state từ {AGE.warn} ngày: vàng, quá {AGE.bad} ngày: đỏ</span>
      </div>
      <TicketRows rows={rows.slice(0, SHOW).map(({ i, d: age }) => ({ i, right: <Age days={age} /> }))} all={rows.map((r) => r.i)}
        more={rows.length > SHOW ? () => drill("aging") : undefined} moreN={rows.length - SHOW}
        empty={need.length && y.sinceBusy ? "Đang tải thời gian đổi state…" : "Không có ticket nào ở state này quá ngưỡng."} />
    </div>
  );
}
const Age = ({ days }: { days: number }) => {
  const bad = days > AGE.bad;
  return <span className={cn("inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap", bad ? "font-semibold text-error" : "text-warn")}>{bad && <AlertTriangle className="size-3" />}{days.toFixed(1)} ngày</span>;
};

/** Compact ticket rows (aging, carry-over): id + who, state, a right-hand figure. */
function TicketRows({ rows, all, empty, more, moreN }: { rows: { i: Ticket; right: React.ReactNode }[]; all: Ticket[]; empty: string; more?: () => void; moreN?: number }) {
  const y = useYt();
  if (!rows.length) return <p className="text-sm text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-rule">
      {rows.map(({ i, right }) => (
        <li key={i.id}>
          <button type="button" onClick={() => y.openTicket(i.id, all)} className="grid w-full grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-left hover:bg-paper-2">
            <span className="grid"><b className="font-mono text-xs">{i.id}</b><span className="truncate text-xs text-ink-2">{i.assignee ? shortName(i.assignee) : "Chưa assign"}</span></span>
            <span className="min-w-0 truncate"><StatePill state={i.state} /></span>
            {right}
          </button>
        </li>
      ))}
      {more && <li><button type="button" onClick={more} className="w-full py-1.5 text-left text-xs text-ink-3 hover:text-ink">… và {moreN} ticket nữa, xem tất cả</button></li>}
    </ul>
  );
}

const KPI_ICON = [Layers, Hammer, FlaskConical, Target];
function Kpis({ d }: { d: Stats }) {
  const drill = useDrill(d);
  const delta = d.per.prev && d.prevTotal ? Math.round((d.total - d.prevTotal) / d.prevTotal * 100) : null;
  const cards: [string, number | null, string, string, React.ReactNode?][] = [
    ["Ticket trong sprint", d.total, "", "total", <span key="s" className="flex flex-wrap gap-x-2 text-xs text-ink-3"><span>{d.per.label}</span>
      {d.per.prev && <span>trước: {shortSp(d.per.prev)} ({fmt(d.prevTotal)})</span>}{delta != null && <span>{delta > 0 ? "+" : delta < 0 ? "−" : ""}{Math.abs(delta)}%</span>}</span>],
    // doing / QC count every open ticket in the filter, not only this sprint's: say so, or they read as parts of the total
    ["Đang làm", d.doing, "", "doing", <span key="d" className="text-xs text-ink-3">mọi ticket đang mở</span>],
    ["Chờ QC", d.qc, "", "qc", <span key="q" className="text-xs text-ink-3">mọi ticket đang mở</span>],
    ["Tỉ lệ xong sprint", d.doneRate, "%", "rate", <span key="r" className="text-xs text-ink-3">{d.per.label}</span>],
  ];
  return (
    <div className="col-span-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(([l, v, s, k, extra], j) => (
        <Tile key={k} label={l} icon={KPI_ICON[j]} value={v} suffix={s} onClick={() => drill(k)}>{extra}</Tile>
      ))}
    </div>
  );
}

function Progress({ d }: { d: Stats }) {
  const drill = useDrill(d);
  if (!d.prog.length) return <p className="text-sm text-ink-3">Không có dữ liệu sprint</p>;
  return (
    <div className="grid gap-4">
      {d.prog.map((r) => {
        const p = r.t ? Math.round(r.d / r.t * 100) : 0, w = (n: number) => (r.t ? n / r.t * 100 : 0);
        const diff = r.time == null ? null : p - r.time;
        const st = p === 100 && r.t ? ["ok", "Hoàn thành"] : diff == null ? null : diff >= 0 ? ["ok", "Đúng tiến độ"] : diff > -15 ? ["warn", "Hơi chậm"] : ["bad", "Chậm tiến độ"];
        return (
          <button key={r.name} type="button" onClick={() => drill("sp", r.name)} className="grid gap-1.5 text-left" title="Xem danh sách ticket của sprint này">
            <span className="flex justify-between text-sm"><span className="font-medium">{r.name}</span><span className="font-mono text-xs text-ink-2 tabular-nums">{r.d}/{r.t} · {p}%</span></span>
            <span className="relative flex h-2.5 overflow-hidden rounded-full bg-paper-3">
              {[[r.d, "var(--color-ok)"], [r.qc, "var(--st-qc)"], [r.doing, "var(--st-doing)"]].map(([n, c], k) => (
                <motion.i key={k} className="h-full" style={{ background: c as string }} initial={{ width: 0 }} animate={{ width: `${w(n as number)}%` }} transition={{ duration: 0.5, delay: k * 0.05 }} />
              ))}
              {r.time != null && <u className="absolute inset-y-[-2px] w-0.5 bg-ink" style={{ left: `${r.time}%` }} title={`Thời gian sprint đã qua ${r.time}%`} />}
            </span>
            <span className="flex flex-wrap justify-between gap-2 text-xs text-ink-3">
              <span className="flex flex-wrap gap-x-3"><Lg c="var(--color-ok)">Xong {r.d}</Lg><Lg c="var(--st-qc)">QC {r.qc}</Lg><Lg c="var(--st-doing)">Đang làm {r.doing}</Lg><Lg c="var(--color-rule-2)">Todo {r.todo}</Lg></span>
              <span className="flex gap-2">
                {r.left != null && <span>{r.left ? `còn ${r.left} ngày` : "đã kết thúc"}</span>}
                {st && <span className={cn("rounded-full px-2 font-medium", st[0] === "ok" ? "bg-ok-wash text-ok" : st[0] === "warn" ? "bg-warn-wash text-warn" : "bg-error-wash text-error")}>{st[1]}</span>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Burn({ d }: { d: Stats }) {
  const b = d.burn;
  if (!b) return <p className="text-sm text-ink-3">Chưa có ticket hoặc ngày bắt đầu/kết thúc của sprint.</p>;
  const W = 600, H = 200, L = 30, R = 10, T = 12, B = 24;
  const x = (k: number) => L + (W - L - R) * (b.n > 1 ? k / (b.n - 1) : 0), yv = (v: number) => T + (H - T - B) * (1 - v / b.total);
  const last = b.actual.length - 1, end = b.n - 1, left = last >= 0 ? b.actual[last] : 0, pk = b.proj == null ? null : Math.min(b.proj, end);
  const pts = b.actual.map((v, k) => `${x(k).toFixed(1)},${yv(v).toFixed(1)}`).join(" ");
  const note = last < 0 || !left ? (left === 0 && last >= 0 ? <span><b>Đã xong hết</b> ticket của sprint</span> : null)
    : b.proj == null ? <span>Chưa đóng được ticket nào, <b>chưa dự báo được</b></span>
    : b.proj <= end ? <span>Dự báo xong: <b>{dm(b.start + Math.ceil(b.proj) * 864e5)}</b>, kịp sprint</span>
    : <span>Cuối sprint dự kiến còn <b>~{Math.round(left - b.rate * (end - last))} ticket</b></span>;
  return (
    <div className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Burndown: còn ${left} / ${b.total} ticket`} className="w-full text-xs">
        <g stroke="var(--color-rule)"><line x1={L} x2={W - R} y1={yv(0)} y2={yv(0)} /><line x1={L} x2={L} y1={T} y2={yv(0)} /></g>
        <g fill="var(--color-ink-3)">
          <text x={L - 4} y={T + 4} textAnchor="end">{b.total}</text><text x={L - 4} y={yv(0) + 4} textAnchor="end">0</text>
          <text x={L} y={H - 6}>{dm(b.start)}</text><text x={W - R} y={H - 6} textAnchor="end">{dm(b.start + end * 864e5)}</text>
        </g>
        <line x1={x(0)} y1={yv(b.total)} x2={x(end)} y2={yv(0)} stroke="var(--color-ink-3)" strokeDasharray="4 4" />
        {pk != null && last >= 0 && last < end && left > 0 && <line x1={x(last)} y1={yv(left)} x2={x(pk)} y2={yv(Math.max(0, left - b.rate * (pk - last)))} stroke="var(--color-hl-2)" strokeDasharray="4 4" strokeWidth={2} />}
        {last >= 0 && <>
          <motion.polyline points={pts} fill="none" stroke="var(--color-hl)" strokeWidth={2.5} strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
          <circle cx={x(last)} cy={yv(left)} r={4} fill="var(--color-hl)" />
          <text x={x(last)} y={yv(left) - 8} textAnchor="middle" fill="var(--color-ink)">{left}</text>
        </>}
      </svg>
      <div className="flex flex-wrap gap-x-4 text-xs text-ink-2">{note}{b.added > 0 && <span>+<b>{b.added}</b> ticket thêm sau khi sprint bắt đầu</span>}</div>
    </div>
  );
}

function Columns({ days, series }: { days: number[]; series: { v: number[]; c: string; on: (k: number) => void }[] }) {
  const W = 600, H = 170, L = 6, B = 22, T = 16, max = Math.max(1, ...series.flatMap((s) => s.v)), gw = (W - L * 2) / days.length, bw = gw * 0.7 / series.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" className="w-full text-xs">
      <line x1={L} x2={W - L} y1={H - B} y2={H - B} stroke="var(--color-rule)" />
      {days.map((t, k) => (
        <g key={t}>
          {series.map((s, si) => {
            const v = s.v[k], h = (H - B - T) * v / max, xx = L + k * gw + gw * 0.15 + si * bw;
            return v ? (
              <g key={si} className="cursor-pointer" onClick={() => s.on(k)}>
                <motion.rect x={xx} width={bw - 1} rx={2} fill={s.c} initial={{ y: H - B, height: 0 }} animate={{ y: H - B - h, height: h }} transition={{ duration: 0.4, delay: k * 0.01 }} className="hover:opacity-80" />
                <text x={xx + bw / 2} y={H - B - h - 3} textAnchor="middle" fill="var(--color-ink-2)">{v}</text>
              </g>
            ) : null;
          })}
          <text x={L + k * gw + gw / 2} y={H - 6} textAnchor="middle" fill="var(--color-ink-3)">{new Date(t).getDate()}</text>
        </g>
      ))}
    </svg>
  );
}

type Bar = { label: React.ReactNode; v: number; c: string; on: () => void };
function HBars({ rows, empty, max }: { rows: Bar[]; empty: string; max?: number }) {
  const m = max ?? Math.max(0, ...rows.map((r) => r.v));
  return <Stack rows={rows.map((r) => ({ label: r.label, parts: [[r.v, r.c]], text: String(r.v), on: r.on }))} max={m} empty={empty} />;
}
function Stack({ rows, empty, max }: { rows: { label: React.ReactNode; parts: [number, string][]; text: string; on: () => void }[]; empty: string; max?: number }) {
  const m = Math.max(1, max ?? Math.max(0, ...rows.map((r) => r.parts.reduce((s, [n]) => s + n, 0))));
  if (!rows.length) return empty ? <p className="text-sm text-ink-3">{empty}</p> : null;
  return (
    <div className="grid gap-1">
      {rows.map((r, k) => (
        <button key={k} type="button" onClick={r.on} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2.5rem] items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-paper-2">
          <span className="min-w-0 truncate">{r.label}</span>
          <span className="flex h-2 overflow-hidden rounded-full bg-paper-3">
            {r.parts.map(([n, c], j) => <motion.i key={j} className="h-full" style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${n / m * 100}%` }} transition={{ duration: 0.45 }} />)}
          </span>
          <em className="text-right font-mono text-xs text-ink-2 not-italic tabular-nums">{r.text}</em>
        </button>
      ))}
    </div>
  );
}

const ddays = (n: number | null) => (n == null ? "—" : n < 1 ? "< 1 ngày" : `${n.toFixed(n < 10 ? 1 : 0)} ngày`);
const KIND: Record<string, [string, string]> = { bug: ["Bug", "var(--color-error)"], feat: ["Feature", "var(--st-dev)"], task: ["Task khác", "var(--color-ink-3)"] };
function Lead({ d }: { d: Stats }) {
  const drill = useDrill(d);
  const l = d.lead;
  if (!l.n) return <><p className="text-sm text-ink-3">Chưa có ticket xong trong khoảng này.</p><BulkNote d={d} /></>;
  const max = Math.max(0, ...l.kinds.map((k) => k[1] || 0));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-6"><span><b className="font-mono text-2xl font-medium tabular-nums">{ddays(l.med)}</b><span className="text-sm text-ink-3"> trung vị</span></span>
        <span className="text-sm text-ink-3">85% xong trong <b className="font-mono text-base text-ink">{ddays(l.p85)}</b></span></div>
      <Stack max={max} empty="" rows={l.kinds.filter((k) => k[2]).map(([k, m, n]) => ({ label: <>{KIND[k][0]} <span className="text-ink-3">({n})</span></>, parts: [[m ?? 0, KIND[k][1]]], text: ddays(m), on: () => drill("lead") }))} />
      <BulkNote d={d} />
    </div>
  );
}
const BulkNote = ({ d }: { d: Stats }) => (d.bulk.length ? <p className="text-xs text-ink-3">Bỏ qua {d.bulk.map(([t, n]) => `${fmt(n)} ticket đóng hàng loạt ngày ${dm(t)}`).join(", ")}</p> : null);

function Wip({ d }: { d: Stats }) {
  const y = useYt();
  const drill = useDrill(d);
  if (!d.wip.length) return <p className="text-sm text-ink-3">Không có ticket đang làm.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-ink-3"><tr><th className="py-1 font-medium">Người</th><th className="font-medium">Đang làm</th><th className="font-medium">Blocked</th></tr></thead>
      <tbody>
        {d.wip.map(([p, [n, b]]) => (
          <tr key={p} tabIndex={0} onClick={() => drill("wip", p)} onKeyDown={(e) => { if (e.key === "Enter") drill("wip", p); }} className="cursor-pointer border-t border-rule hover:bg-paper-2">
            <td className="py-1.5">{p === "Chưa assign" ? p : <Person name={p} />}</td>
            <td><span className={cn("inline-flex items-center gap-1 font-mono", n > y.wip && "font-semibold text-error")}>{n}{n > y.wip && <span className="inline-flex items-center gap-0.5 font-sans text-xs"><AlertTriangle className="size-3" />vượt ngưỡng</span>}</span></td>
            <td>{b ? <span className="font-mono font-semibold text-error">{b}</span> : <span className="font-mono text-ink-3">0</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Carry({ d }: { d: Stats }) {
  const drill = useDrill(d);
  return (
    <TicketRows rows={d.carry.slice(0, 8).map((i) => ({ i, right: <span className={cn("inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap", i.sprints.length > 2 ? "font-semibold text-error" : "text-warn")}>{i.sprints.length > 2 && <AlertTriangle className="size-3" />}{i.sprints.length} sprints</span> }))}
      all={d.carry} more={d.carry.length > 8 ? () => drill("carry") : undefined} moreN={d.carry.length - 8} empty="Không có ticket nào bị chuyển sprint nhiều lần." />
  );
}

function Mix({ d }: { d: Stats }) {
  const drill = useDrill(d);
  const { mix: mx, mixPrev: mp } = d;
  if (!mx.n) return <p className="text-sm text-ink-3">Chưa có ticket xong trong sprint.</p>;
  const pc = (v: number) => Math.round(v / mx.n * 100);
  const prevBug = mp.n ? mp.m.bug / mp.n : 0, bugDelta = prevBug ? Math.round((mx.m.bug / mx.n - prevBug) / prevBug * 100) : null;
  return (
    <div className="grid gap-3">
      <div className="flex h-3 overflow-hidden rounded-full">
        {(["bug", "feat", "task"] as const).map((k) => <motion.i key={k} className="h-full" style={{ background: KIND[k][1] }} initial={{ width: 0 }} animate={{ width: `${pc(mx.m[k])}%` }} transition={{ duration: 0.5 }} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(["bug", "feat", "task"] as const).map((k) => (
          <button key={k} type="button" onClick={() => drill("mix", k)} className="hover:text-hl-2">
            <Lg c={KIND[k][1]}>{KIND[k][0]} <b>{fmt(mx.m[k])}</b> <span className="text-ink-3">{pc(mx.m[k])}%</span>
              {k === "bug" && bugDelta != null && <small className={cn("ml-1", bugDelta > 0 ? "text-error" : "text-ok")}>{bugDelta > 0 ? "+" : "−"}{Math.abs(bugDelta)}%</small>}</Lg>
          </button>
        ))}
      </div>
    </div>
  );
}

export { Attention, Aging, Kpis, Progress, Wip };
