"use client";

import { ArrowRight, Bookmark, CornerDownLeft, Filter, Plus, Search, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fold, useNow } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { AI_MAX, rank, riskOf, ticketId, yt } from "@/lib/yt";
import { reportData } from "@/lib/yt-stats";
import { StatePill } from "./bits";
import { useStats } from "./dashboard";
import { type Page, useYt } from "./state";
import { aiFilterApply, applyView, readViews } from "./tickets";

// ⌘K anywhere in the YouTrack tab: open a ticket, go to a page, switch mode, and the one place to ask the AI about the
// current scope or turn a sentence into ticket filters.

export const PAGE_LABEL: Record<Page, string> = { home: "Trang chủ", tickets: "Ticket", dash: "Dashboard", people: "Thành viên", ai: "Lịch sử AI" };

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="dim" aria-hidden className="fixed inset-0 z-50 bg-(--scrim)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div key="box" role="dialog" aria-modal aria-label="Lệnh nhanh" initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }} className="fixed top-[12vh] left-1/2 z-50 grid w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card)] bg-cotton shadow-pop">
            <Body onClose={onClose} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

type Item = { key: string; group: string; label: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; run: () => void };

function Body({ onClose }: { onClose: () => void }) {
  const y = useYt();
  const d = useStats();
  const now = useNow();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);
  const go = (f: () => void) => () => { onClose(); f(); };

  const items = useMemo(() => {
    const t = q.trim(), terms = fold(t).split(/\s+/).filter(Boolean), out: Item[] = [];
    if (t && y.aiOn) {
      out.push({ key: "ask", group: "AI", icon: <Sparkles className="text-hl-2" />, label: <>Hỏi AI: <b>“{t}”</b></>, hint: "về các ticket đang mở trong phạm vi đang xem, kèm số liệu dashboard",
        run: go(() => {
          // the open tickets of the scope, the ones needing someone first
          const ids = [...d.sprintOpen].sort((a, b) => +!riskOf(a, now) - +!riskOf(b, now) || rank(a) - rank(b) || b.updated - a.updated).slice(0, AI_MAX).map((i) => i.id);
          const pick = ids.length ? ids : y.rows.filter((i) => !i.resolved).slice(0, AI_MAX).map((i) => i.id);
          if (!pick.length) return;
          y.setSheet({ kind: "work", title: `Hỏi AI · ${t.slice(0, 60)}`, ids: pick, auto: { label: `AI đang đọc ${pick.length} ticket`, q: t,
            run: (sig) => yt.aiTickets(pick, `${d.per.label} (ticket đang mở)`, "ask", sig, t, reportData(d, y.wip)) } });
        }) });
      out.push({ key: "filter", group: "AI", icon: <Filter className="text-hl-2" />, label: <>Lọc ticket bằng AI: <b>“{t}”</b></>, hint: "vd. bug critical của tôi sprint này",
        run: go(() => { y.setPage("tickets"); void aiFilterApply(y, t); }) });
    }
    if (t && !y.config?.mock) out.push({ key: "create", group: "Tạo", icon: <Plus />, label: <>Tạo ticket: <b>“{t.slice(0, 80)}”</b></>, hint: y.aiOn ? "AI soạn tiêu đề, Type, Priority và mô tả theo mẫu" : undefined, run: go(() => y.setNewTicket(t)) });
    for (const v of readViews()) if (!terms.length || terms.every((x) => fold(v.name).includes(x))) out.push({ key: `view:${v.name}`, group: "View đã lưu", icon: <Bookmark />, label: v.name, run: go(() => applyView(y, v)) });
    const id = t && ticketId(t, y.project);
    if (id) out.push({ key: `id:${id}`, group: "Ticket", icon: <ArrowRight />, label: <>Mở <b className="font-mono">{id}</b></>, run: go(() => y.openTicket(id)) });
    if (terms.length) {
      const hits = y.rows.filter((i) => { const h = fold(`${i.id} ${i.summary}`); return terms.every((x) => h.includes(x)); })
        .sort((a, b) => +!!a.resolved - +!!b.resolved || b.updated - a.updated).slice(0, 8);
      for (const i of hits) if (i.id !== id) out.push({ key: i.id, group: "Ticket", label: <span className="flex min-w-0 items-center gap-2"><b className="shrink-0 font-mono text-xs">{i.id}</b><span className={cn("truncate", i.resolved && "text-ink-3 line-through")}>{i.summary}</span></span>,
        hint: <StatePill state={i.state} />, run: go(() => y.openTicket(i.id, hits)) });
      if (y.page !== "tickets") out.push({ key: "search", group: "Ticket", icon: <Search />, label: <>Tìm “{t}” trong bảng ticket</>, run: go(() => { y.setPage("tickets"); y.setFilters({ q: t }); }) });
    }
    const nav: [string, () => void][] = [
      ...(Object.keys(PAGE_LABEL) as Page[]).filter((p) => p !== "ai" || y.aiOn).map((p) => [`Đi tới ${p === "home" ? ({ dev: "Hôm nay", qa: "Kiểm thử", po: "Brief" } as const)[y.mode] : PAGE_LABEL[p]}`, () => y.setPage(p)] as [string, () => void]),
      ["Làm mới dữ liệu", y.refresh],
      ...(!y.config?.mock ? [["Tạo ticket mới", () => y.setNewTicket("")] as [string, () => void]] : []),
    ];
    for (const [l, f] of nav) if (!terms.length || terms.every((x) => fold(l).includes(x))) out.push({ key: l, group: "Đi tới", icon: <ArrowRight />, label: l, run: go(f) });
    return out;
  }, [q, y, d, now]); // eslint-disable-line react-hooks/exhaustive-deps -- go() closes over onClose only

  const cur = Math.min(at, Math.max(0, items.length - 1));
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-k="${cur}"]`)?.scrollIntoView({ block: "nearest" }); }, [cur]);
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((cur + 1) % Math.max(1, items.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((cur - 1 + items.length) % Math.max(1, items.length)); }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); items[cur]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  }
  let last = "";
  return (
    <>
      <label className="flex items-center gap-2 border-b border-rule px-3">
        <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} onKeyDown={onKey} maxLength={500} aria-label="Lệnh, ticket hoặc câu hỏi cho AI"
          placeholder={y.aiOn ? "Gõ ID, tiêu đề, trang… hoặc một câu hỏi cho AI" : "Gõ ID, tiêu đề hoặc tên trang"} className="h-12 flex-1 bg-transparent text-[0.9375rem] outline-none" />
        <kbd className="rounded border border-rule px-1.5 font-mono text-xs text-ink-3">Esc</kbd>
      </label>
      <div ref={list} role="listbox" className="grid max-h-[60vh] overflow-y-auto p-1.5">
        {items.map((x, k) => {
          const head = x.group !== last ? (last = x.group) : null;
          return (
            <div key={x.key} className="contents">
              {head && <div className="px-2 pt-2 pb-1 text-xs font-medium text-ink-3">{head}</div>}
              <button type="button" role="option" aria-selected={k === cur} data-k={k} onMouseMove={() => setAt(k)} onClick={x.run}
                className={cn("flex min-h-10 items-center gap-2.5 rounded-[var(--radius-input)] px-2.5 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-3", k === cur && "bg-hl-wash")}>
                {x.icon}
                <span className="grid min-w-0 flex-1"><span className="truncate">{x.label}</span>{typeof x.hint === "string" && <span className="truncate text-xs text-ink-3">{x.hint}</span>}</span>
                {typeof x.hint !== "string" && x.hint}
                {k === cur && <CornerDownLeft className="ml-1" aria-hidden />}
              </button>
            </div>
          );
        })}
        {!items.length && <p className="px-3 py-6 text-center text-sm text-ink-3">Không có kết quả.</p>}
      </div>
    </>
  );
}
