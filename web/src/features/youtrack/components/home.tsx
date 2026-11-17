"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Copy, RotateCw, Send, Sparkles, Trash2, UserCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { fmtDay, type T, tMaybe, useT } from "@/shared/lib/i18n";
import { Told } from "@/features/telegram/lib/inbox";
import { useSaveBriefing } from "@/features/telegram/components/briefing/run";
import { useNow } from "@/shared/hooks/use-now";
import { copyText, toast } from "@/shared/lib/notifications";
import { ymd } from "@/shared/lib/time";
import { getPref, put, setPref } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { AI_MAX, type AiReq, bucket, bugSpike, DAY, type Focus, isBlocked, isBug, isBuilt, needsPo, qaList, rank, riskOf, shortName, tagsOf, type Ticket, titleOf, todayList, UNASSIGNED, when, yt } from "@/features/youtrack/lib/yt";
import { Card, Label, Markdown, Prio, StatePill, Tag } from "./bits";
import { Segmented } from "@/shared/components/ui/segmented";
import { Hint } from "@/shared/components/ui/hint";
import { day0 } from "@/features/youtrack/lib/yt-stats";
import { Aging, Attention, Kpis, Progress, QcState, useQc, useStats, Wip } from "./dashboard";
import { ReportCard } from "./report";
import { setPerson } from "./sheet";
import { useYt } from "./state";

// Each mode's home: Dev "Hôm nay" (my tickets in the order to do them), QA "Kiểm thử" (what to test / triage first),
// PO "Brief" (team state, backlog, what waits on the PO). One AI Studio card per home.

const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };

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
    bugsFixed: n((i) => isBug(i) && !!i.resolved && i.resolved >= from), bugsNew: n((i) => isBug(i) && i.created >= from), people,
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
  const [k, setK] = useState(() => { const v = getPref(`ytAiTab:${id}`); return tabs.some((x) => x.k === v) ? v! : tabs[0].k; });
  const t = useT();
  const tab = tabs.find((x) => x.k === k) ?? tabs[0];
  const key = `ytAi:${id}:${tab.k}:${tab.weekly ? monday() : ymd()}`;
  const [ver, setVer] = useState(0); // bumped on save / delete: the answer is read from prefs for the current tab and day
  const saved = useMemo(() => { try { return JSON.parse(getPref(key) ?? "null") as Saved | null; } catch { return null; } }, [key, ver]); // eslint-disable-line react-hooks/exhaustive-deps -- ver re-reads
  const setSaved = (v: Saved | null) => { setPref(key, v && JSON.stringify(v)); setVer((n) => n + 1); };
  function pick(v: string) { setK(v); setPref(`ytAiTab:${id}`, v); }
  const send = useSaveBriefing();
  // every run opens the AI session; a saved answer opens there too, so it can be followed up
  const open = (fresh: boolean) => y.setSheet({ kind: "work", title: `AI · ${tab.label}`, ids: (tab.ids ?? []).slice(0, AI_MAX), auto: {
    label: tab.busy, run: tab.run, seed: !fresh && saved ? { text: saved.text, req: saved.req ?? null } : undefined,
    onDone: (r) => { setPref(key, JSON.stringify({ text: r.text, at: Date.now(), req: r.req } satisfies Saved)); setVer((n) => n + 1); },
  } });
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-hl-2" />AI Studio</span>}
      meta={saved ? t("{x} lúc {w}", { x: tab.label, w: when(saved.at) }) : undefined} className="border border-hl/25">
      <Segmented id={`ai-studio-${id}`} label={t("Việc của AI")} value={tab.k} onChange={pick} items={tabs.map((x) => ({ value: x.k, label: x.label, title: x.hint }))} className="flex-wrap justify-self-start" />
      {saved ? <div className="line-clamp-6"><Markdown text={saved.text} onTicket={(i) => y.openTicket(i)} /></div>
        : <p className="text-sm text-ink-2">{tab.disabled ?? tab.hint}</p>}
      <div className="flex gap-1.5">
        {saved && <Button size="sm" onClick={() => open(false)}><Sparkles /> {t("Mở phiên AI")}</Button>}
        <Button size="sm" variant={saved ? "outline" : "default"} disabled={!!tab.disabled} onClick={() => open(true)}>
          {saved ? <><RotateCw /> {t("Làm lại")}</> : <><Sparkles /> {tab.label}</>}
        </Button>
        {saved && tab.k === "standup" && (
          <Hint side="bottom" text={t("Gửi standup vào Saved Messages trên Telegram của bạn (đọc trên điện thoại, chuyển tiếp vào nhóm)")}>
            <Button size="sm" variant="ghost" disabled={send.isPending} onClick={() => send.mutate(saved.text)}><Send /> Saved Messages</Button>
          </Hint>
        )}
        {saved && <Hint side="bottom" text={t("Xóa nội dung AI đã lưu")}><Button size="sm" variant="ghost" onClick={() => setSaved(null)}><Trash2 /> {t("Xóa")}</Button></Hint>}
      </div>
    </Card>
  );
}

