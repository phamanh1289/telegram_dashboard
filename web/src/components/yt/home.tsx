"use client";

import { RotateCw, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNow } from "@/lib/inbox";
import { getPref, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AI_MAX, bucket, isBlocked, rank, type Ticket, todayList, when, yt } from "@/lib/yt";
import { AiBox, Card, Markdown, Prio, StatePill, useAi } from "./bits";
import { Aging, AskAi, Attention, Kpis, useStats, Wip } from "./dashboard";
import { useYt } from "./state";

// Each mode's home: Dev "Hôm nay" (my tickets in the order to do them), Lead "Brief" (team state + AI brief).

const today = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD, local

/** An AI answer kept for the day (per browser), so opening the tab spends no quota; "Làm lại" reruns. */
function DailyAi({ cacheKey, title, label, hint, disabled, run }: {
  cacheKey: string; title: string; label: string; hint: string; disabled?: string; run: (sig: AbortSignal) => Promise<{ text: string }>;
}) {
  const key = `${cacheKey}:${today()}`;
  const [saved, setSaved] = useState<{ text: string; at: number } | null>(() => { try { return JSON.parse(getPref(key) ?? "null"); } catch { return null; } });
  const ai = useAi();
  async function go() {
    const r = await ai.run({ label, run });
    if (r?.text) {
      const v = { text: r.text, at: Date.now() };
      setPref(key, JSON.stringify(v));
      setSaved(v);
      ai.set({ status: "idle" });
    }
  }
  const busy = ai.s.status === "busy";
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-hl-2" />{title}</span>}
      meta={saved ? `lúc ${when(saved.at)}` : undefined} className="border border-hl/25 bg-linear-to-b from-hl-wash/40 to-cotton">
      {saved && ai.s.status !== "busy" && <Markdown text={saved.text} />}
      {!saved && ai.s.status === "idle" && <p className="text-sm text-ink-2">{disabled ?? hint}</p>}
      <AiBox ai={ai} />
      <Button size="sm" variant={saved ? "outline" : "default"} className="justify-self-start" disabled={busy || !!disabled} aria-busy={busy} onClick={() => void go()}>
        {saved ? <><RotateCw /> Làm lại</> : <><Sparkles /> {title}</>}
      </Button>
    </Card>
  );
}

