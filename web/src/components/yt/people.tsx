"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { AiPromptBox } from "@/components/ai/chat";
import { fold, useNow } from "@/lib/inbox";
import { getPref, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AI_MAX, bucket, DAY, isBlocked, shortName, type Ticket, UNASSIGNED, when, yt } from "@/lib/yt";
import { useAiWait } from "@/components/ai/fetching";
import { Avatar, Card, Prio, StatePill, YtFetching, YtPicks } from "./bits";
import { useYt } from "./state";

// Members: a rail with everyone's load, the team side by side, or one person (figures, tickets, an AI on your own prompt).

const PRESETS = [
  ["Tóm tắt công việc", "Đang làm gì, đã xong gì, việc tiếp theo, chỗ đang kẹt.", (n: string, d: number) => `Tóm tắt công việc của ${n} trong ${d} ngày qua: đang làm gì, đã xong gì, việc tiếp theo, chỗ đang kẹt hoặc chờ người khác.`],
  ["Review", "Chất lượng ticket, tiến độ so với hạn, rủi ro; đề xuất theo ID.", (n: string) => `Review công việc của ${n}: chất lượng ticket (mô tả, bình luận cập nhật tiến độ), tiến độ so với hạn và sprint, ticket kéo dài hoặc chuyển sprint nhiều lần, rủi ro. Đề xuất cụ thể theo ID.`],
  ["Đánh giá", "Khối lượng, tốc độ, độ ổn định; điểm mạnh và cần cải thiện.", (n: string, d: number) => `Đánh giá công việc của ${n} trong ${d} ngày qua: khối lượng, tốc độ (lead time), độ ổn định (bug, ticket mở lại), mức độ cập nhật trên ticket. Nêu điểm mạnh, điểm cần cải thiện, mỗi ý kèm căn cứ.`],
  ["Chuẩn bị 1-1", "Gợi ý nội dung buổi 1-1 với người này.", (n: string) => `Gợi ý nội dung buổi 1-1 với ${n}: việc đáng ghi nhận, vấn đề cần hỏi, chỗ có thể cần hỗ trợ, mục tiêu cho tuần tới.`],
] as const;
const TEAM = "__team__";
const PERIODS = [7, 14, 30, 60, 90];
const SCOPES = [{ value: "open", label: "Đang mở" }, { value: "done", label: "Đã xong" }, { value: "both", label: "Cả hai" }] as const;
type Scope = (typeof SCOPES)[number]["value"];

type Stats = ReturnType<typeof statsOf>;
/** One person's tickets cut every way the views need; `risk` = blocked or overdue, `attn` = anything that needs a look. */
function statsOf(mine: Ticket[], days: number, now: number) {
  const from = now - days * DAY;
  const open = mine.filter((i) => !i.resolved), done = mine.filter((i) => i.resolved && i.resolved >= from);
  const lead = done.map((i) => (i.resolved! - i.created) / DAY).sort((a, b) => a - b);
  const blocked = open.filter(isBlocked), overdue = open.filter((i) => i.due && i.due < now), stale = open.filter((i) => now - i.updated > 7 * DAY);
  return {
    open, done, blocked, overdue, stale,
    doing: open.filter((i) => bucket(i) === 1), qc: open.filter((i) => bucket(i) === 2), moved: open.filter((i) => i.sprints.length >= 2),
    risk: open.filter((i) => isBlocked(i) || (i.due && i.due < now)), attn: open.filter((i) => reasons(i, now).length),
    bugs: open.filter((i) => i.type === "Bug"), fixed: done.filter((i) => i.type === "Bug"),
    lead: lead.length ? +lead[Math.floor(lead.length / 2)].toFixed(1) : null,
  };
}

/** Why an open ticket needs a look, as short tags (bad = red, warn = amber). */
function reasons(i: Ticket, now: number): [string, "bad" | "warn"][] {
  if (i.resolved) return [];
  const r: [string, "bad" | "warn"][] = [];
  if (isBlocked(i)) r.push(["Blocked", "bad"]);
  if (i.due && i.due < now) r.push([`Quá hạn ${Math.ceil((now - i.due) / DAY)} ngày`, "bad"]);
  if (now - i.updated > 7 * DAY) r.push([`Im ${Math.floor((now - i.updated) / DAY)} ngày`, "warn"]);
  if (i.sprints.length >= 2) r.push([`${i.sprints.length} sprint`, "warn"]);
  return r;
}

