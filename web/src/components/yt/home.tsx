"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Copy, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useNow } from "@/lib/inbox";
import { getPref, put, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AI_MAX, type AiReq, bucket, bugSpike, DAY, type Focus, isBlocked, isBug, isBuilt, needsPo, qaList, rank, riskOf, tagsOf, type Ticket, titleOf, todayList, when, yt } from "@/lib/yt";
import { Card, Label, Markdown, Prio, Seg, StatePill, Tag } from "./bits";
import { Aging, Attention, Kpis, Progress, useQc, useStats, Wip } from "./dashboard";
import { ReportCard } from "./report";
import { useYt } from "./state";

// Each mode's home: Dev "Hôm nay" (my tickets in the order to do them), QA "Kiểm thử" (what to test / triage first),
// PO "Brief" (team state, backlog, what waits on the PO). One AI Studio card per home.

const today = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD, local
const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toLocaleDateString("sv"); };

/** The last 7 days per person, for the weekly AI digest: ids + short titles only. */
function weekData(rows: Ticket[], now: number) {
  const from = now - 7 * DAY, cut = (i: Ticket) => `${i.id}: ${(i.summary ?? "").slice(0, 90)}`;
  const by = new Map<string, Ticket[]>();
  for (const i of rows) { const k = i.assignee || "Chưa assign"; (by.get(k) ?? by.set(k, []).get(k)!).push(i); }
  const people = [...by].map(([name, l]) => ({
    name,
    done: l.filter((i) => i.resolved && i.resolved >= from).map(cut).slice(0, 15),
    doing: l.filter((i) => !i.resolved && bucket(i) === 1).map(cut).slice(0, 10),
    atRisk: l.map((i) => [i, riskOf(i, now)] as const).filter(([, r]) => r).map(([i, r]) => `${i.id}: ${r}`).slice(0, 10),
  })).filter((p) => p.done.length || p.doing.length || p.atRisk.length);
  const n = (f: (i: Ticket) => boolean) => rows.filter(f).length;
  return {
    days: 7, done: n((i) => !!i.resolved && i.resolved >= from), created: n((i) => i.created >= from),
    bugsFixed: n((i) => i.type === "Bug" && !!i.resolved && i.resolved >= from), bugsNew: n((i) => i.type === "Bug" && i.created >= from), people,
  };
}

/** The brief also says what moved since the last one: each open ticket's state / assignee then and now (per browser). */
async function sinceLast(key: string, rows: Ticket[], run: (changes: string[]) => Promise<{ text: string }>) {
  let prev: Record<string, [string | null, string | null]> = {};
  try { prev = JSON.parse(getPref(key) ?? "{}") ?? {}; } catch {}
  const now = Object.fromEntries(rows.map((i) => [i.id, [i.state, i.assignee]]));
  const who = (a: string | null) => a ?? "chưa assign";
  const changes = !Object.keys(prev).length ? [] : [ // the first brief has nothing to compare with
    ...rows.flatMap((i) => {
      const p = prev[i.id];
      if (!p) return [`${i.id}: mới vào danh sách (${i.state ?? "—"}, ${who(i.assignee)})`];
      return [...(p[0] !== i.state ? [`${i.id}: ${p[0] ?? "—"} → ${i.state ?? "—"}`] : []),
        ...(p[1] !== i.assignee ? [`${i.id}: ${who(p[1])} → ${who(i.assignee)}`] : [])];
    }),
    ...Object.keys(prev).filter((id) => !(id in now)).map((id) => `${id}: đã xong hoặc rời danh sách`),
  ].slice(0, 200);
  const r = await run(changes);
  put(key, JSON.stringify(now)); // only once the brief is written: a cancelled run compares with the old one next time
  return r;
}

type Saved = { text: string; at: number; req?: AiReq | null };
type Tab = { k: string; label: string; busy: string; hint: string; disabled?: string; weekly?: boolean; ids?: string[]; run: (sig: AbortSignal) => Promise<{ text: string }> };

/** Every scope-level AI of a home in one card: a tab per job, each answer kept for the day (weekly: the week) per browser,
 *  so opening the tab spends no quota; "Làm lại" reruns. */
