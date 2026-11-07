"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, Bug, CheckCheck, Search, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { matches, PaletteDialog, type PaletteItem, PaletteList } from "@/components/ui/palette";
import { type Chat, errorText } from "@/lib/api";
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
  const [q, setQ] = useState("");
  const tasks = useQuery(taskListQuery).data;
  const router = useRouter();
  // Built every render: a few dozen rows, cheaper than keeping a memo's deps stable.
  const go = (f: () => void) => () => { onClose(); f(); };
  const t = q.trim(), terms = fold(t).split(/\s+/).filter(Boolean), out: PaletteItem[] = [];
  const hit = (s: string) => matches(terms, s);
  const id = /^\d+$/.test(t) ? null : ticketId(t, ""); // the same rule as YouTrack's own ⌘K (a bare number needs a project)
  if (id) {
    out.push({ key: `yt:${id}`, group: "YouTrack", icon: <Bug />, label: <>Mở ticket <b className="font-mono">{id}</b></>, run: go(() => router.push(`/youtrack/?ticket=${id}`)) });
  }
  if (/^#?(?:ref|ai)-?\w/i.test(t)) {
    for (const s of (tasks ?? []).filter((x) => sessionMatches(x, t)).slice(0, 6)) {
      out.push({ key: `ai:${s.id}`, group: "Phiên AI Agent", icon: <Bot />, hint: s.chat_title ?? undefined,
        label: <><b className="font-mono">{sessionId(s)}</b> {s.title || s.message_text || s.prompt}</>, run: go(() => onGo(TASKS, s.id)) });
    }
  }
  for (const c of [...chats].filter((c) => hit(c.title)).sort((a, b) => b.pending_count - a.pending_count).slice(0, terms.length ? 8 : 5)) {
    out.push({ key: `chat:${c.chat_id}`, group: "Nhóm", icon: <Users />, label: c.title,
      hint: c.pending_count ? <span className="font-mono text-xs text-ink-3 tabular-nums">{c.pending_count} chờ</span> : undefined, run: go(() => onGo(c.chat_id)) });
  }
  for (const [v, label] of views) if (hit(label)) out.push({ key: `view:${v}`, group: "Đi tới", icon: <ArrowRight />, label, run: go(() => onGo(v)) });
  if (group) {
    const acts: PaletteItem[] = [
      ...(onDigest ? [{ key: "digest", group: "Nhóm này", icon: <Sparkles />, label: `Digest: tóm tắt ${group.title}`, run: go(onDigest) }] : []),
      ...(group.pending_count ? [{ key: "done-all", group: "Nhóm này", icon: <CheckCheck />, label: `Xong tất cả ${group.pending_count} tin của ${group.title}`, hint: "có Hoàn tác",
        run: go(() => { markAllHandled(group.chat_id, range).catch((e) => toast({ text: errorText(e, {}, "Không cập nhật được, thử lại sau") })); }) }] : []),
    ];
    out.push(...acts.filter((a) => hit(String(a.label))));
  }
  if (t) out.push({ key: "search", group: "Tìm", icon: <Search />, label: <>Tìm tin tag: <b>“{t}”</b></>, hint: group ? `trong ${group.title}` : "ở mọi nhóm", run: go(() => onSearch(t)) });
  return <PaletteList q={q} onQuery={setQ} items={out} label="Lệnh nhanh: nhóm, trang, ticket, phiên AI"
    placeholder="Gõ tên nhóm, trang, VA-123, REF-xxxxxx… hoặc chữ cần tìm" />;
}
