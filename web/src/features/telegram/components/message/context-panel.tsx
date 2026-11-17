"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { DeepBadge, DeepPick, useDeepTask } from "@/features/telegram/components/deep-think";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { api, errorText, type Message } from "@/shared/lib/api";
import { smooth } from "@/shared/lib/utils";
import { cn } from "@/shared/lib/utils";
import { useT } from "@/shared/lib/i18n";
import { MEDIA, nameColor, richText } from "@/features/telegram/components/message/rich-text";

/** Messages around a tag, read live from Telegram (not stored). `focus`: drawn in place of the tag's own line (always shown, even when the rest can't load).
 *  `reveal`: opened under a list row, where a long message leaves it off-screen: scroll it into view, again once loaded (it grows). */
export function ContextPanel({ m, className, focus, reveal }: { m: Message; className?: string; focus?: React.ReactNode; reveal?: boolean }) {
  const q = useQuery({
    queryKey: ["context", m.chat_id, m.message_id],
    queryFn: ({ signal }) =>
      api<Message[]>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/context`, { signal }),
    staleTime: 60_000,
  });
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (reveal) box.current?.scrollIntoView({ block: "nearest", behavior: smooth() }); }, [reveal, q.isPending]);
  const inList = !!q.data?.some((c) => c.message_id === m.message_id);
  return (
    <div ref={box} aria-label={t("Ngữ cảnh")} className={cn("mt-2 grid max-h-72 gap-1.5 overflow-y-auto rounded-md bg-paper-3/60 p-3 text-sm leading-relaxed", className)}>
      {q.isPending && (
        <div className="grid gap-2" aria-label={t("Đang lấy tin xung quanh từ Telegram…")}>
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-3" style={{ width: `${90 - i * 20}%` }} />)}
        </div>
      )}
      {q.isError && <p className="text-error">{errorText(q.error, {}, t("Không lấy được (cần đang kết nối Telegram)."))}</p>}
      {focus && !inList && focus}
      {q.data?.map((c) => focus && c.message_id === m.message_id ? <div key={c.message_id} className="contents">{focus}</div> : (
        <ContextLine key={c.message_id} c={c} focused={c.message_id === m.message_id} />
      ))}
    </div>
  );
}

/** One message of the thread; a tag marked done or one checked with Đối chiếu BE gets a green edge and its mark.
 *  Memoised: the reply panel re-renders on every streamed AI chunk, the thread lines don't need to. */
const ContextLine = memo(function ContextLine({ c, focused }: { c: Message; focused: boolean }) {
  const t = useT();
  const deep = !!useDeepTask(c);
  return (
    <p className={cn("whitespace-pre-wrap break-words", focused ? "-mx-1.5 rounded-sm bg-hl-wash px-1.5 text-ink"
      : deep || c.handled ? "-mx-1.5 rounded-sm border-l-2 border-ok bg-ok-wash/60 pr-1.5 pl-1 text-ink" : "text-ink-2")}>
      <DeepPick m={c} className="float-right -my-1 ml-1" />
      <span className="font-bold" style={c.outgoing ? undefined : { color: nameColor(c.sender_name ?? "?") }}>
        {c.outgoing ? t("Bạn") : (c.sender_name ?? "?")}:
      </span>{" "}
      {c.handled && (
        <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-ok-wash px-1.5 align-[1px] text-xs leading-5 font-medium text-ok">
          <CheckCheck className="size-3" aria-hidden /> {t("Đã xử lý")}
        </span>
      )}
      <DeepBadge m={c} className="mr-1 align-[1px]" />
      {c.text ? richText(c) : (c.media_kind ? `[${t(MEDIA[c.media_kind] ?? "Tệp đính kèm")}]` : "")}
    </p>
  );
});