function AiStudio({ id, tabs }: { id: string; tabs: Tab[] }) {
  const y = useYt();
  const [k, setK] = useState(() => { const v = getPref(`ytAiTab:${id}`); return tabs.some((t) => t.k === v) ? v! : tabs[0].k; });
  const t = tabs.find((x) => x.k === k) ?? tabs[0];
  const key = `ytAi:${id}:${t.k}:${t.weekly ? monday() : today()}`;
  const [ver, setVer] = useState(0); // bumped on save / delete: the answer is read from prefs for the current tab and day
  const saved = useMemo(() => { try { return JSON.parse(getPref(key) ?? "null") as Saved | null; } catch { return null; } }, [key, ver]); // eslint-disable-line react-hooks/exhaustive-deps -- ver re-reads
  const setSaved = (v: Saved | null) => { setPref(key, v && JSON.stringify(v)); setVer((n) => n + 1); };
  function pick(v: string) { setK(v); setPref(`ytAiTab:${id}`, v); }
  // every run opens the AI session; a saved answer opens there too, so it can be followed up
  const open = (fresh: boolean) => y.setSheet({ kind: "work", title: `AI · ${t.label}`, ids: (t.ids ?? []).slice(0, AI_MAX), auto: {
    label: t.busy, run: t.run, seed: !fresh && saved ? { text: saved.text, req: saved.req ?? null } : undefined,
    onDone: (r) => { setPref(key, JSON.stringify({ text: r.text, at: Date.now(), req: r.req } satisfies Saved)); setVer((n) => n + 1); },
  } });
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-hl-2" />AI Studio</span>}
      meta={saved ? `${t.label} lúc ${when(saved.at)}` : undefined} className="border border-hl/25">
      <Seg label="Việc của AI" value={t.k} onChange={pick} options={tabs.map((x) => [x.k, x.label, x.hint] as const)} className="flex-wrap justify-self-start" />
      {saved ? <div className="line-clamp-6"><Markdown text={saved.text} onTicket={(i) => y.openTicket(i)} /></div>
        : <p className="text-sm text-ink-2">{t.disabled ?? t.hint}</p>}
      <div className="flex gap-1.5">
        {saved && <Button size="sm" onClick={() => open(false)}><Sparkles /> Mở phiên AI</Button>}
        <Button size="sm" variant={saved ? "outline" : "default"} disabled={!!t.disabled} onClick={() => open(true)}>
          {saved ? <><RotateCw /> Làm lại</> : <><Sparkles /> {t.label}</>}
        </Button>
        {saved && <Button size="sm" variant="ghost" title="Xóa nội dung AI đã lưu" onClick={() => setSaved(null)}><Trash2 /> Xóa</Button>}
      </div>
    </Card>
  );
}

type Lens = "all" | "doing" | "qc" | "block" | "test";

