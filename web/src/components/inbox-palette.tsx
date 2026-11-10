"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, Bug, CheckCheck, Search, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { useChats } from "@/components/chat-list";
import { matches, PaletteDialog, type PaletteItem, PaletteList } from "@/components/ui/palette";
import { type Chat, errorText } from "@/lib/api";
import { t as tPlain, tMaybe, useT } from "@/lib/i18n";
import { fold, markAllHandled, sessionId, sessionMatches, TASKS, taskListQuery, toast } from "@/lib/inbox";
import { ticketId } from "@/lib/yt";

// ⌘K / Ctrl+K in the Telegram inbox: jump to a group or a page, act on the open group, open an AI Agent session or a
// YouTrack ticket by ID, or search the tags.

type Ctx = {
  chats: Chat[];
  views: readonly (readonly [string, string, ...unknown[]])[]; // [id, label, …] of the sidebar's pages
  group: Chat | null; // the open group, if any
  range: string;
  onGo: (id: string, focus?: string) => void;
  onDigest?: () => void;
  onSearch: (q: string) => void;
};

export function InboxPalette({ open, onClose, ...ctx }: Ctx & { open: boolean; onClose: () => void }) {
  return <PaletteDialog open={open} onClose={onClose}><Body onClose={onClose} {...ctx} /></PaletteDialog>;
}

function Body({ onClose, chats, views, group, range, onGo, onDigest, onSearch }: Ctx & { onClose: () => void }) {
  const t = useT();
  const { qaHidden } = useChats(range);
  const [q, setQ] = useState("");
  const tasks = useQuery(taskListQuery).data;
  const router = useRouter();
  // Built every render: a few dozen rows, cheaper than keeping a memo's deps stable.
  const go = (f: () => void) => () => { onClose(); f(); };
  const qt = q.trim(), terms = fold(qt).split(/\s+/).filter(Boolean), out: PaletteItem[] = [];
  const hit = (s: string) => matches(terms, s);
  const id = /^\d+$/.test(qt) ? null : ticketId(qt, ""); // the same rule as YouTrack's own ⌘K (a bare number needs a project)
  if (id) {
    out.push({ key: `yt:${id}`, group: "YouTrack", icon: <Bug />, label: t.n("Mở ticket {id}", { id: <b className="font-mono">{id}</b> }), run: go(() => router.push(`/youtrack/?ticket=${id}`)) });
  }
  if (/^#?(?:ref|ai)-?\w/i.test(qt)) {
    for (const s of (tasks ?? []).filter((x) => sessionMatches(x, qt)).slice(0, 6)) {
      out.push({ key: `ai:${s.id}`, group: t("Phiên AI Agent"), icon: <Bot />, hint: s.chat_title ?? undefined,
        label: <><b className="font-mono">{sessionId(s)}</b> {s.title || s.message_text || s.prompt}</>, run: go(() => onGo(TASKS, s.id)) });
    }
  }
  for (const c of [...chats].filter((c) => hit(c.title)).sort((a, b) => b.pending_count - a.pending_count).slice(0, terms.length ? 8 : 5)) {
    out.push({ key: `chat:${c.chat_id}`, group: t("Nhóm"), icon: <Users />, label: c.title,
      hint: c.pending_count ? <span className="font-mono text-xs text-ink-3 tabular-nums">{t("{n} chờ", { n: c.pending_count })}</span> : undefined, run: go(() => onGo(c.chat_id)) });
  }
  for (const [v, key] of views) {
    const yt = v.startsWith("/"); // a YouTrack page: the same ⌘K reaches both modules
    const label = tMaybe(key); // the sidebar's labels are i18n keys: match both languages, show the current one
    if (hit(`${key} ${label}${yt ? " youtrack" : ""}`)) out.push({ key: `view:${v}`, group: yt ? "YouTrack" : t("Đi tới"), icon: <ArrowRight />, label: yt ? `YouTrack › ${label}` : label, run: go(() => (yt ? router.push(v) : onGo(v))) });
  }
  if (group) {
    const acts: PaletteItem[] = [
      ...(onDigest ? [{ key: "digest", group: t("Nhóm này"), icon: <Sparkles />, label: t("Digest: tóm tắt {group}", { group: group.title }), run: go(onDigest) }] : []),
      ...(group.pending_count ? [{ key: "done-all", group: t("Nhóm này"), icon: <CheckCheck />, label: t("Xong tất cả {n} tin của {group}", { n: group.pending_count, group: group.title }), hint: t("có Hoàn tác"),
        run: go(() => { markAllHandled(group.chat_id, range, qaHidden.get(group.chat_id)).catch((e) => toast({ text: errorText(e, {}, tPlain("Không cập nhật được, thử lại sau")) })); }) }] : []),
    ];
    out.push(...acts.filter((a) => hit(String(a.label))));
  }
  if (qt) out.push({ key: "search", group: t("Tìm"), icon: <Search />, label: t.n("Tìm tin tag: {q}", { q: <b>“{qt}”</b> }), hint: group ? t("trong {group}", { group: group.title }) : t("ở mọi nhóm"), run: go(() => onSearch(qt)) });
  return <PaletteList q={q} onQuery={setQ} items={out} label={t("Lệnh nhanh: nhóm, trang, ticket, phiên AI")}
    placeholder={t("Gõ tên nhóm, trang, VA-123, REF-xxxxxx… hoặc chữ cần tìm")} />;
}
