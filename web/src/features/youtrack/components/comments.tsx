"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { useDocTag } from "@/features/docs/components/doc-tag";
import { ytPeople } from "@/features/youtrack/lib/mentions";
import { type Attachment, type Comment, DAY, when, yt } from "@/features/youtrack/lib/yt";
import { useJoin, useMention } from "@/shared/components/mention";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Textarea } from "@/shared/components/ui/textarea";
import { useNow } from "@/shared/hooks/use-now";
import { useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { ago } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { Avatar, Label, Markdown } from "./bits";
import { useYt } from "./state";

// A ticket's comments: one thread on a guide line (who, when, what they wrote), the box to add one as its last entry.

/** An entry of a thread (comments, Telegram mentions): the avatar column (its line runs down to the next entry), then the entry itself. */
export const ENTRY = "grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3";
export function Rail({ name, line }: { name: string; line: boolean }) {
  return (
    <span className="flex flex-col items-center gap-1.5">
      <Avatar name={name} className="size-7" />
      {line && <i aria-hidden className="w-px flex-1 rounded-full bg-rule-2" />}
    </span>
  );
}

/** An entry's first line: who, "Tôi" on my own, `meta` (where it was said), when (within a day: how long ago). */
export function Who({ name, mine, meta, at, now }: { name: string; mine: boolean; meta?: string; at: number; now: number }) {
  const t = useT();
  return (
    <span className="flex min-h-7 items-center gap-2">
      <b className="truncate text-sm font-bold text-ink">{name}</b>
      {mine && <span className="shrink-0 rounded-[4px] bg-hl-wash px-1.5 text-2xs leading-[18px] font-medium text-hl-2">{t("Tôi")}</span>}
      {meta && <span className="min-w-0 shrink-[2] truncate text-xs text-ink-2">{meta}</span>}
      <time dateTime={new Date(at).toISOString()} className="ml-auto shrink-0 text-xs text-ink-3 tabular-nums">{now - at < DAY ? ago(at, now) : when(at)}</time>
    </span>
  );
}

/** `comments` undefined: still loading (`pending`) or the ticket failed to load (the sheet says so). `draft`: an AI
 *  answer the user chose to send as a comment. `write`: a token is set, the box shows. */
export function Comments({ id, comments, pending, failed, files, draft, write }: {
  id: string; comments?: Comment[]; pending: boolean; failed: boolean; files: Attachment[]; draft?: string; write: boolean;
}) {
  const t = useT();
  const y = useYt();
  const qc = useQueryClient();
  const now = useNow();
  const calm = useReducedMotion();
  const [text, setText] = useState(draft ?? "");
  const [sending, setSending] = useState(false);
  const { attach, ...mention } = useJoin(useMention(ytPeople(id.split("-")[0]), text, setText), useDocTag("youtrack", text, setText)); // "@" tags the project's team, "#" links a document

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await yt.comment(id, mention.wire(body)); // a "#" document's title goes as its link
      setText("");
      toast({ text: t("Đã gửi bình luận") });
      await qc.invalidateQueries({ queryKey: ["yt", "detail", id] });
    } catch (e) { toast({ text: t("Không gửi được: {msg}", { msg: (e as Error).message }) }); }
    finally { setSending(false); }
  }

  const n = comments?.length ?? 0, live = comments?.filter((c) => !c.deleted).length; // a deleted one keeps its place, not its count
  return (
    <section className="grid gap-3">
      <Label>{t("Bình luận ({n})", { n: live ?? (failed ? "—" : "…") })}</Label>
      {pending && !comments && (
        <div aria-label={t("Đang đọc bình luận…")} className="grid gap-4">
          {[88, 64].map((w) => (
            <div key={w} className={ENTRY}>
              <Skeleton className="size-7 rounded-full" />
              <div className="grid gap-2 py-1"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3.5" style={{ width: `${w}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      {comments && !n && <p className="text-sm text-ink-3 italic">{t("Chưa có bình luận")}</p>}
      {(n > 0 || write) && (
        <ol className="grid">
          {comments && (
            <AnimatePresence initial={false}>{/* the ones already there just show; one sent since grows in */}
              {comments.map((c, k) => {
                const who = c.author || "—", mine = !!y.me && c.author === y.me;
                return (
                  <motion.li key={c.id ?? k} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                    transition={{ duration: calm ? 0 : 0.22, ease: [0.2, 0, 0, 1] }} className={cn(ENTRY, "overflow-hidden")}>
                    <Rail name={who} line={write || k < n - 1} />
                    <div className={cn("min-w-0", (write || k < n - 1) && "pb-5")}>
                      <Who name={who} mine={mine} at={c.created} now={now} />
                      {c.deleted ? <p className="text-sm text-ink-3 italic">{t("Bình luận này đã bị xóa")}</p>
                        : <Markdown text={c.text} files={{ issue: id, list: files, comment: c.id }} />}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          )}
          {write && (
            <li className={ENTRY}>
              <Rail name={y.me || "?"} line={false} />
              <div className="relative rounded-[var(--radius-card)] border border-rule-2 bg-cotton transition-[border-color] duration-(--dur-micro) hover:border-ink-3 has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:-outline-offset-1 has-[textarea:focus-visible]:outline-(--color-focus)">
                {mention.popup}
                {mention.top && <div className="px-2 pt-2">{mention.top}</div>}
                <Textarea ref={attach} rows={2} maxLength={20000} value={text} aria-label={t("Bình luận mới")} placeholder={t("Viết bình luận (gửi lên YouTrack, ⌘↵ gửi, @ để tag, # chèn tài liệu)…")}
                  className="min-h-14 border-0 bg-transparent focus-visible:outline-none"
                  onChange={(e) => { setText(e.target.value); mention.track(e); }} onSelect={mention.track}
                  onKeyDown={(e) => { if (mention.onKeyDown(e)) return; if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !sending) { e.preventDefault(); void send(); } }} />
                <div className="flex justify-end px-2 pb-2">
                  <Button size="sm" disabled={!text.trim() || sending} aria-busy={sending} onClick={() => void send()}><MessageSquareText /> {t("Gửi bình luận")}</Button>
                </div>
              </div>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