export function DevHome() {
  const y = useYt();
  const now = useNow();
  const list = useMemo(() => todayList(y.rows, y.me, y.since, now), [y.rows, y.me, y.since, now]);
  const mine = useMemo(() => y.rows.filter((i) => !i.resolved && i.assignee === y.me), [y.rows, y.me]);
  const { loadSince } = y;
  useEffect(() => { const doing = mine.filter((i) => bucket(i) === 1); if (doing.length) loadSince(doing); }, [mine, loadSince]);
  const [lens, setLens] = useState<Lens>("all");
  const LENS: Record<Lens, [string, (i: Ticket) => boolean]> = {
    all: ["Đang mở", (i) => i.assignee === y.me], doing: ["Đang làm", (i) => i.assignee === y.me && bucket(i) === 1],
    qc: ["Chờ QC", (i) => i.assignee === y.me && bucket(i) === 2], block: ["Blocked", (i) => i.assignee === y.me && isBlocked(i)],
    test: ["Chờ bạn test", (i) => i.qc === y.me && i.assignee !== y.me && bucket(i) === 2],
  };
  const shown = lens === "all" ? list : list.filter((x) => LENS[lens][1](x.i));
  // Standup: what changed since the last working day (Friday on Mondays) plus today's top picks.
  const standup = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() === 1 ? 3 : 1));
    const since = d.getTime();
    const done = y.rows.filter((i) => i.assignee === y.me && i.updated >= since).sort((a, b) => b.updated - a.updated);
    return { since, ids: [...new Set([...done, ...list.map((x) => x.i)].map((i) => i.id))].slice(0, AI_MAX) };
  }, [y.rows, y.me, list, now]);
  const risky = mine.map((i) => [i, riskOf(i, now)] as const).filter((x): x is readonly [Ticket, string] => !!x[1]);
  if (!y.me) return <p className="rounded-lg bg-cotton p-6 text-sm text-ink-2 shadow-stock">Chưa biết bạn là ai trên YouTrack. Kiểm tra token trong Cài đặt › YouTrack, hoặc đổi vai trò trong Cài đặt › Chung.</p>;
  const recent = [...mine].sort((a, b) => b.updated - a.updated).slice(0, 5);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="grid content-start gap-4">
        {/* the figures are the list's lens: one card, a click narrows "Hôm nay làm gì" below */}
        <LensBar label="Lọc danh sách hôm nay" value={lens} onChange={setLens} lenses={(Object.keys(LENS) as Lens[]).map((l) => [l, LENS[l][0],
          l === "all" ? mine.length : l === "test" ? y.rows.filter((i) => !i.resolved && LENS.test[1](i)).length : mine.filter(LENS[l][1]).length,
          l === "block" ? "text-error" : l === "test" ? "text-signal-2" : ""])} />
        {risky.length > 0 && (
          <div role="alert" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-error/25 bg-error-wash/40 px-3 py-2">
            <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-semibold text-error"><AlertTriangle className="size-4" />{risky.length} cần xử lý ngay</span>
            {risky.map(([i, why]) => (
              <button key={i.id} type="button" onClick={() => y.openTicket(i.id, risky.map(([t]) => t))} title={i.summary ?? ""}
                className="inline-flex items-center gap-1.5 rounded-full bg-cotton px-2.5 py-0.5 text-xs shadow-edge hover:bg-paper-2">
                <b className="font-mono">{i.id}</b><span className="text-error">{why}</span>
              </button>
            ))}
          </div>
        )}
        <Card title="Hôm nay làm gì" meta={lens === "all" ? `${list.length} ticket, xếp theo mức gấp` : <button type="button" onClick={() => setLens("all")} className="hover:text-ink">{LENS[lens][0]}: {shown.length} · bỏ lọc</button>}>
          <FocusList key={lens} list={shown} top={lens === "all" ? "Làm ngay" : ""} empty={lens === "all" ? "Không có ticket nào đang mở của bạn." : "Không có ticket nào ở mục này."} />
        </Card>
      </div>
      <div className="grid content-start gap-4">
        {y.aiOn && (
          <AiStudio key={`dev:${y.project}`} id={`dev:${y.project}`} tabs={[
            { k: "today", label: "Kế hoạch", busy: `AI đang đọc ${Math.min(list.length, AI_MAX)} ticket`, disabled: list.length ? undefined : "Không có ticket nào để lập kế hoạch.",
              hint: "AI đọc mô tả, bình luận và tin Telegram của các ticket trên để chọn việc làm ngay, việc cần trả lời, chỗ đang kẹt.",
              ids: list.slice(0, AI_MAX).map((x) => x.i.id), run: (sig) => yt.aiTickets(list.slice(0, AI_MAX).map((x) => x.i.id), `Ticket của ${y.me}`, "today", sig) },
            { k: "standup", label: "Standup", busy: "AI đang viết standup", disabled: standup.ids.length ? undefined : "Chưa có ticket nào của bạn.",
              hint: "Hôm qua / Hôm nay / Vướng mắc từ ticket bạn cập nhật từ ngày làm việc trước và tin bạn đã trả lời trên Telegram. Dán thẳng vào nhóm.",
              ids: standup.ids, run: (sig) => yt.aiTickets(standup.ids, `Ticket của ${y.me}`, "standup", sig, "", undefined, standup.since) },
            { k: "promises", label: "Việc đã hứa", busy: "AI đang đọc tin bạn đã gửi",
              hint: "Những việc bạn đã hứa trong các nhóm Telegram 7 ngày qua (“để em check”, “mai em gửi”) mà chưa thấy xong.",
              run: (sig) => yt.aiPromises(Date.now() - 7 * DAY, sig) },
          ]} />
        )}
        <Card title="Mới cập nhật" meta="ticket của bạn">
          {recent.length ? (
            <ul className="grid gap-0.5">
              {recent.map((i) => (
                <li key={i.id}><button type="button" onClick={() => y.openTicket(i.id, recent)} className="grid w-full gap-1 rounded-md px-2 py-1.5 text-left hover:bg-paper-2">
                  <Title i={i} clamp="truncate" />
                  <span className="flex items-center gap-2 text-xs"><span className="font-mono text-ink-3">{i.id}</span><StatePill state={i.state} /><span className="ml-auto text-ink-3">{when(i.updated)}</span></span>
                </button></li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-3">Chưa có.</p>}
        </Card>
        <ReportCard />
      </div>
    </div>
  );
}

/** Figures that are also the list's lens: a click narrows the list below, a second click (or "all") clears it. */
function LensBar<L extends string>({ label, lenses, value, onChange }: { label: string; lenses: [L, string, number, string][]; value: L; onChange: (l: L) => void }) {
  const all = lenses[0][0];
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] divide-x divide-rule overflow-hidden rounded-[var(--radius-card)] bg-cotton shadow-stock max-sm:grid-cols-3 max-sm:divide-x-0">
      {lenses.map(([l, name, n, tone]) => (
        <button key={l} type="button" role="radio" aria-checked={value === l} onClick={() => onChange(value === l ? all : l)}
          className={cn("relative grid justify-items-start gap-0.5 px-3 py-2.5 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2", value === l && l !== all && "bg-hl-wash")}>
          {value === l && l !== all && <i aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-hl" />}
          <span className="max-w-full truncate text-xs text-ink-3">{name}</span>
          <b className={cn("font-mono text-2xl font-medium tabular-nums", n > 0 && tone)}>{n}</b>
        </button>
      ))}
    </div>
  );
}

/** A ranked ticket list; with `top`, the first three are headed by it and the rest by "Tiếp theo". */
const PAGE = 20;

/** The ranked list, 20 a page: page 1 opens with the "top" few; numbers stay global. Pages slide in the direction moved. */
function FocusList({ list, top, empty }: { list: Focus[]; top: string; empty: string }) {
  const [[page, dir], setPage] = useState([0, 0]);
  const calm = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const pages = Math.ceil(list.length / PAGE);
  const p = Math.min(page, Math.max(0, pages - 1)); // the list shrank (a ticket moved on): stay in range
  if (!list.length) return <p className="text-sm text-ink-3">{empty}</p>;
  const all = list.map((x) => x.i);
  const from = p * PAGE, shown = list.slice(from, from + PAGE);
  const parts = top && p === 0 ? [[top, shown.slice(0, 3), 0], ["Tiếp theo", shown.slice(3), 3]] as const : [["", shown, from]] as const;
  function go(n: number) {
    if (n === p || n < 0 || n >= pages) return;
    setPage([n, n > p ? 1 : -1]);
    if ((ref.current?.getBoundingClientRect().top ?? 0) < 0) ref.current?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }
  const x = calm ? 0 : 24;
  return (
    <div ref={ref} className="grid scroll-mt-4 gap-3">
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div key={p} custom={dir} className="grid gap-3"
          variants={{ in: (d: number) => ({ opacity: 0, x: d * x }), on: { opacity: 1, x: 0 }, out: (d: number) => ({ opacity: 0, x: -d * x }) }}
          initial="in" animate="on" exit="out" transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
          {parts.map(([h, part, base]) => part.length > 0 && (
            <div key={h} className="grid gap-1.5">
              {h && <Label>{h}<span className="font-normal tabular-nums">{part.length}</span></Label>}
              <ol className={cn("grid", top && p === 0 && base === 0 ? "gap-0.5 rounded-lg bg-hl-wash/50 p-1 ring-1 ring-hl/20" : "divide-y divide-rule/60")}>
                {part.map(({ i, why }, k) => (
                  <motion.li key={i.id} layout="position" initial={{ opacity: 0, y: calm ? 0 : 4 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(base - from + k, 12) * 0.02, duration: 0.2, layout: { duration: 0.25 } }}>
                    <FocusRow i={i} why={why} n={base + k + 1} all={all} top={!!top && p === 0 && base === 0} />
                  </motion.li>
                ))}
              </ol>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
      {pages > 1 && <Pager page={p} pages={pages} total={list.length} onGo={go} />}
    </div>
  );
}

/** ‹ 1 2 3 … 9 › and "21–40 / 57"; arrow keys move a page while it has focus. */
function Pager({ page, pages, total, onGo }: { page: number; pages: number; total: number; onGo: (n: number) => void }) {
  // first, last, and the pages around the current one; gaps become …
  const nums = [...new Set([0, page - 1, page, page + 1, pages - 1])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const btn = "grid h-7 min-w-7 place-items-center rounded-md px-1.5 font-mono text-xs tabular-nums transition-colors duration-(--dur-micro)";
  return (
    <nav aria-label="Trang" className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-2.5"
      onKeyDown={(e) => { if (e.key === "ArrowLeft") onGo(page - 1); if (e.key === "ArrowRight") onGo(page + 1); }}>
      <span className="text-xs text-ink-3 tabular-nums">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} / {total}</span>
      <div className="flex items-center gap-0.5">
        <Button size="icon-xs" variant="ghost" disabled={page === 0} onClick={() => onGo(page - 1)} aria-label="Trang trước"><ChevronLeft /></Button>
        {nums.map((n, k) => (
          <Fragment key={n}>
            {k > 0 && n - nums[k - 1] > 1 && <span className="px-0.5 text-xs text-ink-3" aria-hidden>…</span>}
            <button type="button" onClick={() => onGo(n)} aria-current={n === page ? "page" : undefined} aria-label={`Trang ${n + 1}`}
              className={cn(btn, n === page ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>{n + 1}</button>
          </Fragment>
        ))}
        <Button size="icon-xs" variant="ghost" disabled={page >= pages - 1} onClick={() => onGo(page + 1)} aria-label="Trang sau"><ChevronRight /></Button>
      </div>
    </nav>
  );
}

type QaLens = "queue" | "mine" | "retest" | "noqc" | "bugs" | "mybugs" | "critical";

export function QaHome() {
  const y = useYt();
  const d = useStats();
  const now = useNow();
  const open = useMemo(() => y.rows.filter((i) => !i.resolved), [y.rows]);
  const { loadSince } = y;
  useEffect(() => { const waiting = open.filter((i) => bucket(i) === 2); if (waiting.length) loadSince(waiting); }, [open, loadSince]);
  const qc = useQc();
  const fails = useMemo(() => { const m = new Map<string, number>(); for (const x of qc.fail) m.set(x.id, (m.get(x.id) || 0) + 1); return m; }, [qc.fail]);
  const ranked = useMemo(() => qaList(open, y.me, y.since, now, fails), [open, y.me, y.since, now, fails]);
  const LENS: Record<QaLens, [string, (i: Ticket) => boolean, string]> = {
    queue: ["Chờ test", (i) => bucket(i) === 2, ""], mine: ["Chờ tôi test", (i) => !!y.me && i.qc === y.me && bucket(i) === 2, "text-signal-2"],
    retest: ["Test lại", (i) => bucket(i) === 2 && fails.has(i.id), "text-signal-2"],
    noqc: ["Chưa có QC", (i) => bucket(i) === 2 && !i.qc, "text-warn"], bugs: ["Bug đang mở", isBug, ""],
    mybugs: ["Bug tôi log", (i) => !!y.me && isBug(i) && i.reporter === y.me, ""],
    critical: ["Bug Critical", (i) => isBug(i) && rank(i) <= 1, "text-error"],
  };
  const [lens, setLens] = useState<QaLens>("queue");
  const shown = ranked.filter((x) => LENS[lens][1](x.i));
  const mine = ranked.filter((x) => LENS.mine[1](x.i));
  const bugs = ranked.filter((x) => isBug(x.i));
  const built = ranked.filter((x) => isBuilt(x.i));
  const week = useMemo(() => {
    const from = now - 7 * DAY, b = y.rows.filter(isBug);
    return { created: b.filter((i) => i.created >= from).length, fixed: b.filter((i) => !!i.resolved && i.resolved >= from).length };
  }, [y.rows, now]);
  const TESTS = 10; // test cases are long: a handful of tickets per run
  const testIds = (mine.length ? mine : ranked.filter((x) => LENS.queue[1](x.i))).slice(0, TESTS).map((x) => x.i.id);
  const spike = useMemo(() => bugSpike(y.rows, now), [y.rows, now]);
  // quality gate: sprint tickets not yet with QC, so gaps (AC, repro steps) are caught before they reach the test queue
  const upstream = d.sprintOpen.filter((i) => bucket(i) < 2).sort((a, b) => rank(a) - rank(b));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="grid content-start gap-4">
        {(spike.spike || spike.mods.length > 0) && (
          <button type="button" role="alert" onClick={() => y.setSheet({ kind: "list", title: "Bug mới 7 ngày", rows: spike.rows })}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-error/25 bg-error-wash/40 px-3 py-2 text-left text-sm hover:bg-error-wash/60">
            <AlertTriangle className="size-4 text-error" aria-hidden />
            <b>Bug tăng đột biến:</b>
            <span>{spike.n} bug mới 7 ngày (trung bình {spike.avg}/tuần)</span>
            {spike.mods.slice(0, 4).map(([m, n]) => <span key={m} className="rounded-full bg-paper-3 px-2 text-xs leading-5 font-medium">{m}: {n}</span>)}
          </button>
        )}
        <LensBar label="Lọc hàng đợi kiểm thử" value={lens} onChange={setLens}
          lenses={(Object.keys(LENS) as QaLens[]).map((l) => [l, LENS[l][0], ranked.filter((x) => LENS[l][1](x.i)).length, LENS[l][2]])} />
        <Card title={lens === "mybugs" ? "Bug tôi đã log, còn mở" : lens === "bugs" || lens === "critical" ? "Bug cần xử lý" : "Hàng đợi test"}
          meta={lens === "queue" ? `${shown.length} ticket, xếp theo mức gấp` : <button type="button" onClick={() => setLens("queue")} className="hover:text-ink">{LENS[lens][0]}: {shown.length} · bỏ lọc</button>}>
          <FocusList key={lens} list={shown} top={lens === "queue" ? "Test ngay" : ""} empty="Không có ticket nào ở mục này." />
        </Card>
      </div>
      <div className="grid content-start gap-4">
        {y.aiOn && (
          <AiStudio key={`qa:${y.project}`} id={`qa:${y.project}`} tabs={[
            { k: "testcases", label: "Test case", busy: `AI đang viết test case cho ${testIds.length} ticket`, disabled: testIds.length ? undefined : "Không có ticket nào chờ test.",
              hint: `Test case (luồng chính, biên, lỗi), vùng regression và câu cần hỏi cho ${mine.length ? "các ticket chờ bạn test" : "các ticket chờ test"}, tối đa ${TESTS} ticket gấp nhất.`,
              ids: testIds, run: (sig) => yt.aiTickets(testIds, mine.length ? `Ticket chờ ${y.me} test` : "Ticket chờ test", "testcases", sig) },
            { k: "triage", label: "Bug triage", busy: `AI đang đọc ${Math.min(bugs.length, AI_MAX)} bug`, disabled: bugs.length ? undefined : "Không có bug nào đang mở.",
              hint: "Bug thiếu bước tái hiện / log / thiết bị, nên đổi priority, có vẻ trùng, có thể đã fix, cần ping ai.",
              ids: bugs.slice(0, AI_MAX).map((x) => x.i.id), run: (sig) => yt.aiTickets(bugs.slice(0, AI_MAX).map((x) => x.i.id), "Bug đang mở", "triage", sig) },
            { k: "regression", label: "Regression", busy: `AI đang đọc ${Math.min(built.length, AI_MAX)} ticket chờ release`, disabled: built.length ? undefined : "Không có ticket nào đã build / chờ release.",
              hint: "Checklist regression cho bản sắp phát hành từ các ticket Built / Done on dev / Waiting to release: smoke test, theo màn hình, rủi ro cao.",
              ids: built.slice(0, AI_MAX).map((x) => x.i.id), run: (sig) => yt.aiTickets(built.slice(0, AI_MAX).map((x) => x.i.id), "Ticket đã build, chờ release", "regression", sig) },
            { k: "quality", label: "Chất lượng ticket", busy: `AI đang rà ${Math.min(upstream.length, AI_MAX)} ticket`, disabled: upstream.length ? undefined : "Sprint đang xem không còn ticket nào chưa tới QC.",
              hint: `Ticket của ${d.per.label} chưa tới bước test: thiếu tiêu chí nghiệm thu, bug thiếu bước tái hiện, nên tách, chưa estimate, có vẻ trùng.`,
              ids: upstream.slice(0, AI_MAX).map((i) => i.id), run: (sig) => yt.aiTickets(upstream.slice(0, AI_MAX).map((i) => i.id), `${d.per.label}, chưa tới QC`, "quality", sig) },
          ]} />
        )}
        <QcMine qc={qc} waiting={mine.map((x) => x.i)} retest={ranked.filter((x) => LENS.retest[1](x.i)).map((x) => x.i)} />
        <QcSplit open={open} />
        <Card title="Bug 7 ngày qua">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {([["Mới", week.created, week.created > week.fixed ? "text-error" : ""], ["Đã fix", week.fixed, "text-ok"], ["Đang mở", bugs.length, ""]] as const).map(([l, n, tone]) => (
              <div key={l} className="grid gap-0.5 rounded-md bg-paper-2 py-2"><dt className="text-xs text-ink-3">{l}</dt><dd className={cn("font-mono text-2xl tabular-nums", n > 0 && tone)}>{n}</dd></div>
            ))}
          </dl>
        </Card>
        <ReportCard />
      </div>
    </div>
  );
}

/** The title reads first: [tags] as chips, the "A > B >" path quiet, the last segment (the actual job) in full ink. */
function Title({ i, clamp }: { i: Ticket; clamp: string }) {
  const t = titleOf(i), k = t.lastIndexOf(" > ");
  return (
    <span title={i.summary ?? ""} className={cn("min-w-0 text-sm leading-snug", clamp)}>
      {tagsOf(i).map((g) => <Fragment key={g}><Tag name={g} />{" "}</Fragment>)}
      {k > 0 && <span className="text-ink-3">{t.slice(0, k).replaceAll(" > ", " › ")} › </span>}
      <span className="font-medium text-ink">{k > 0 ? t.slice(k + 3) : t}</span>
    </span>
  );
}

function FocusRow({ i, why, n, all, top }: { i: Ticket; why: string[]; n: number; all: Ticket[]; top: boolean }) {
  const y = useYt();
  const now = useNow();
  const hot = isBlocked(i) || (!!i.due && i.due < now) || rank(i) <= 1;
  return (
    <button type="button" onClick={() => y.openTicket(i.id, all)}
      className={cn("group/row relative grid w-full grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-md px-2.5 py-2 text-left transition-colors duration-(--dur-micro)",
        top ? "hover:bg-cotton" : "hover:bg-paper-2")}>
      {hot && <i aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-error" />}
      <span className={cn("row-span-2 grid size-7 place-items-center rounded-full font-mono text-xs font-semibold tabular-nums",
        top ? "bg-hl text-hl-ink" : "text-ink-3 group-hover/row:text-ink-2")}>{n}</span>
      <Title i={i} clamp={top ? "line-clamp-2" : "truncate"} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <span className="font-mono text-ink-3">{i.id}</span><StatePill state={i.state} /><Prio p={i.priority} />
        {why.map((w) => <span key={w} className={cn("rounded-full px-2 leading-5 font-medium", hot ? "bg-error-wash text-error" : "bg-paper-3 text-ink-2")}>{w}</span>)}
      </span>
    </button>
  );
}

export function PoHome() {
  const y = useYt();
  const d = useStats();
  const waitPo = useMemo(() => y.rows.filter(needsPo).sort((a, b) => rank(a) - rank(b) || a.updated - b.updated), [y.rows]);
  // sprint planning: open tickets outside the sprint being watched, most urgent first
  const backlog = useMemo(() => y.rows.filter((i) => !i.resolved && !i.sprints.some((s) => d.per.set.has(s))).sort((a, b) => rank(a) - rank(b) || b.updated - a.updated), [y.rows, d.per.set]);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-12 gap-3"><Kpis d={d} /></div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="grid content-start gap-4">
          <ReportCard />
          {y.aiOn && (
            <AiStudio key={`po:${y.project}:${d.per.label}`} id={`po:${y.project}:${d.per.label}`} tabs={[
              { k: "brief", label: "Brief", busy: `AI đang đọc ${Math.min(d.sprintOpen.length, AI_MAX)} ticket đang mở`, disabled: d.sprintOpen.length ? undefined : "Sprint đang xem không có ticket mở.",
                hint: `AI đọc các ticket đang mở của ${d.per.label}: việc tiếp theo từng người, chỗ nghẽn, cần chốt, cần ping ai, và những gì đã đổi từ lần brief trước.`,
                ids: d.sprintOpen.map((i) => i.id), run: (sig) => sinceLast(`ytAiSnap:${y.project}:${d.per.label}`, d.sprintOpen, (changes) =>
                  yt.aiTickets(d.sprintOpen.slice(0, AI_MAX).map((i) => i.id), `${d.per.label} (ticket đang mở)`, "review", sig, "", undefined, 0, changes)) },
              { k: "plan", label: "Lên sprint", busy: `AI đang xếp ${Math.min(backlog.length, AI_MAX)} ticket`, disabled: backlog.length ? undefined : "Không có ticket mở nào ngoài sprint đang xem.",
                hint: "Gợi ý ticket nên kéo vào sprint tới và giao cho ai, dựa trên priority, tải hiện tại (WIP) và velocity của team; kèm ticket chưa nên kéo vì thiếu spec / estimate.",
                ids: backlog.slice(0, AI_MAX).map((i) => i.id), run: (sig) => yt.aiTickets(backlog.slice(0, AI_MAX).map((i) => i.id), `Backlog ngoài ${d.per.label}`, "plan", sig, "", { wipLimit: y.wip, wip: d.wip, velocityAvgPerSprint: d.vel.avg, sprintNow: d.per.label }) },
              { k: "groom", label: "Grooming", busy: `AI đang đọc ${Math.min(backlog.length, AI_MAX)} ticket backlog`, disabled: backlog.length ? undefined : "Không có ticket mở nào ngoài sprint đang xem.",
                hint: "Rà backlog: ticket đã sẵn sàng, cần làm rõ (hỏi ai, hỏi gì), nên tách / gộp, đề xuất priority, nên đóng.",
                ids: backlog.slice(0, AI_MAX).map((i) => i.id), run: (sig) => yt.aiTickets(backlog.slice(0, AI_MAX).map((i) => i.id), `Backlog ngoài ${d.per.label}`, "groom", sig) },
              { k: "weekly", label: "Bản tin tuần", weekly: true, busy: "AI đang viết bản tin tuần", disabled: y.rows.length ? undefined : "Chưa có dữ liệu ticket.",
                hint: "7 ngày qua: tổng quan, từng người xong gì / đang làm / kẹt, rủi ro tuần tới. Lưu cả tuần, dán thẳng vào Telegram.",
                run: (sig) => yt.aiData("weekly", weekData(y.rows, Date.now()), sig) },
              { k: "notes", label: "Release notes", busy: "AI đang viết release notes", disabled: d.doneRows.length ? undefined : "Sprint đang xem chưa có ticket xong.",
                hint: "Release notes từ ticket đã xong trong sprint: phần cho người dùng và danh sách nội bộ.",
                ids: d.doneRows.slice(0, AI_MAX).map((i) => i.id), run: (sig) => yt.aiData("notes", d.doneRows.slice(0, 300).map((i) => ({ id: i.id, type: i.type, summary: i.summary })), sig) },
            ]} />
          )}
          <Card title="Tiến độ sprint" meta="vạch dọc = thời gian đã qua"><Progress d={d} /></Card>
          <Card title="Cảnh báo ticket kéo dài"><Aging d={d} /></Card>
        </div>
        <div className="grid content-start gap-4">
          <Card title="Chờ PO chốt" meta="define / confirm">
            {waitPo.length ? (
              <ul className="grid gap-0.5">
                {waitPo.slice(0, 8).map((i) => (
                  <li key={i.id}><button type="button" onClick={() => y.openTicket(i.id, waitPo)} className="grid w-full gap-1 rounded-md px-2 py-1.5 text-left hover:bg-paper-2">
                    <Title i={i} clamp="truncate" />
                    <span className="flex items-center gap-2 text-xs"><span className="font-mono text-ink-3">{i.id}</span><StatePill state={i.state} /><Prio p={i.priority} /><span className="ml-auto text-ink-3">{when(i.updated)}</span></span>
                  </button></li>
                ))}
                {waitPo.length > 8 && <li><button type="button" onClick={() => y.setSheet({ kind: "list", title: "Chờ PO chốt", rows: waitPo })} className="px-1.5 text-xs text-ink-3 hover:text-ink">Xem cả {waitPo.length} ticket</button></li>}
              </ul>
            ) : <p className="text-sm text-ink-3">Không có ticket nào chờ định nghĩa / xác nhận.</p>}
          </Card>
          <Card title="Cần chú ý" meta="ticket đang mở"><Attention d={d} /></Card>
          <Card title="Công việc đang làm" meta={`ngưỡng WIP ${y.wip}`}><Wip d={d} /></Card>
        </div>
      </div>
    </div>
  );
}

const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast({ text: `Đã chép ${what}` }), () => toast({ text: "Không chép được" }));

/** My test results (from the State history: moves out of a test state I made), and a standup line to paste in Telegram. */
function QcMine({ qc, waiting, retest }: { qc: ReturnType<typeof useQc>; waiting: Ticket[]; retest: Ticket[] }) {
  const y = useYt();
  const now = useNow();
  if (!y.me || !qc.q.data) return null;
  const today = new Date(now).setHours(0, 0, 0, 0);
  const of = (from: number) => {
    const v = [...qc.pass, ...qc.fail].filter((x) => x.by === y.me && x.at >= from);
    const ids = (k: "pass" | "fail") => [...new Set(v.filter((x) => x.kind === k).map((x) => x.id))];
    return { n: new Set(v.map((x) => x.id)).size, pass: ids("pass"), fail: ids("fail") };
  };
  const rows = [["Hôm nay", of(today)], ["24 giờ qua", of(now - DAY)], ["7 ngày", of(now - 7 * DAY)]] as const;
  const day = rows[1][1];
  const standup = [
    `Standup QC · ${y.me} · ${new Date(now).toLocaleDateString("vi-VN")}`,
    `- 24h qua đã test ${day.n} ticket${day.pass.length ? `; pass: ${day.pass.join(", ")}` : ""}${day.fail.length ? `; trả lại: ${day.fail.join(", ")}` : ""}`,
    `- Chờ tôi test: ${waiting.length}${waiting.length ? ` (${waiting.slice(0, 8).map((i) => i.id).join(", ")})` : ""}`,
    ...(retest.length ? [`- Test lại sau khi dev sửa: ${retest.slice(0, 8).map((i) => i.id).join(", ")}`] : []),
  ].join("\n");
  return (
    <Card title="Kết quả test của tôi" meta={<Button size="xs" variant="ghost" onClick={() => void copy(standup, "standup")}><Copy /> Copy standup</Button>}>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {rows.map(([l, r]) => (
          <div key={l} className="grid gap-0.5 rounded-md bg-paper-2 py-2">
            <dt className="text-xs text-ink-3">{l}</dt>
            <dd className="font-mono text-2xl tabular-nums">{r.n}</dd>
            <dd className="text-xs text-ink-3"><button type="button" disabled={!r.pass.length} className="text-ok enabled:hover:underline"
              onClick={() => y.setSheet({ kind: "list", title: `Tôi đã pass · ${l}`, rows: r.pass.map((id) => qc.byId.get(id)!) })}>{r.pass.length} pass</button>
              {" · "}<button type="button" disabled={!r.fail.length} className={cn(r.fail.length && "text-error", "enabled:hover:underline")}
              onClick={() => y.setSheet({ kind: "list", title: `Tôi đã trả lại · ${l}`, rows: r.fail.map((id) => qc.byId.get(id)!) })}>{r.fail.length} trả</button></dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Tickets waiting for test with no QC: each suggested to whoever holds the fewest tickets in test right now (counting the
 *  ones suggested above it), most urgent first. QC people = whoever is QC on any loaded ticket. */
function QcSplit({ open }: { open: Ticket[] }) {
  const y = useYt();
  const plan = useMemo(() => {
    const load = new Map<string, number>();
    for (const i of y.rows) if (i.qc && !load.has(i.qc)) load.set(i.qc, 0);
    for (const i of open) if (i.qc && bucket(i) === 2) load.set(i.qc, (load.get(i.qc) || 0) + 1);
    if (!load.size) return [];
    // ponytail: counts tickets, not effort; weigh by estimate if the team estimates test work
    return open.filter((i) => bucket(i) === 2 && !i.qc).sort((a, b) => rank(a) - rank(b)).map((i) => {
      const [who, n] = [...load].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
      load.set(who, n + 1);
      return { i, who, n };
    });
  }, [y.rows, open]);
  if (!plan.length) return null;
  const text = ["Đề xuất chia QC:", ...plan.map((x) => `- ${x.i.id} ${titleOf(x.i).slice(0, 60)} → ${x.who}`)].join("\n");
  return (
    <Card title="Gợi ý chia QC" meta={<Button size="xs" variant="ghost" onClick={() => void copy(text, "phân công")}><Copy /> Copy</Button>}>
      <p className="text-xs text-ink-3">{plan.length} ticket chờ test chưa có QC, giao cho người đang giữ ít ticket test nhất. Bấm để mở ticket và gán.</p>
      <ol className="grid grid-cols-1 divide-y divide-rule/60">
        {plan.slice(0, 12).map(({ i, who, n }) => (
          <li key={i.id}>
            <button type="button" onClick={() => y.openTicket(i.id, plan.map((x) => x.i))} className="flex w-full items-baseline gap-2 py-1.5 text-left text-sm hover:bg-paper-2">
              <span className="shrink-0 font-mono text-xs text-ink-3">{i.id}</span>
              <span className="min-w-0 flex-1 truncate">{titleOf(i)}</span>
              <span className="shrink-0 text-xs"><b className="font-medium">{who}</b> <span className="text-ink-3">· đang giữ {n}</span></span>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}