const Tag = ({ tone, children }: { tone: "bad" | "warn"; children: React.ReactNode }) => (
  <span className={cn("rounded-[4px] px-1.5 text-xs leading-[18px] font-medium whitespace-nowrap", tone === "bad" ? "bg-error-wash text-error" : "bg-warn-wash text-warn")}>{children}</span>
);

/** Open tickets as one bar: doing, waiting QC, the rest; `max` scales it against the busiest person. */
function Load({ s, max, className }: { s: Stats; max: number; className?: string }) {
  const n = s.open.length, rest = n - s.doing.length - s.qc.length;
  return (
    <span className={cn("flex h-2 rounded-full bg-paper-3", className)} aria-label={`${n} mở: ${s.doing.length} đang làm, ${s.qc.length} chờ QC`}>
      <span className="flex overflow-hidden rounded-full" style={{ width: `${n ? Math.max(6, (n / max) * 100) : 0}%` }}>
        {s.doing.length > 0 && <i className="bg-hl" style={{ flex: s.doing.length }} />}
        {s.qc.length > 0 && <i className="bg-info" style={{ flex: s.qc.length }} />}
        {rest > 0 && <i className="bg-rule-2" style={{ flex: rest }} />}
      </span>
    </span>
  );
}
const Legend = () => (
  <span className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
    {[["bg-hl", "Đang làm"], ["bg-info", "Chờ QC"], ["bg-rule-2", "Mở khác"]].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><i className={cn("size-2 rounded-full", c)} />{l}</span>)}
  </span>
);

function Kpi({ label, value, sub, bad }: { label: string; value: React.ReactNode; sub?: React.ReactNode; bad?: boolean }) {
  return (
    <div className="grid content-start gap-0.5 rounded-[var(--radius-card)] bg-cotton px-4 py-3 shadow-stock">
      <span className="text-xs text-ink-3">{label}</span>
      <b className={cn("font-mono text-2xl font-medium tabular-nums", bad && "text-error")}>{value}</b>
      {sub && <span className="text-xs text-ink-3">{sub}</span>}
    </div>
  );
}

const Period = ({ days, setDays }: { days: number; setDays: (d: number) => void }) => (
  <div className="max-w-full overflow-x-auto"><Segmented id="people-period" label="Kỳ" value={days} onChange={setDays} items={PERIODS.map((d) => ({ value: d, label: `${d} ngày` }))} /></div>
);

