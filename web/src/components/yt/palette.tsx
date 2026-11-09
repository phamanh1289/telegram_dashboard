"use client";

import { ArrowRight, Bookmark, Bot, Eye, Filter, Inbox, MessageCircleQuestion, Plus, Search, Sparkles, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { matches, PaletteDialog, type PaletteItem, PaletteList } from "@/components/ui/palette";
import { fold, useNow } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { AI_MAX, rank, riskOf, ticketId, yt } from "@/lib/yt";
import { reportData } from "@/lib/yt-stats";
import { StatePill } from "./bits";
import { useStats } from "./dashboard";
import { type Page, useYt } from "./state";
import { aiFilterApply, applyRoleView, applyView, readViews, roleViews } from "./tickets";

// ⌘K anywhere in the YouTrack tab: open a ticket, go to a page, switch mode, and the one place to ask the AI about the
// current scope or turn a sentence into ticket filters.

export const PAGE_LABEL: Record<Page, string> = { home: "Trang chủ", tickets: "Ticket", dash: "Dashboard", release: "Release", people: "Thành viên", ai: "Lịch sử AI" };

/** The Telegram module's pages, in this sidebar and ⌘K too: one nav for both modules. */
export const TG_PAGES = [["/?chat=__today__", "Hôm nay", Sun], ["/?chat=__all__", "Việc cần xử lý", Inbox], ["/?chat=__qa__", "Q&A", MessageCircleQuestion],
  ["/?chat=__briefing__", "Briefing", Sparkles], ["/?chat=__tasks__", "AI Agent", Bot]] as const;

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <PaletteDialog open={open} onClose={onClose}><Body onClose={onClose} /></PaletteDialog>;
}

function Body({ onClose }: { onClose: () => void }) {
  const y = useYt();
  const router = useRouter();
  const d = useStats();
  const now = useNow();
  const [q, setQ] = useState("");
  const go = (f: () => void) => () => { onClose(); f(); };

  const items = useMemo(() => {
    const t = q.trim(), terms = fold(t).split(/\s+/).filter(Boolean), out: PaletteItem[] = [];
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
    for (const v of readViews()) if (matches(terms, v.name)) out.push({ key: `view:${v.name}`, group: "View đã lưu", icon: <Bookmark />, label: v.name, run: go(() => applyView(y, v)) });
    if (y.mode !== "dev" || y.me) for (const v of roleViews(y)) if (matches(terms, `${v[0]} góc nhìn view`)) out.push({ key: `role:${v[0]}`, group: "Góc nhìn", icon: <Eye />, label: v[0], hint: v[1], run: go(() => applyRoleView(y, v)) });
    const id = t && ticketId(t, y.project);
    if (id) out.push({ key: `id:${id}`, group: "Ticket", icon: <ArrowRight />, label: <>Mở <b className="font-mono">{id}</b></>, run: go(() => y.openTicket(id)) });
    if (terms.length) {
      const hits = y.rows.filter((i) => matches(terms, `${i.id} ${i.summary}`))
        .sort((a, b) => +!!a.resolved - +!!b.resolved || b.updated - a.updated).slice(0, 8);
      for (const i of hits) if (i.id !== id) out.push({ key: i.id, group: "Ticket", label: <span className="flex min-w-0 items-center gap-2"><b className="shrink-0 font-mono text-xs">{i.id}</b><span className={cn("truncate", i.resolved && "text-ink-3 line-through")}>{i.summary}</span></span>,
        hint: <StatePill state={i.state} />, run: go(() => y.openTicket(i.id, hits)) });
      if (y.page !== "tickets") out.push({ key: "search", group: "Ticket", icon: <Search />, label: <>Tìm “{t}” trong bảng ticket</>, run: go(() => { y.setPage("tickets"); y.setFilters({ q: t }); }) });
    }
    const nav: [string, () => void][] = [
      ...(([["me", "Của tôi"], ["team", "Team"], ["group", "Nhóm chọn"]] as const).filter(([s]) => s === "group" || y.me).map(([s, l]) => [`Phạm vi: ${l}`, () => y.setScope(s)] as [string, () => void])),
      ...(Object.keys(PAGE_LABEL) as Page[]).filter((p) => p !== "ai" || y.aiOn).map((p) => [`Đi tới ${p === "home" ? ({ dev: "Hôm nay", qa: "Kiểm thử", po: "Tổng quan" } as const)[y.mode] : PAGE_LABEL[p]}`, () => y.setPage(p)] as [string, () => void]),
      ["Làm mới dữ liệu", y.refresh],
      ...(!y.config?.mock ? [["Tạo ticket mới", () => y.setNewTicket("")] as [string, () => void]] : []),
    ];
    for (const [l, f] of nav) if (matches(terms, l)) out.push({ key: l, group: "Đi tới", icon: <ArrowRight />, label: l, run: go(f) });
    for (const [href, l] of TG_PAGES) if (matches(terms, `${l} telegram`)) out.push({ key: href, group: "Telegram", icon: <ArrowRight />, label: `Telegram › ${l}`, run: go(() => router.push(href)) });
    return out;
  }, [q, y, d, now]); // eslint-disable-line react-hooks/exhaustive-deps -- go() closes over onClose only

  return <PaletteList q={q} onQuery={setQ} items={items} label="Lệnh, ticket hoặc câu hỏi cho AI"
    placeholder={y.aiOn ? "Gõ ID, tiêu đề, trang… hoặc một câu hỏi cho AI" : "Gõ ID, tiêu đề hoặc tên trang"} />;
}