/** The one standup (Dev and QA): my tickets touched since the last working day (Friday on Mondays) and the ones still
 *  open, as assignee (Dev) or QC (QA); the server adds my Telegram replies and finished AI Agent sessions. */
function standupTab(t: T, rows: Ticket[], me: string | null, qa: boolean, now: number): Tab {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() === 1 ? 3 : 1));
  const since = d.getTime();
  const mine = (i: Ticket) => (qa ? i.qc : i.assignee) === me;
  const ids = [...new Set([...rows.filter((i) => mine(i) && i.updated >= since).sort((a, b) => b.updated - a.updated),
    ...rows.filter((i) => mine(i) && !i.resolved)].map((i) => i.id))].slice(0, AI_MAX);
  return { k: "standup", label: "Standup", busy: t("AI đang viết standup"), disabled: ids.length ? undefined : t("Chưa có ticket nào của bạn."),
    hint: t("Hôm qua / Hôm nay / Vướng mắc từ ticket bạn cập nhật từ ngày làm việc trước, tin bạn đã trả lời trên Telegram và phiên AI Agent đã xong. Gửi vào Saved Messages hoặc dán thẳng vào nhóm."),
    ids, run: (sig) => yt.aiTickets(ids, `Ticket của ${me}${qa ? " (QC)" : ""}`, "standup", sig, "", undefined, since) };
}

type Lens = "all" | "risk" | "doing" | "qc" | "block" | "test";

