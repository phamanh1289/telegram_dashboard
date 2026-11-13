"use client";

import { ArrowRight, Bookmark, Eye, Filter, Inbox, MessageCircleQuestion, Plus, Search, Sparkles, Sun } from "lucide-react";
import { AiBotIcon } from "@/components/ai/chat";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { matches, PaletteDialog, type PaletteItem, PaletteList } from "@/components/ui/palette";
import { type Key, useT } from "@/lib/i18n";
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

export const PAGE_LABEL: Record<Page, Key> = { home: "Trang chủ", tickets: "Ticket", dash: "Dashboard", release: "Release", people: "Thành viên", ai: "Lịch sử AI" };

/** The Telegram module's pages, in this sidebar and ⌘K too: one nav for both modules. */
export const TG_PAGES = [["/?chat=__today__", "Hôm nay", Sun], ["/?chat=__all__", "Việc cần xử lý", Inbox], ["/?chat=__qa__", "Q&A", MessageCircleQuestion],
  ["/?chat=__briefing__", "Briefing", Sparkles], ["/?chat=__tasks__", "AI Agent", AiBotIcon]] as const;

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <PaletteDialog open={open} onClose={onClose}><Body onClose={onClose} /></PaletteDialog>;
}

function Body({ onClose }: { onClose: () => void }) {
  const t = useT();
  const y = useYt();
  const router = useRouter();
  const d = useStats();
  const now = useNow();
  const [q, setQ] = useState("");
  const go = (f: () => void) => () => { onClose(); f(); };

  const items = useMemo(() => {
    const text = q.trim(), terms = fold(text).split(/\s+/).filter(Boolean), out: PaletteItem[] = [];
    if (text && y.aiOn) {
      out.push({ key: "ask", group: "AI", icon: <Sparkles className="text-hl-2" />, label: t.n("Hỏi AI: {q}", { q: <b>“{text}”</b> }), hint: t("về các ticket đang mở trong phạm vi đang xem, kèm số liệu dashboard"),
        run: go(() => {
          // the open tickets of the scope, the ones needing someone first
          const ids = [...d.sprintOpen].sort((a, b) => +!riskOf(a, now) - +!riskOf(b, now) || rank(a) - rank(b) || b.updated - a.updated).slice(0, AI_MAX).map((i) => i.id);
          const pick = ids.length ? ids : y.rows.filter((i) => !i.resolved).slice(0, AI_MAX).map((i) => i.id);
          if (!pick.length) return;
          y.setSheet({ kind: "work", title: t("Hỏi AI · {q}", { q: text.slice(0, 60) }), ids: pick, auto: { label: t("AI đang đọc {n} ticket", { n: pick.length }), q: text,
            run: (sig) => yt.aiTickets(pick, `${d.per.label} (ticket đang mở)`, "ask", sig, text, reportData(d, y.wip)) } });
        }) });
      out.push({ key: "filter", group: "AI", icon: <Filter className="text-hl-2" />, label: t.n("Lọc ticket bằng AI: {q}", { q: <b>“{text}”</b> }), hint: t("vd. bug critical của tôi sprint này"),
        run: go(() => { y.setPage("tickets"); void aiFilterApply(y, text); }) });
    }
    if (text && !y.config?.mock) out.push({ key: "create", group: t("Tạo"), icon: <Plus />, label: t.n("Tạo ticket: {q}", { q: <b>“{text.slice(0, 80)}”</b> }), hint: y.aiOn ? t("AI soạn tiêu đề, Type, Priority và mô tả theo mẫu") : undefined, run: go(() => y.setNewTicket(text)) });
    for (const v of readViews()) if (matches(terms, v.name)) out.push({ key: `view:${v.name}`, group: t("View đã lưu"), icon: <Bookmark />, label: v.name, run: go(() => applyView(y, v)) });
    if (y.mode !== "dev" || y.me) for (const v of roleViews(y)) if (matches(terms, `${v[0]} ${t(v[0])} góc nhìn view`)) out.push({ key: `role:${v[0]}`, group: t("Góc nhìn"), icon: <Eye />, label: t(v[0]), hint: t(v[1]), run: go(() => applyRoleView(y, v)) });
    const id = text && ticketId(text, y.project);
    if (id) out.push({ key: `id:${id}`, group: "Ticket", icon: <ArrowRight />, label: t.n("Mở {id}", { id: <b className="font-mono">{id}</b> }), run: go(() => y.openTicket(id)) });
    if (terms.length) {
      const hits = y.rows.filter((i) => matches(terms, `${i.id} ${i.summary}`))
        .sort((a, b) => +!!a.resolved - +!!b.resolved || b.updated - a.updated).slice(0, 8);
      for (const i of hits) if (i.id !== id) out.push({ key: i.id, group: "Ticket", label: <span className="flex min-w-0 items-center gap-2"><b className="shrink-0 font-mono text-xs">{i.id}</b><span className={cn("truncate", i.resolved && "text-ink-3 line-through")}>{i.summary}</span></span>,
        hint: <StatePill state={i.state} />, run: go(() => y.openTicket(i.id, hits)) });
      if (y.page !== "tickets") out.push({ key: "search", group: "Ticket", icon: <Search />, label: t("Tìm “{q}” trong bảng ticket", { q: text }), run: go(() => { y.setPage("tickets"); y.setFilters({ q: text }); }) });
    }
    // [Vietnamese label (the key, so both languages find it), shown label, action]
    const nav: [string, string, () => void][] = [
      ...(([["me", "Của tôi"], ["team", "Team"], ["group", "Nhóm chọn"]] as const).filter(([s]) => s === "group" || y.me).map(([s, l]) => [`Phạm vi: ${l}`, t("Phạm vi: {name}", { name: t(l) }), () => y.setScope(s)] as [string, string, () => void])),
      ...(Object.keys(PAGE_LABEL) as Page[]).filter((p) => p !== "ai" || y.aiOn).map((p) => { const l = p === "home" ? ({ dev: "Hôm nay", qa: "Kiểm thử", po: "Tổng quan" } as const)[y.mode] : PAGE_LABEL[p]; return [`Đi tới ${l}`, t("Đi tới {name}", { name: t(l) }), () => y.setPage(p)] as [string, string, () => void]; }),
      ["Làm mới dữ liệu", t("Làm mới dữ liệu"), y.refresh],
      ...(!y.config?.mock ? [["Tạo ticket mới", t("Tạo ticket mới"), () => y.setNewTicket("")] as [string, string, () => void]] : []),
    ];
    for (const [k, l, f] of nav) if (matches(terms, `${k} ${l}`)) out.push({ key: k, group: t("Đi tới"), icon: <ArrowRight />, label: l, run: go(f) });
    for (const [href, l] of TG_PAGES) if (matches(terms, `${l} ${t(l)} telegram`)) out.push({ key: href, group: "Telegram", icon: <ArrowRight />, label: `Telegram › ${t(l)}`, run: go(() => router.push(href)) });
    return out;
  }, [q, y, d, now, t.lang]); // eslint-disable-line react-hooks/exhaustive-deps -- go() closes over onClose only; t follows t.lang

  return <PaletteList q={q} onQuery={setQ} items={items} label={t("Lệnh, ticket hoặc câu hỏi cho AI")}
    placeholder={t(y.aiOn ? "Gõ ID, tiêu đề, trang… hoặc một câu hỏi cho AI" : "Gõ ID, tiêu đề hoặc tên trang")} />;
}
