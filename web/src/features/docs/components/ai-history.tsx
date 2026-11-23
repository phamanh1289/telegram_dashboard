"use client";

import { MessageSquareText, ScrollText, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DayGroups, DayTrash } from "@/shared/components/ai/day-groups";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";
import { type DocAiSession, docAiQuery, docErrors, docs } from "@/features/docs/lib/docs";

// Lịch sử in the AI popup: its past conversations by day, those on the open document when one is open. A click loads
// one back into the popup (read again, no AI run); the trash on a row / a day deletes them from the server.

export function AiHistory({ doc, current, onPick }: { doc: number | null; current: string; onPick: (s: DocAiSession) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery(docAiQuery(doc));
  const del = useMutation({
    mutationFn: docs.aiDelete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docs", "ai"] }),
    onError: (e) => toast({ text: errorText(e, docErrors()) }),
  });
  const name = (s: DocAiSession) => s.question || t("Tóm tắt “{title}”", { title: s.doc_title });

  if (list.isError) return <p role="alert" className="p-3 text-xs text-error">{errorText(list.error, docErrors())}</p>;
  if (!list.data) return <div className="grid gap-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>;
  if (!list.data.length) return (
    <p className="px-4 py-8 text-center text-xs leading-relaxed text-ink-3">
      {doc != null ? t("Chưa hỏi gì về tài liệu này.") : t("Chưa có phiên hỏi nào.")}<br />
      {t("Mỗi câu trả lời và bản tóm tắt AI viết được lưu ở đây, xem lại không tốn token.")}
    </p>
  );
  return (
    <div className="grid content-start gap-1 p-2">
      <p className="px-2 text-2xs text-ink-3">{doc != null ? t("Các phiên có hỏi về tài liệu này") : t("Mọi phiên hỏi tài liệu")}</p>
      <DayGroups items={list.data} at={(s) => Date.parse(s.at)}
        actions={(day, ss) => (
          <DayTrash label={t("Xóa {n} phiên {day}", { n: ss.length, day: t(day).toLowerCase() })} ask={t("Xóa {n}?", { n: ss.length })}
            onRemove={() => del.mutate(ss.map((s) => s.session))} />
        )}
        row={(s) => {
          const on = s.session === current, Icon = s.kind === "summary" ? ScrollText : MessageSquareText;
          return (
            <li key={s.session} className="group relative rounded-md">
              <button type="button" aria-current={on || undefined} onClick={() => onPick(s)}
                className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1.5 pr-8 text-left", on ? "bg-hl-wash" : "hover:bg-paper-2")}>
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span className="grid min-w-0">
                  <span className="line-clamp-2 text-sm text-ink">{name(s)}</span>
                  <span className="truncate text-xs text-ink-3">{[doc == null && s.doc_title, t("{n} lượt", { n: s.n })].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
              <Button size="icon-xs" variant="ghost" aria-label={t("Xóa phiên {name}", { name: name(s) })} onClick={() => del.mutate([s.session])}
                className="absolute top-1.5 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"><Trash2 /></Button>
            </li>
          );
        }} />
    </div>
  );
}