export function DevHome() {
  const y = useYt();
  const now = useNow();
  const list = useMemo(() => todayList(y.rows, y.me, y.since, now), [y.rows, y.me, y.since, now]);
  const mine = useMemo(() => y.rows.filter((i) => !i.resolved && i.assignee === y.me), [y.rows, y.me]);
  const { loadSince } = y;
  useEffect(() => { const doing = mine.filter((i) => bucket(i) === 1); if (doing.length) loadSince(doing); }, [mine, loadSince]);
  const stat = [
    ["Đang mở", mine.length], ["Đang làm", mine.filter((i) => bucket(i) === 1).length], ["Chờ QC", mine.filter((i) => bucket(i) === 2).length],
    ["Blocked", mine.filter(isBlocked).length], ["Chờ bạn test", y.rows.filter((i) => !i.resolved && i.qc === y.me && bucket(i) === 2).length],
  ] as const;
  if (!y.me) return <p className="rounded-lg bg-cotton p-6 text-sm text-ink-2 shadow-stock">Chưa biết bạn là ai trên YouTrack. Kiểm tra token trong Cài đặt chung › YouTrack, hoặc chuyển sang chế độ Lead.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid content-start gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stat.map(([l, n]) => (
            <div key={l} className="rounded-[var(--radius-card)] bg-cotton px-3 py-2.5 shadow-stock">
              <div className="text-xs text-ink-3">{l}</div><b className={cn("font-mono text-2xl font-medium tabular-nums", l === "Blocked" && n > 0 && "text-error")}>{n}</b>
            </div>
          ))}
        </div>
        <Card title="Hôm nay làm gì" meta={`${list.length} ticket, xếp theo mức gấp`}>
          {list.length ? (
            <ol className="grid gap-1.5">
              {list.map(({ i, why }, k) => (
                <motion.li key={i.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(k, 10) * 0.025 }}>
                  <FocusRow i={i} why={why} n={k + 1} all={list.map((x) => x.i)} />
                </motion.li>
              ))}
            </ol>
          ) : <p className="text-sm text-ink-3">Không có ticket nào đang mở của bạn. 🎉</p>}
        </Card>
      </div>
      <div className="grid content-start gap-4">
        {y.aiOn && (
          <DailyAi cacheKey={`ytAiToday:${y.project}`} title="AI lập kế hoạch hôm nay" label={`AI đang đọc ${Math.min(list.length, AI_MAX)} ticket`}
            hint="AI đọc mô tả, bình luận và tin Telegram của các ticket trên để chọn việc làm ngay, việc cần trả lời, chỗ đang kẹt."
            disabled={list.length ? undefined : "Không có ticket nào để lập kế hoạch."}
            run={(sig) => yt.aiTickets(list.slice(0, AI_MAX).map((x) => x.i.id), `Ticket của ${y.me}`, "today", sig)} />
        )}
        <Card title="Mới cập nhật" meta="ticket của bạn, 5 gần nhất">
          <ul className="grid gap-1">
            {[...mine].sort((a, b) => b.updated - a.updated).slice(0, 5).map((i) => (
              <li key={i.id}><button type="button" onClick={() => y.openTicket(i.id, mine)} className="grid w-full gap-0.5 rounded px-1.5 py-1 text-left hover:bg-paper-2">
                <span className="flex items-center gap-2"><b className="font-mono text-xs">{i.id}</b><StatePill state={i.state} /><span className="ml-auto text-xs text-ink-3">{when(i.updated)}</span></span>
                <span className="truncate text-sm">{i.summary}</span>
              </button></li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function FocusRow({ i, why, n, all }: { i: Ticket; why: string[]; n: number; all: Ticket[] }) {
  const y = useYt();
  const now = useNow();
  const hot = isBlocked(i) || (!!i.due && i.due < now) || rank(i) <= 1;
  return (
    <button type="button" onClick={() => y.openTicket(i.id, all)}
      className={cn("grid w-full grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2",
        hot ? "border-error/25 bg-error-wash/25" : "border-rule bg-cotton")}>
      <span className={cn("row-span-2 grid size-7 place-items-center rounded-full font-mono text-xs font-semibold", n <= 3 ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2")}>{n}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <b className="font-mono text-xs">{i.id}</b><StatePill state={i.state} /><Prio p={i.priority} />
        <span className="flex flex-wrap gap-1">{why.map((w) => <span key={w} className="rounded-full bg-paper-3 px-2 text-[11px] leading-5 font-medium text-ink-2">{w}</span>)}</span>
      </span>
      <span className="line-clamp-2 text-sm">{i.summary}</span>
    </button>
  );
}

export function LeadHome() {
  const y = useYt();
  const d = useStats();
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-12 gap-3"><Kpis d={d} /></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="grid content-start gap-4">
          {y.aiOn && (
            <DailyAi cacheKey={`ytAiBrief:${y.project}:${d.per.label}`} title="AI brief cho team" label={`AI đang đọc ${Math.min(d.sprintOpen.length, AI_MAX)} ticket đang mở`}
              hint={`AI đọc các ticket đang mở của ${d.per.label}: việc cần làm tiếp theo từng người, chỗ nghẽn, cần chốt, cần ping ai. Dán thẳng vào standup.`}
              disabled={d.sprintOpen.length ? undefined : "Sprint đang xem không có ticket mở."}
              run={(sig) => yt.aiTickets(d.sprintOpen.slice(0, AI_MAX).map((i) => i.id), `${d.per.label} (ticket đang mở)`, "review", sig)} />
          )}
          <Card title="Cảnh báo ticket kéo dài"><Aging d={d} /></Card>
          {y.aiOn && <Card title="Hỏi AI về số liệu"><AskAi d={d} /></Card>}
        </div>
        <div className="grid content-start gap-4">
          <Card title="Cần chú ý" meta="ticket đang mở"><Attention d={d} /></Card>
          <Card title="Công việc đang làm" meta={`ngưỡng WIP ${y.wip}`}><Wip d={d} /></Card>
        </div>
      </div>
    </div>
  );
}