export function PeoplePage() {
  const y = useYt();
  const now = useNow();
  // only the people of the header scope (My task / My team / Group / a Người pick); none picked = everyone
  const pickd = y.filters.assignee;
  const names = useMemo(() => y.peopleOptions.filter((n) => n !== UNASSIGNED && (!pickd.length || pickd.includes(n))), [y.peopleOptions, pickd]);
  const [who, setWho] = useState(() => getPref("ytPerson") || y.me || "");
  const [days, setDaysState] = useState(() => Number(getPref("ytPeopleDays")) || 30);
  const [q, setQ] = useState("");
  const person = who === TEAM || names.includes(who) ? who : y.me && names.includes(y.me) ? y.me : names[0] ?? "";
  const pick = (n: string) => { setWho(n); setPref("ytPerson", n); };
  const setDays = (d: number) => { setDaysState(d); setPref("ytPeopleDays", String(d)); };
  // everyone's tickets in one query (the same cache as the All scope): rail, team and person read from it
  const data = useQuery({ queryKey: ["yt", "issues", y.project, "*"], queryFn: ({ signal }) => yt.issues(y.project, null, signal), staleTime: 60_000 });
  const wait = useAiWait(data.isPending);
  const stats = useMemo(() => {
    const by = new Map<string, Ticket[]>();
    for (const i of data.data ?? []) if (i.assignee) by.set(i.assignee, [...(by.get(i.assignee) ?? []), i]);
    return new Map(names.map((n) => [n, statsOf(by.get(n) ?? [], days, now)]));
  }, [data.data, names, days, now]);
  const max = Math.max(1, ...[...stats.values()].map((s) => s.open.length));
  const shown = names.filter((n) => !q || fold(n).includes(fold(q)));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <nav aria-label="Thành viên" className="grid content-start gap-2 rounded-[var(--radius-card)] bg-cotton p-3 shadow-stock max-lg:max-h-72 overflow-y-auto lg:sticky lg:top-28 lg:max-h-[calc(100dvh-8rem)]">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm trong ${names.length} người…`} aria-label="Tìm người" className="h-8 w-full rounded-md border border-rule bg-paper pr-2 pl-7 text-sm focus:border-hl" />
        </label>
        <button type="button" aria-current={person === TEAM} onClick={() => pick(TEAM)}
          className={cn("flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium", person === TEAM ? "bg-hl-wash text-hl-2" : "hover:bg-paper-2")}>
          <span className="grid size-6 place-items-center rounded-full bg-paper-3"><Users className="size-3.5" /></span>Cả team
        </button>
        <ul className="grid gap-0.5 border-t border-rule pt-2">
          {shown.map((n) => {
            const s = stats.get(n)!;
            return (
              <li key={n}>
                <button type="button" aria-current={n === person} onClick={() => pick(n)}
                  className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 text-left text-sm", n === person ? "bg-hl-wash text-hl-2" : "hover:bg-paper-2")}>
                  <span className="relative row-span-2"><Avatar name={n} className="size-7" />{s.risk.length > 0 && <i aria-label={`${s.risk.length} ticket blocked hoặc quá hạn`} className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-error ring-2 ring-cotton" />}</span>
                  <span className={cn("truncate", n === person && "font-medium")}>{shortName(n)}{n === y.me && <span className="text-ink-3"> (tôi)</span>}</span>
                  <b className="font-mono text-xs font-normal text-ink-3 tabular-nums">{s.open.length || ""}</b>
                  <Load s={s} max={max} className="col-span-2 h-1.5" />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {data.isError ? <p role="alert" className="text-sm text-error">Không tải được ticket: {(data.error as Error).message}</p>
        : wait ? <YtFetching kind="people" />
        : !person ? <p className="text-sm text-ink-3">Chưa có danh sách thành viên.</p>
        : person === TEAM ? <TeamView stats={stats} max={max} days={days} setDays={setDays} onPick={pick} />
        : <PersonView key={person} name={person} s={stats.get(person)!} days={days} setDays={setDays} />}
    </div>
  );
}

const SORTS = [
  { value: "open", label: "Tải", f: (s: Stats) => s.open.length }, { value: "doing", label: "Đang làm", f: (s: Stats) => s.doing.length },
  { value: "risk", label: "Rủi ro", f: (s: Stats) => s.risk.length * 1000 + s.stale.length }, { value: "done", label: "Đã xong", f: (s: Stats) => s.done.length },
  { value: "lead", label: "Lead time", f: (s: Stats) => s.lead ?? -1 },
] as const;
// what the team AI reads: same column names as before, so its prompt is unchanged
const COLS: [string, (s: Stats) => number | null][] = [["Đang mở", (s) => s.open.length], ["Đang làm", (s) => s.doing.length], ["Chờ QC", (s) => s.qc.length], ["Blocked", (s) => s.blocked.length],
  ["Quá hạn", (s) => s.overdue.length], ["Không cập nhật >7 ngày", (s) => s.stale.length], ["Xong trong kỳ", (s) => s.done.length], ["Bug mở", (s) => s.bugs.length], ["Lead time (ngày)", (s) => s.lead]];

/** Everyone side by side: a load bar, what's at risk, output; a click opens the person, the AI reads it for rebalancing. */
function TeamView({ stats, max, days, setDays, onPick }: { stats: Map<string, Stats>; max: number; days: number; setDays: (d: number) => void; onPick: (n: string) => void }) {
  const y = useYt();
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>(() => (getPref("ytPeopleSort") as never) || "open");
  const f = (SORTS.find((x) => x.value === sort) ?? SORTS[0]).f;
  const rows = [...stats].filter(([, s]) => s.open.length || s.done.length).sort(([, a], [, b]) => f(b) - f(a));
  const all = rows.map(([, s]) => s), sum = (k: (s: Stats) => number) => all.reduce((a, s) => a + k(s), 0);
  const leads = all.map((s) => s.lead).filter((x) => x != null).sort((a, b) => a - b);
  const run = () => y.setSheet({ kind: "work", title: "AI · tải team & chia việc", ids: [], auto: { label: "AI đang phân tích tải team", run: (sig) => yt.aiData("team", {
    periodDays: days, wipLimit: y.wip, columns: COLS.map(([c]) => c),
    people: rows.map(([n, s]) => ({ name: n, ...Object.fromEntries(COLS.map(([c, g]) => [c, g(s)])), blockedOrOverdue: s.risk.map((i) => i.id).slice(0, 8), doing: s.doing.map((i) => i.id).slice(0, 8) })),
  }, sig) } });

  return (
    <div className="grid content-start gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto grid"><h2 className="text-lg font-semibold">Cả team</h2><span className="text-xs text-ink-3">{`${rows.length} người có ticket`}</span></div>
        <Period days={days} setDays={setDays} />
        {y.aiOn && <Button size="sm" onClick={run} disabled={!rows.length}><Sparkles /> AI chia việc</Button>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Đang mở" value={sum((s) => s.open.length)} sub={`${sum((s) => s.doing.length)} đang làm, ${sum((s) => s.qc.length)} chờ QC`} />
        <Kpi label="Blocked / quá hạn" value={sum((s) => s.risk.length)} bad={sum((s) => s.risk.length) > 0} sub={`${sum((s) => s.stale.length)} không cập nhật >7 ngày`} />
        <Kpi label={`Xong trong ${days} ngày`} value={sum((s) => s.done.length)} sub={`${sum((s) => s.fixed.length)} bug đã sửa`} />
        <Kpi label="Bug đang mở" value={sum((s) => s.bugs.length)} />
        <Kpi label="Lead time trung vị" value={leads.length ? leads[Math.floor(leads.length / 2)] : "—"} sub="ngày, giữa các người" />
      </div>
      <section className="grid gap-3 rounded-[var(--radius-card)] bg-cotton p-4 shadow-stock">
        <div className="flex flex-wrap items-center gap-3">
          <div className="max-w-full overflow-x-auto"><Segmented id="people-sort" label="Sắp xếp" value={sort} onChange={(v) => { setSort(v); setPref("ytPeopleSort", v); }} items={SORTS.map(({ value, label }) => ({ value, label }))} /></div>
          <span className="ml-auto"><Legend /></span>
        </div>
        <ul className="grid divide-y divide-rule">
          {rows.map(([n, s]) => {
            const over = y.wip > 0 && s.doing.length > y.wip;
            return (
              <li key={n}>
                <button type="button" onClick={() => onPick(n)} className="grid w-full grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 rounded-md px-2 py-2.5 text-left hover:bg-paper-2 md:grid-cols-[11rem_minmax(0,1fr)_14rem_8rem]">
                  <span className="flex min-w-0 items-center gap-2 text-sm"><Avatar name={n} className="size-7" /><span className="truncate">{shortName(n)}</span></span>
                  <span className="grid gap-1">
                    <Load s={s} max={max} className="h-2.5" />
                    <span className="text-xs text-ink-3 tabular-nums"><b className="font-mono font-medium text-ink">{s.open.length}</b> mở, <span className={cn(over && "font-semibold text-error")}>{s.doing.length} đang làm{over && ` (> WIP ${y.wip})`}</span>, {s.qc.length} chờ QC</span>
                  </span>
                  <span className="col-span-2 flex flex-wrap gap-1 md:col-span-1">
                    {s.blocked.length > 0 && <Tag tone="bad">{s.blocked.length} blocked</Tag>}
                    {s.overdue.length > 0 && <Tag tone="bad">{s.overdue.length} quá hạn</Tag>}
                    {s.stale.length > 0 && <Tag tone="warn">{s.stale.length} im &gt;7 ngày</Tag>}
                    {!s.risk.length && !s.stale.length && <span className="text-xs text-ink-3">Không có cảnh báo</span>}
                  </span>
                  <span className="hidden text-right text-xs text-ink-3 md:grid">
                    <span><b className="font-mono text-sm font-medium text-ok tabular-nums">{s.done.length}</b> xong</span>
                    <span className="tabular-nums">{s.lead != null ? `lead ${s.lead} ngày` : "—"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!rows.length && <p className="text-sm text-ink-3">Chưa ai có ticket trong kỳ này.</p>}
      </section>
    </div>
  );
}

const LISTS = [["open", "Đang mở"], ["attn", "Cần chú ý"], ["done", "Đã xong"]] as const;

function PersonView({ name, s, days, setDays }: { name: string; s: Stats; days: number; setDays: (d: number) => void }) {
  const y = useYt();
  const now = useNow();
  const [list, setList] = useState<(typeof LISTS)[number][0]>("open");
  const [scope, setScope] = useState<Scope>("both");
  const [prompt, setPrompt] = useState(() => PRESETS[0][2](name, days));
  const ids = (scope === "open" ? s.open : scope === "done" ? s.done : [...s.open, ...s.done]).toSorted((a, b) => b.updated - a.updated).map((i) => i.id);
  const figures = {
    "Đang mở": s.open.length, "Đang làm": s.doing.length, "Chờ QC": s.qc.length, Blocked: s.blocked.length, "Quá hạn": s.overdue.length,
    "Không cập nhật > 7 ngày": s.stale.length, "Chuyển sprint ≥ 2 lần": s.moved.length, [`Xong trong ${days} ngày`]: s.done.length,
    "Bug đã sửa": s.fixed.length, "Bug đang mở": s.bugs.length, "Lead time trung vị": s.lead != null ? `${s.lead} ngày` : "—",
  };
  function run(text = prompt) {
    const ask = text.trim();
    if (!ask || !ids.length) return;
    const pick = ids.slice(0, AI_MAX);
    y.setSheet({ kind: "work", title: `AI · ${shortName(name)}`, ids: pick, auto: { label: `AI đang đọc ${pick.length} ticket của ${shortName(name)}`, q: ask,
      run: (sig) => yt.aiTickets(pick, `${name}, ${SCOPES.find((x) => x.value === scope)!.label.toLowerCase()} (${days} ngày)`, "ask", sig, ask, { person: name, periodDays: days, ...figures }) } });
  }
  const flags = ([["Blocked", s.blocked, "bad"], ["Quá hạn", s.overdue, "bad"], ["Không cập nhật >7 ngày", s.stale, "warn"], ["Chuyển ≥ 2 sprint", s.moved, "warn"]] as const).filter(([, l]) => l.length);

  return (
    <div className="grid content-start gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={name} className="size-11 text-sm" />
        <div className="mr-auto grid">
          <h2 className="text-lg font-semibold">{name}{name === y.me && <span className="font-normal text-ink-3"> (tôi)</span>}</h2>
          <span className="text-xs text-ink-3">{`${s.open.length + s.done.length} ticket, lịch sử ${y.config?.hist ?? ""} ngày`}</span>
        </div>
        <Period days={days} setDays={setDays} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Đang mở" value={s.open.length} sub={<span className="grid gap-1.5"><span>{s.doing.length} đang làm, {s.qc.length} chờ QC</span><Load s={s} max={s.open.length || 1} /></span>} />
        <Kpi label="Cần chú ý" value={s.attn.length} bad={s.risk.length > 0} sub={`${s.risk.length} blocked / quá hạn`} />
        <Kpi label={`Xong trong ${days} ngày`} value={s.done.length} sub={`${s.fixed.length} bug đã sửa, ${s.bugs.length} bug mở`} />
        <Kpi label="Lead time trung vị" value={s.lead ?? "—"} sub={s.lead != null ? "ngày, từ tạo đến xong" : "chưa có ticket xong"} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="grid min-w-0 gap-3 rounded-[var(--radius-card)] bg-cotton p-4 shadow-stock">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented id="people-list" label="Danh sách ticket" value={list} onChange={setList}
              items={LISTS.map(([k, l]) => ({ value: k, label: <>{l} <b className="font-mono font-normal opacity-70">{s[k].length}</b></> }))} />
            {list === "open" && flags.length > 0 && (
              <span className="flex flex-wrap gap-1">{flags.map(([l, t, tone]) => <Tag key={l} tone={tone}>{t.length} {l.toLowerCase()}</Tag>)}</span>
            )}
          </div>
          <Rows rows={s[list]} now={now} empty={list === "attn" ? "Không có ticket nào cần chú ý." : list === "done" ? `Chưa xong ticket nào trong ${days} ngày.` : "Không có ticket đang mở."} />
        </section>

        {y.aiOn && (
          <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-hl-2" />Hỏi AI về {shortName(name)}</span>} className="border border-hl/25 xl:sticky xl:top-28">
            <div className="grid gap-1.5">
              <span className="text-xs text-ink-3">Ticket gửi cho AI</span>
              <Segmented id="people-ai-scope" label="Ticket gửi cho AI" value={scope} onChange={setScope} items={SCOPES.map((x) => ({ ...x }))} className="w-fit" />
              <span className="text-xs text-ink-3">{Math.min(ids.length, AI_MAX)} ticket{ids.length > AI_MAX ? ` (mới nhất trong ${ids.length})` : ""}, kèm số liệu ở trên</span>
            </div>
            <AiPromptBox aria-label="Yêu cầu cho AI" maxLength={2000} value={prompt} onChange={setPrompt} onSend={() => run()}
              placeholder="Nhập yêu cầu: tóm tắt, review, đánh giá… AI chỉ dựa trên ticket và số liệu của người này."
              top={( // presets fill the box and run: AI buttons live inside the prompt box (CLAUDE.md)
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map(([label, hint, make]) => (
                    <Hint key={label} title={label} text={`${hint} Bấm để chạy ngay.`} side="bottom">
                      <Button size="xs" variant="outline" className="rounded-full" disabled={!ids.length} onClick={() => { const p = make(name, days); setPrompt(p); run(p); }}>{label}</Button>
                    </Hint>
                  ))}
                </div>
              )}
              tools={<YtPicks heavy={Math.min(ids.length, AI_MAX) > 10} />}
              actions={<Hint side="bottom" text="Gửi yêu cầu cho AI (Enter)"><Button type="button" size="sm" className="rounded-full bg-hl text-hl-ink hover:brightness-110" disabled={!prompt.trim() || !ids.length} onClick={() => run()}><Sparkles /> Phân tích</Button></Hint>} />
          </Card>
        )}
      </div>
    </div>
  );
}

function Rows({ rows, now, empty }: { rows: Ticket[]; now: number; empty: string }) {
  const y = useYt();
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-3">{empty}</p>;
  const sorted = rows.toSorted((a, b) => b.updated - a.updated);
  return (
    <ul className="divide-y divide-rule">
      {sorted.slice(0, 80).map((i) => (
        <li key={i.id}>
          <button type="button" onClick={() => y.openTicket(i.id, sorted)} className="grid w-full gap-1 rounded-md px-2 py-2 text-left hover:bg-paper-2">
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <b className="font-mono text-xs">{i.id}</b><StatePill state={i.state} /><Prio p={i.priority} />
              {reasons(i, now).map(([l, tone]) => <Tag key={l} tone={tone}>{l}</Tag>)}
              <span className="ml-auto text-xs text-ink-3">{i.resolved ? `Xong ${when(i.resolved)}` : `Cập nhật ${when(i.updated)}`}</span>
            </span>
            <span className="truncate text-sm">{i.summary}</span>
          </button>
        </li>
      ))}
      {sorted.length > 80 && <li className="px-2 py-2 text-xs text-ink-3">+{sorted.length - 80} ticket cũ hơn</li>}
    </ul>
  );
}