export function DevHome() {
  const y = useYt();
  const t = useT();
  const now = useNow();
  // the header scope (My task / My team / Group): its people's tickets; no one picked = everyone
  const names = y.filters.assignee;
  const ours = useCallback((i: Ticket) => !names.length || names.includes(i.assignee ?? UNASSIGNED), [names]);
  const own = y.scope === "me";
  const full = useMemo(() => todayList(y.rows, y.me, ours, y.since, now), [y.rows, y.me, ours, y.since, now]);
  // handed to QC = off my plate: the default list keeps only the ones I test; the lenses still see them all
  const list = useMemo(() => full.filter((x) => bucket(x.i) !== 2 || x.i.qc === y.me), [full, y.me]);
  const mine = useMemo(() => y.rows.filter((i) => !i.resolved && ours(i)), [y.rows, ours]);
  const { loadSince } = y;
  useEffect(() => { const doing = mine.filter((i) => bucket(i) === 1); if (doing.length) loadSince(doing); }, [mine, loadSince]);
  const [lens, setLens] = useState<Lens>("all");
  const LENS: Record<Lens, [string, (i: Ticket) => boolean]> = {
    all: [t("Đang mở"), ours], risk: [t("Cần xử lý ngay"), (i) => ours(i) && !!riskOf(i, now)],
    doing: [t("Đang làm"), (i) => ours(i) && bucket(i) === 1],
    qc: [t("Chờ QC"), (i) => ours(i) && bucket(i) === 2], block: ["Blocked", (i) => ours(i) && isBlocked(i)],
    test: [t("Chờ bạn test"), (i) => i.qc === y.me && i.assignee !== y.me && bucket(i) === 2],
  };
  // the risk lens leads each row with why it is urgent (riskOf), the rest keep their ranking reasons
  const shown = lens === "all" ? list : lens === "risk"
    ? full.filter((x) => LENS.risk[1](x.i)).map((x) => { const r = riskOf(x.i, now)!; return { ...x, why: [r, ...x.why.filter((w) => w !== r)] }; })
    : full.filter((x) => LENS[lens][1](x.i));
  if (!y.me) return (
    <p className="rounded-lg bg-cotton p-6 text-sm text-ink-2 shadow-stock">
      {t.n("Chưa biết bạn là ai trên YouTrack. Kiểm tra token trong {a}, hoặc đổi vai trò trong {b}.", {
        a: <Link href="/settings/#youtrack" className="text-hl-2 underline underline-offset-2">{t("Cài đặt › YouTrack")}</Link>,
        b: <Link href="/settings/#general" className="text-hl-2 underline underline-offset-2">{t("Cài đặt › Chung")}</Link>,
      })}
    </p>
  );
  const recent = [...mine].sort((a, b) => b.updated - a.updated).slice(0, 5);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="grid content-start gap-4">
        {/* the figures are the list's lens: one card, a click narrows "Hôm nay làm gì" below */}
        <LensBar label={t("Lọc danh sách hôm nay")} value={lens} onChange={setLens} lenses={(Object.keys(LENS) as Lens[]).map((l) => [l, LENS[l][0],
          l === "all" ? list.length : l === "test" ? y.rows.filter((i) => !i.resolved && LENS.test[1](i)).length : mine.filter(LENS[l][1]).length,
          l === "block" ? "text-error" : l === "test" || l === "risk" ? "text-signal-2" : ""])} />
        <Card title={t("Hôm nay làm gì")} meta={lens === "all" ? t("{n} ticket, xếp theo mức gấp", { n: list.length }) : <button type="button" onClick={() => setLens("all")} className="hover:text-ink">{t("{x}: {n}, bỏ lọc", { x: LENS[lens][0], n: shown.length })}</button>}>
          <FocusList key={lens} list={shown} now={now} top={lens === "all" ? t("Làm ngay") : ""} empty={lens === "all" ? t(own ? "Không có ticket nào đang mở của bạn." : "Không có ticket nào đang mở trong phạm vi.") : t("Không có ticket nào ở mục này.")} />
        </Card>
      </div>
      <div className="grid content-start gap-4">
        {y.aiOn && (
          <AiStudio key={`dev:${y.project}`} id={`dev:${y.project}`} tabs={[
            { k: "today", label: t("Kế hoạch"), busy: t("AI đang đọc {n} ticket", { n: Math.min(list.length, AI_MAX) }), disabled: list.length ? undefined : t("Không có ticket nào để lập kế hoạch."),
              hint: t("AI đọc mô tả, bình luận và tin Telegram của các ticket trên để chọn việc làm ngay, việc cần trả lời, chỗ đang kẹt."),
              ids: list.slice(0, AI_MAX).map((x) => x.i.id), run: (sig) => yt.aiTickets(list.slice(0, AI_MAX).map((x) => x.i.id), y.scope === "me" ? `Ticket của ${y.me}` : `Ticket của ${names.join(", ") || "cả nhóm"}`, "today", sig) },
            standupTab(t, y.rows, y.me, false, now),
          ]} />
        )}
        <Card title={t("Mới cập nhật")} meta={t(own ? "ticket của bạn" : "ticket trong phạm vi")}>
          {recent.length ? (
            <ul className="zebra grid gap-0.5">
              {recent.map((i) => (
                <li key={i.id} className="rounded-md"><button type="button" onClick={() => y.openTicket(i.id, recent)} className="grid w-full gap-1 rounded-md px-2 py-1.5 text-left hover:bg-paper-2">
                  <Title i={i} clamp="truncate" />
                  <span className="flex items-center gap-2 text-xs"><span className="font-mono text-ink-3">{i.id}</span><StatePill state={i.state} /><span className="ml-auto text-ink-3">{when(i.updated)}</span></span>
                </button></li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-3">{t("Chưa có.")}</p>}
        </Card>
        <ReportCard />
      </div>
    </div>
  );
}

/** Figures that are also the list's lens: a click narrows the list below, a second click (or "all") clears it. */
function LensBar<L extends string>({ label, lenses, value, onChange }: { label: string; lenses: [L, string, number | null, string][]; value: L; onChange: (l: L) => void }) {
  const all = lenses[0][0];
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] divide-x divide-rule overflow-hidden rounded-[var(--radius-card)] bg-cotton shadow-stock max-sm:grid-cols-3 max-sm:divide-x-0">
      {lenses.map(([l, name, n, tone]) => (
        <button key={l} type="button" role="radio" aria-checked={value === l} onClick={() => onChange(value === l ? all : l)}
          className={cn("relative grid justify-items-start gap-0.5 px-3 py-2.5 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2", value === l && l !== all && "bg-hl-wash")}>
          {value === l && l !== all && <i aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-hl" />}
          <span className="max-w-full truncate text-xs text-ink-3">{name}</span>
          <b className={cn("font-mono text-2xl font-medium tabular-nums", n == null ? "text-error" : n > 0 && tone)}>{n ?? "—"}</b>
        </button>
      ))}
    </div>
  );
}

/** A ranked ticket list; with `top`, the first three are headed by it and the rest by "Tiếp theo". */
export const PAGE = 20;

/** The ranked list, 20 a page: page 1 opens with the "top" few; numbers stay global. Pages slide in the direction moved. */
function FocusList({ list, top, empty, now }: { list: Focus[]; top: string; empty: string; now: number }) {
  const t = useT();
  const [[page, dir], setPage] = useState([0, 0]);
  const calm = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const pages = Math.ceil(list.length / PAGE);
  const p = Math.min(page, Math.max(0, pages - 1)); // the list shrank (a ticket moved on): stay in range
  if (!list.length) return <p className="text-sm text-ink-3">{empty}</p>;
  const all = list.map((x) => x.i);
  const from = p * PAGE, shown = list.slice(from, from + PAGE);
  const parts = top && p === 0 ? [[top, shown.slice(0, 3), 0], [t("Tiếp theo"), shown.slice(3), 3]] as const : [["", shown, from]] as const;
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
              <ol className={cn("grid", top && p === 0 && base === 0 ? "gap-0.5 rounded-lg bg-hl-wash/50 p-1 ring-1 ring-hl/20" : "zebra divide-y divide-rule/60")}>
                {part.map(({ i, why }, k) => (
                  <motion.li key={i.id} layout="position" initial={{ opacity: 0, y: calm ? 0 : 4 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(base - from + k, 12) * 0.02, duration: 0.2, layout: { duration: 0.25 } }}>
                    <FocusRow i={i} why={why} n={base + k + 1} all={all} top={!!top && p === 0 && base === 0} now={now} />
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
export function Pager({ page, pages, total, onGo }: { page: number; pages: number; total: number; onGo: (n: number) => void }) {
  // first, last, and the pages around the current one; gaps become …
  const t = useT();
  const nums = [...new Set([0, page - 1, page, page + 1, pages - 1])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const btn = "grid h-7 min-w-7 place-items-center rounded-md px-1.5 font-mono text-xs tabular-nums transition-colors duration-(--dur-micro)";
  return (
    <nav aria-label={t("Trang")} className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-2.5"
      onKeyDown={(e) => { if (e.key === "ArrowLeft") onGo(page - 1); if (e.key === "ArrowRight") onGo(page + 1); }}>
      <span className="text-xs text-ink-3 tabular-nums">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} / {total}</span>
      <div className="flex items-center gap-0.5">
        <Button size="icon-xs" variant="ghost" disabled={page === 0} onClick={() => onGo(page - 1)} aria-label={t("Trang trước")}><ChevronLeft /></Button>
        {nums.map((n, k) => (
          <Fragment key={n}>
            {k > 0 && n - nums[k - 1] > 1 && <span className="px-0.5 text-xs text-ink-3" aria-hidden>…</span>}
            <button type="button" onClick={() => onGo(n)} aria-current={n === page ? "page" : undefined} aria-label={t("Trang {n}", { n: n + 1 })}
              className={cn(btn, n === page ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>{n + 1}</button>
          </Fragment>
        ))}
        <Button size="icon-xs" variant="ghost" disabled={page >= pages - 1} onClick={() => onGo(page + 1)} aria-label={t("Trang sau")}><ChevronRight /></Button>
      </div>
    </nav>
  );
}

type QaLens = "queue" | "mine" | "retest" | "noqc" | "bugs" | "mybugs" | "critical";

export function QaHome() {
  const y = useYt();
  const t = useT();
  const d = useStats();
  const now = useNow();
  const open = useMemo(() => y.rows.filter((i) => !i.resolved), [y.rows]);
  const { loadSince } = y;
  useEffect(() => { const waiting = open.filter((i) => bucket(i) === 2); if (waiting.length) loadSince(waiting); }, [open, loadSince]);
  const qc = useQc();
  const fails = useMemo(() => { const m = new Map<string, number>(); for (const x of qc.fail) m.set(x.id, (m.get(x.id) || 0) + 1); return m; }, [qc.fail]);
  const ranked = useMemo(() => qaList(open, y.me, y.since, now, fails), [open, y.me, y.since, now, fails]);
  const LENS: Record<QaLens, [string, (i: Ticket) => boolean, string]> = {
    queue: [t("Chờ test"), (i) => bucket(i) === 2, ""], mine: [t("Chờ tôi test"), (i) => !!y.me && i.qc === y.me && bucket(i) === 2, "text-signal-2"],
    retest: [t("Test lại"), (i) => bucket(i) === 2 && fails.has(i.id), "text-signal-2"],
    noqc: [t("Chưa có QC"), (i) => bucket(i) === 2 && !i.qc, "text-warn"], bugs: [t("Bug đang mở"), isBug, ""],
    mybugs: [t("Bug tôi log"), (i) => !!y.me && isBug(i) && i.reporter === y.me, ""],
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
          <button type="button" onClick={() => y.setSheet({ kind: "list", title: t("Bug mới 7 ngày"), rows: spike.rows })}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-signal-wash px-3 py-2 text-left text-sm text-signal-ink shadow-edge hover:bg-signal-wash/70">
            <AlertTriangle className="size-4 text-signal-2" aria-hidden />
            <b>{t("Bug tăng đột biến:")}</b>
            <span>{t("{n} bug mới 7 ngày (trung bình {a}/tuần)", { n: spike.n, a: spike.avg })}</span>
            {spike.mods.slice(0, 4).map(([m, n]) => <span key={m} className="rounded-full bg-paper-3 px-2 text-xs leading-5 font-medium">{tMaybe(m)}: {n}</span>)}
          </button>
        )}
        <LensBar label={t("Lọc hàng đợi kiểm thử")} value={lens} onChange={setLens}
          lenses={(Object.keys(LENS) as QaLens[]).map((l) => [l, LENS[l][0], l === "retest" && qc.q.isError ? null : ranked.filter((x) => LENS[l][1](x.i)).length, LENS[l][2]])} />
        <Card title={t(lens === "mybugs" ? "Bug tôi đã log, còn mở" : lens === "bugs" || lens === "critical" ? "Bug cần xử lý" : "Hàng đợi test")}
          meta={lens === "queue" ? t("{n} ticket, xếp theo mức gấp", { n: shown.length }) : <button type="button" onClick={() => setLens("queue")} className="hover:text-ink">{t("{x}: {n}, bỏ lọc", { x: LENS[lens][0], n: shown.length })}</button>}>
          <FocusList key={lens} list={shown} now={now} top={lens === "queue" ? t("Test ngay") : ""} empty={t("Không có ticket nào ở mục này.")} />
        </Card>
      </div>
      <div className="grid content-start gap-4">
        {y.aiOn && (
          <AiStudio key={`qa:${y.project}`} id={`qa:${y.project}`} tabs={[
            standupTab(t, y.rows, y.me, true, now),
            { k: "testcases", label: "Test case", busy: t("AI đang viết test case cho {n} ticket", { n: testIds.length }), disabled: testIds.length ? undefined : t("Không có ticket nào chờ test."),
              hint: t(mine.length ? "Test case (luồng chính, biên, lỗi), vùng regression và câu cần hỏi cho các ticket chờ bạn test, tối đa {n} ticket gấp nhất." : "Test case (luồng chính, biên, lỗi), vùng regression và câu cần hỏi cho các ticket chờ test, tối đa {n} ticket gấp nhất.", { n: TESTS }),
              ids: testIds, run: (sig) => yt.aiTickets(testIds, mine.length ? `Ticket chờ ${y.me} test` : "Ticket chờ test", "testcases", sig) },
            { k: "triage", label: "Bug triage", busy: t("AI đang đọc {n} bug", { n: Math.min(bugs.length, AI_MAX) }), disabled: bugs.length ? undefined : t("Không có bug nào đang mở."),
              hint: t("Bug thiếu bước tái hiện / log / thiết bị, nên đổi priority, có vẻ trùng, có thể đã fix, cần ping ai."),
              ids: bugs.slice(0, AI_MAX).map((x) => x.i.id), run: (sig) => yt.aiTickets(bugs.slice(0, AI_MAX).map((x) => x.i.id), "Bug đang mở", "triage", sig) },
            { k: "regression", label: "Regression", busy: t("AI đang đọc {n} ticket chờ release", { n: Math.min(built.length, AI_MAX) }), disabled: built.length ? undefined : t("Không có ticket nào đã build / chờ release."),
              hint: t("Checklist regression cho bản sắp phát hành từ các ticket Built / Done on dev / Waiting to release: smoke test, theo màn hình, rủi ro cao."),
              ids: built.slice(0, AI_MAX).map((x) => x.i.id), run: (sig) => yt.aiTickets(built.slice(0, AI_MAX).map((x) => x.i.id), "Ticket đã build, chờ release", "regression", sig) },
            { k: "quality", label: t("Chất lượng ticket"), busy: t("AI đang rà {n} ticket", { n: Math.min(upstream.length, AI_MAX) }), disabled: upstream.length ? undefined : t("Sprint đang xem không còn ticket nào chưa tới QC."),
              hint: t("Ticket của {s} chưa tới bước test: thiếu tiêu chí nghiệm thu, bug thiếu bước tái hiện, nên tách, chưa estimate, có vẻ trùng.", { s: d.per.label }),
              ids: upstream.slice(0, AI_MAX).map((i) => i.id), run: (sig) => yt.aiTickets(upstream.slice(0, AI_MAX).map((i) => i.id), `${d.per.label}, chưa tới QC`, "quality", sig) },
          ]} />
        )}
        <QcMine qc={qc} waiting={mine.map((x) => x.i)} retest={ranked.filter((x) => LENS.retest[1](x.i)).map((x) => x.i)} />
        <QcSplit open={open} />
        <Card title={t("Bug 7 ngày qua")}>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {([["Mới", week.created, week.created > week.fixed ? "text-error" : ""], ["Đã fix", week.fixed, "text-ok"], ["Đang mở", bugs.length, ""]] as const).map(([l, n, tone]) => (
              <div key={l} className="grid gap-0.5 rounded-md bg-paper-2 py-2"><dt className="text-xs text-ink-3">{t(l)}</dt><dd className={cn("font-mono text-2xl tabular-nums", n > 0 && tone)}>{n}</dd></div>
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

function FocusRow({ i, why, n, all, top, now }: { i: Ticket; why: string[]; n: number; all: Ticket[]; top: boolean; now: number }) {
  const y = useYt();
  const hot = isBlocked(i) || (!!i.due && i.due < now) || rank(i) <= 1;
  return (
    <button type="button" onClick={() => y.openTicket(i.id, all)}
      className={cn("group/row relative grid w-full grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-md px-2.5 py-2 text-left transition-colors duration-(--dur-micro)",
        top ? "hover:bg-cotton" : "hover:bg-paper-2")}>
      {hot && <i aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-error" />}
      <span className={cn("row-span-2 grid size-7 place-items-center rounded-full font-mono text-xs font-bold tabular-nums",
        top ? "bg-hl text-hl-ink" : "text-ink-3 group-hover/row:text-ink-2")}>{n}</span>
      <Title i={i} clamp={top ? "line-clamp-2" : "truncate"} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <span className="font-mono text-ink-3">{i.id}</span><StatePill state={i.state} /><Prio p={i.priority} />
        {why.map((w) => <span key={w} className={cn("rounded-full px-2 leading-5 font-medium", hot ? "bg-error-wash text-error" : "bg-paper-3 text-ink-2")}>{tMaybe(w)}</span>)}
      </span>
    </button>
  );
}

export function PoHome() {
  const y = useYt();
  const t = useT();
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
              { k: "brief", label: "Brief", busy: t("AI đang đọc {n} ticket đang mở", { n: Math.min(d.sprintOpen.length, AI_MAX) }), disabled: d.sprintOpen.length ? undefined : t("Sprint đang xem không có ticket mở."),
                hint: t("AI đọc các ticket đang mở của {s}: việc tiếp theo từng người, chỗ nghẽn, cần chốt, cần ping ai, và những gì đã đổi từ lần brief trước.", { s: d.per.label }),
                ids: d.sprintOpen.map((i) => i.id), run: (sig) => sinceLast(`ytAiSnap:${y.project}:${d.per.label}`, d.sprintOpen, (changes) =>
                  yt.aiTickets(d.sprintOpen.slice(0, AI_MAX).map((i) => i.id), `${d.per.label} (ticket đang mở)`, "review", sig, "", undefined, 0, changes)) },
              { k: "plan", label: t("Lên sprint"), busy: t("AI đang xếp {n} ticket", { n: Math.min(backlog.length, AI_MAX) }), disabled: backlog.length ? undefined : t("Không có ticket mở nào ngoài sprint đang xem."),
                hint: t("Gợi ý ticket nên kéo vào sprint tới và giao cho ai, dựa trên priority, tải hiện tại (WIP) và velocity của team; kèm ticket chưa nên kéo vì thiếu spec / estimate."),
                ids: backlog.slice(0, AI_MAX).map((i) => i.id), run: (sig) => yt.aiTickets(backlog.slice(0, AI_MAX).map((i) => i.id), `Backlog ngoài ${d.per.label}`, "plan", sig, "", { wipLimit: y.wip, wip: d.wip, velocityAvgPerSprint: d.vel.avg, sprintNow: d.per.label }) },
              { k: "groom", label: "Grooming", busy: t("AI đang đọc {n} ticket backlog", { n: Math.min(backlog.length, AI_MAX) }), disabled: backlog.length ? undefined : t("Không có ticket mở nào ngoài sprint đang xem."),
                hint: t("Rà backlog: ticket đã sẵn sàng, cần làm rõ (hỏi ai, hỏi gì), nên tách / gộp, đề xuất priority, nên đóng."),
                ids: backlog.slice(0, AI_MAX).map((i) => i.id), run: (sig) => yt.aiTickets(backlog.slice(0, AI_MAX).map((i) => i.id), `Backlog ngoài ${d.per.label}`, "groom", sig) },
              { k: "weekly", label: t("Bản tin tuần"), weekly: true, busy: t("AI đang viết bản tin tuần"), disabled: y.rows.length ? undefined : t("Chưa có dữ liệu ticket."),
                hint: t("7 ngày qua: tổng quan, từng người xong gì / đang làm / kẹt, rủi ro tuần tới. Lưu cả tuần, dán thẳng vào Telegram."),
                run: (sig) => yt.aiData("weekly", weekData(y.rows, Date.now()), sig) },
              { k: "notes", label: "Release notes", busy: t("AI đang viết release notes"), disabled: d.doneRows.length ? undefined : t("Sprint đang xem chưa có ticket xong."),
                hint: t("Release notes từ ticket đã xong trong sprint: phần cho người dùng và danh sách nội bộ."),
                ids: d.doneRows.slice(0, AI_MAX).map((i) => i.id), run: (sig) => yt.aiData("notes", d.doneRows.slice(0, 300).map((i) => ({ id: i.id, type: i.type, summary: i.summary })), sig) },
            ]} />
          )}
          <Card title={t("Tiến độ sprint")} meta={t("vạch dọc = thời gian đã qua")}><Progress d={d} /></Card>
          <Card title={t("Cảnh báo ticket kéo dài")}><Aging d={d} /></Card>
        </div>
        <div className="grid content-start gap-4">
          <Card title={t("Chờ PO chốt")} meta="define / confirm">
            {waitPo.length ? (
              <ul className="zebra grid gap-0.5">
                {waitPo.slice(0, 8).map((i) => (
                  <li key={i.id} className="rounded-md"><button type="button" onClick={() => y.openTicket(i.id, waitPo)} className="grid w-full gap-1 rounded-md px-2 py-1.5 text-left hover:bg-paper-2">
                    <Title i={i} clamp="truncate" />
                    <span className="flex items-center gap-2 text-xs"><span className="font-mono text-ink-3">{i.id}</span><StatePill state={i.state} /><Prio p={i.priority} /><span className="ml-auto text-ink-3">{when(i.updated)}</span></span>
                  </button></li>
                ))}
                {waitPo.length > 8 && <li><button type="button" onClick={() => y.setSheet({ kind: "list", title: t("Chờ PO chốt"), rows: waitPo })} className="px-1.5 text-xs text-ink-3 hover:text-ink">{t("Xem cả {n} ticket", { n: waitPo.length })}</button></li>}
              </ul>
            ) : <p className="text-sm text-ink-3">{t("Không có ticket nào chờ định nghĩa / xác nhận.")}</p>}
          </Card>
          <Card title={t("Cần chú ý")} meta={t("ticket đang mở")}><Attention d={d} /></Card>
          <Card title={t("Công việc đang làm")} meta={`${t("ngưỡng WIP")} ${y.wip}`}><Wip d={d} /></Card>
        </div>
      </div>
    </div>
  );
}


/** My test results (from the State history: moves out of a test state I made), and a standup line to paste in Telegram. */
function QcMine({ qc, waiting, retest }: { qc: ReturnType<typeof useQc>; waiting: Ticket[]; retest: Ticket[] }) {
  const y = useYt();
  const t = useT();
  const now = useNow();
  if (!y.me) return null;
  if (!qc.q.data) return <Card title={t("Kết quả test của tôi")}><QcState q={qc.q} /></Card>;
  const today = day0(now);
  const of = (from: number) => {
    const v = qc.mine.filter((x) => x.at >= from);
    const ids = (k: "pass" | "fail") => [...new Set(v.filter((x) => x.kind === k).map((x) => x.id))];
    return { n: new Set(v.map((x) => x.id)).size, pass: ids("pass"), fail: ids("fail") };
  };
  const rows = [["Hôm nay", of(today)], ["24 giờ qua", of(now - DAY)], ["7 ngày", of(now - 7 * DAY)]] as const;
  const day = rows[1][1];
  const standup = [
    `Standup QC · ${y.me} · ${fmtDay(now)}`,
    t("- 24h qua đã test {n} ticket", { n: day.n }) + (day.pass.length ? `; pass: ${day.pass.join(", ")}` : "") + (day.fail.length ? t("; trả lại: {x}", { x: day.fail.join(", ") }) : ""),
    t("- Chờ tôi test: {n}", { n: waiting.length }) + (waiting.length ? ` (${waiting.slice(0, 8).map((i) => i.id).join(", ")})` : ""),
    ...(retest.length ? [t("- Test lại sau khi dev sửa: {x}", { x: retest.slice(0, 8).map((i) => i.id).join(", ") })] : []),
  ].join("\n");
  return (
    <Card title={t("Kết quả test của tôi")} meta={<Button size="xs" variant="ghost" onClick={() => void copyText(standup, t("Đã chép standup"))}><Copy /> Copy standup</Button>}>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {rows.map(([l, r]) => (
          <div key={l} className="grid gap-0.5 rounded-md bg-paper-2 py-2">
            <dt className="text-xs text-ink-3">{t(l)}</dt>
            <dd className="font-mono text-2xl tabular-nums">{r.n}</dd>
            <dd className="text-xs text-ink-3"><button type="button" disabled={!r.pass.length} className="text-ok enabled:hover:underline"
              onClick={() => y.setSheet({ kind: "list", title: t("Tôi đã pass: {x}", { x: t(l) }), rows: r.pass.map((id) => qc.rowOf.get(id)!) })}>{r.pass.length} pass</button>
              {", "}<button type="button" disabled={!r.fail.length} className={cn(r.fail.length && "text-error", "enabled:hover:underline")}
              onClick={() => y.setSheet({ kind: "list", title: t("Tôi đã trả lại: {x}", { x: t(l) }), rows: r.fail.map((id) => qc.rowOf.get(id)!) })}>{t("{n} trả", { n: r.fail.length })}</button></dd>
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
  const t = useT();
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
  const [busy, setBusy] = useState(false);
  if (!plan.length) return null;
  const text = [t("Đề xuất chia QC:"), ...plan.map((x) => `- ${x.i.id} ${titleOf(x.i).slice(0, 60)} → ${x.who}`)].join("\n");
  const write = !y.config?.mock;
  const login = (who: string) => y.loginOf.get(who);
  /** Every suggestion at once (5 calls at a time); one toast puts them all back. */
  async function all() {
    setBusy(true);
    const done: string[] = [], fail: string[] = [], todo = plan.filter((x) => login(x.who));
    for (let k = 0; k < todo.length; k += 5) await Promise.all(todo.slice(k, k + 5).map((x) =>
      yt.setAssignee(x.i.id, login(x.who)!, "QC").then((tk) => { void y.patchTicket(tk); done.push(x.i.id); }, (e: Error) => { fail.push(`${x.i.id}: ${e.message}`); })));
    setBusy(false);
    const noLogin = plan.length - todo.length; // the suggested person is not in the project's team list
    const why = [noLogin ? t("{n} chưa có login YouTrack của người được gợi ý", { n: noLogin }) : "", fail.length ? t("lỗi {n} — {e}", { n: fail.length, e: fail[0] }) : ""].filter(Boolean).join("; ");
    toast({ text: t("Đã gán QC {a}/{b} ticket", { a: done.length, b: plan.length }) + (why ? ` (${why})` : ""), undo: done.length ? async () => {
      const bad: string[] = [];
      for (const id of done) await yt.setAssignee(id, null, "QC").then(y.patchTicket, (e: Error) => { bad.push(`${id}: ${e.message}`); });
      if (bad.length) throw new Told(`${bad.length < done.length ? t("Chỉ hoàn tác được {a}/{b} ticket", { a: done.length - bad.length, b: done.length }) : t("Không hoàn tác được")} — ${bad[0]}`);
    } : undefined });
  }
  return (
    <Card title={t("Gợi ý chia QC")} meta={<span className="flex items-center gap-1">
      {write && <Hint side="bottom" text={t("Gán QC cho mọi ticket theo gợi ý dưới đây")}><Button size="xs" variant="ghost" disabled={busy} aria-busy={busy} onClick={() => void all()}><UserCheck /> {t("Gán hết")}</Button></Hint>}
      <Button size="xs" variant="ghost" onClick={() => void copyText(text, t("Đã chép phân công"))}><Copy /> Copy</Button>
    </span>}>
      <p className="text-xs text-ink-3">{t("{n} ticket chờ test chưa có QC, giao cho người đang giữ ít ticket test nhất. Bấm “Gán” để đặt QC trên YouTrack.", { n: plan.length })}</p>
      <ol className="zebra grid grid-cols-1 divide-y divide-rule/60">
        {plan.slice(0, 12).map((x) => (
          <li key={x.i.id} className="flex items-center gap-2">
            <button type="button" onClick={() => y.openTicket(x.i.id, plan.map((p) => p.i))} className="flex min-w-0 flex-1 items-baseline gap-2 py-1.5 text-left text-sm hover:text-hl-2">
              <span className="shrink-0 font-mono text-xs text-ink-3">{x.i.id}</span>
              <span className="min-w-0 flex-1 truncate">{titleOf(x.i)}</span>
              <span className="shrink-0 text-xs"><b className="font-medium">{shortName(x.who)}</b> <span className="text-ink-3">{t("đang giữ {n}", { n: x.n })}</span></span>
            </button>
            {write && login(x.who) && <Button size="xs" variant="outline" disabled={busy} onClick={() => void setPerson(y, x.i, "QC", login(x.who)!)} aria-label={t("Gán QC {id} cho {who}", { id: x.i.id, who: x.who })}>{t("Gán")}</Button>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
