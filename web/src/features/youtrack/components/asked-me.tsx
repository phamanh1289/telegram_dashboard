"use client";

import { MessageSquareText } from "lucide-react";
import { useAsked } from "@/features/youtrack/lib/trace";
import { snippet, when } from "@/features/youtrack/lib/yt";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { useT } from "@/shared/lib/i18n";
import { Card, Title } from "./bits";
import { useYt } from "./state";

/** Asked in a comment (useAsked): open tickets with a comment asking me, still unanswered. `po`: asks to the PO / PM
 *  count too. `card`: its own card (Dev / QA home), else a section at the bottom of "Chờ PO chốt" (PO home). */
export function AskedMe({ po = false, card = false }: { po?: boolean; card?: boolean }) {
  const t = useT();
  const y = useYt();
  const q = useAsked(y.project, po, !y.config?.mock);
  if (y.config?.mock) return null;
  const asked = q.data ?? [];
  const tickets = asked.map((a) => a.ticket);
  const body = q.isError ? <p role="alert" className="text-xs text-error">{t("Không đọc được bình luận: {msg}", { msg: (q.error as Error).message })}</p>
    : !q.data ? <div className="grid gap-1.5" aria-label={t("Đang đọc bình luận…")}><Skeleton className="h-3.5 w-11/12" /><Skeleton className="h-3.5 w-2/3" /></div>
    : !asked.length ? <p className="text-xs text-ink-3">{t("Không có bình luận nào chờ bạn trả lời.")}</p>
    : (
      <ul aria-label={t("Hỏi bạn trong bình luận")} className="zebra grid gap-0.5">
        {asked.slice(0, 6).map(({ ticket: i, ask }) => (
          <li key={i.id} className="rounded-md">
            <button type="button" onClick={() => y.openTicket(i.id, tickets)} className="grid w-full gap-1 rounded-md px-2 py-1.5 text-left hover:bg-paper-2">
              <Title i={i} clamp="truncate" />
              <span className="line-clamp-2 text-xs text-ink-2"><b className="font-medium text-ink">{ask.author ?? "?"}</b>: {snippet(ask.text)}</span>
              <span className="flex items-center gap-2 text-xs"><span className="font-mono text-ink-3">{i.id}</span><span className="ml-auto text-ink-3">{when(ask.created)}</span></span>
            </button>
          </li>
        ))}
        {asked.length > 6 && <li><button type="button" onClick={() => y.setSheet({ kind: "list", title: t("Hỏi bạn trong bình luận"), rows: tickets })} className="px-1.5 text-xs text-ink-3 hover:text-ink">{t("Xem cả {n} ticket", { n: asked.length })}</button></li>}
      </ul>
    );
  if (card) return <Card title={t("Hỏi bạn trong bình luận")} meta={q.data ? t("{n} chưa trả lời", { n: asked.length }) : undefined}>{body}</Card>;
  return (
    <section aria-label={t("Hỏi bạn trong bình luận")} className="mt-3 grid gap-1.5 border-t border-rule pt-3">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
        <MessageSquareText className="size-3.5" aria-hidden /> {t("Hỏi bạn trong bình luận")}
        {q.data && <span className="font-mono tabular-nums">{asked.length}</span>}
      </h4>
      {body}
    </section>
  );
}
