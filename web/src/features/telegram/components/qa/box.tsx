"use client";

import { Send } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { AiPromptBox } from "@/shared/components/ai/chat";
import { useMention } from "@/shared/components/mention";
import { groupMembers } from "@/features/telegram/lib/mentions";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { type Message } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { getPref, put } from "@/shared/lib/prefs";
import { hasTag, nameTags, who } from "@/features/telegram/lib/qa";

/** A group's unsent box text: read / written from handlers without re-rendering the page; saved for reloads 300 ms
 *  after the last keystroke (`flush` on leaving). */
export function draftStore(key: string) {
  let v = getPref(key) ?? "";
  let t: ReturnType<typeof setTimeout> | undefined;
  const subs = new Set<() => void>();
  const flush = () => { clearTimeout(t); put(key, v.trim() ? v : null); };
  return {
    get: () => v,
    set: (x: string) => { v = x; subs.forEach((f) => f()); clearTimeout(t); t = setTimeout(flush, 300); },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    flush,
  };
}
export type Draft = ReturnType<typeof draftStore>;

/** The Q&A prompt box: the only part that re-renders as you type. */
export function QaBox({ chatId, draft, onSend, busy, to, title, top }: {
  chatId: string; draft: Draft; onSend: (text: string) => void; busy: boolean; to: Message | null; title?: string;
  top: (text: string) => React.ReactNode;
}) {
  const tx = useT();
  const typed = useSyncExternalStore(draft.sub, draft.get, draft.get);
  const known = useMemo(() => nameTags(to), [to]); // the nudge's "@Name" of the question's tags
  const mention = useMention(groupMembers(chatId), typed, draft.set, known);
  const text = mention.wire(typed); // as sent: a member tagged by name counts as a tag
  const send = () => onSend(text);
  return (
    <AiPromptBox value={typed} onChange={draft.set} onSend={send} maxLength={4000} mention={mention}
      aria-label={to ? tx("Trả lời trong chuỗi") : tx("Câu hỏi mới")}
      placeholder={to ? tx("Trả lời {who}…", { who: who(to) }) : tx("Hỏi {title}… (tag @tên người được hỏi)", { title: title ?? tx("nhóm") })}
      top={top(text)}
      tools={!to && (hasTag(text)
        ? <span className="text-ink-3">{tx.n("Có tag: tự thêm mã {code} ở cuối tin", { code: <span className="font-mono">#QA…</span> })}</span>
        : <span className="text-ink-3">{tx.n("Tag người được hỏi ({at}) để mở Q&A; không tag thì gửi như tin thường", { at: <span className="font-mono">{tx("@tên")}</span> })}</span>)}
      actions={
        <Hint side="bottom" text={to ? tx("Gửi trả lời (Enter, Shift+Enter xuống dòng)") : tx("Đăng câu hỏi vào nhóm (Enter, Shift+Enter xuống dòng)")}>
          <Button size="sm" className="rounded-full bg-hl" disabled={!text.trim() || busy} aria-busy={busy} onClick={send}>
            <Send />{to ? tx("Trả lời") : tx("Đăng")}
          </Button>
        </Hint>
      } />
  );
}
