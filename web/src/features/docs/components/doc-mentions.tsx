"use client";

import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Fold } from "@/shared/components/ui/fold";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { YtLogo } from "@/shared/components/yt-logo";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { linkCls, TicketChip } from "@/features/telegram/components/message/rich-text";
import { type Doc, type DocMention, docErrors, docMentionsQuery } from "@/features/docs/lib/docs";

// The open document's foot, as YouTrack's under an article: "Được nhắc ở đây" (the tickets and KB articles it names) and,
// for a KB article, "Nhắc tới bài này" (what names it on YouTrack). Read once it comes near the view, not on each open.
// An article ID opens it in the library or asks to add it (`anchor`, as in the text); a ticket is Telegram's chip.

export function DocMentions({ doc, anchor, onTicket }: {
  doc: Doc; anchor: (hash: string) => ReactNode; onTicket: (id: string) => void;
}) {
  const t = useT();
  const box = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const q = useQuery({ ...docMentionsQuery(doc.id), enabled: near });
  const out = q.data?.out ?? [], inward = q.data?.inward ?? [];
  if (q.data && !out.length && !inward.length) return <section ref={box} />; // nothing either way: no empty block

  const list = (title: string, rows: DocMention[]) => rows.length > 0 && (
    <div className="grid gap-1">
      <h3 className="text-xs text-ink-3">{title}</h3>
      <ul className="grid gap-0.5">
        {rows.map((m) => (
          <li key={`${m.kind}:${m.ref}`} className="flex min-w-0 items-baseline gap-2 py-0.5 text-sm">
            {m.kind === "article"
              ? <><YtLogo className="size-3.5 shrink-0 self-center" />{anchor(`doc:${m.ref}`)}</>
              : <TicketChip id={m.ref} more={<button type="button" onClick={() => onTicket(m.ref)} className={linkCls}>{t("Tài liệu nhắc ticket này")}</button>} />}
            <span className={cn("min-w-0 truncate text-ink", m.resolved && "text-ink-3 line-through")}>{m.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section ref={box} aria-label={t("Mục được nhắc")} className="mx-6 mb-8 border-t pt-3 @max-xl:mx-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 rounded-sm text-sm font-medium text-ink-2 hover:text-ink">
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform duration-(--dur-short) ease-(--ease-out)", open && "rotate-90")} />
        <span>{t("Được nhắc ở đây")} <span className="font-normal text-ink-3">{q.data ? out.length : "…"}</span></span>
        {doc.source === "youtrack" && <span>{t("Nhắc tới bài này")} <span className="font-normal text-ink-3">{q.data ? inward.length : "…"}</span></span>}
      </button>
      <Fold open={open}>
        <div className="grid gap-3 pt-2 pl-5">
          {q.isError ? <p role="alert" className="text-xs text-error">{errorText(q.error, docErrors())}</p>
            : !q.data ? <div className="grid gap-1.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-2/3" />)}</div>
              : <>{list(t("Được nhắc ở đây"), out)}{list(t("Nhắc tới bài này"), inward)}</>}
        </div>
      </Fold>
    </section>
  );
}
