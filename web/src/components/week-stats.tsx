"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Gauge } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText } from "@/lib/api";
import type { components } from "@/lib/api.generated";
import { useT } from "@/lib/i18n";
import { byUnit } from "@/lib/time";
import { cn } from "@/lib/utils";

type WeekStats = components["schemas"]["WeekStats"];

/** Minutes as "35 phút" / "4 giờ" / "2 ngày". */
const dur = (m: number | null | undefined) => {
  if (m == null) return "—";
  const [n, unit] = byUnit(Math.round(m));
  return `${n} ${unit}`;
};

/** Change against last week: an arrow and the %, green only when it is better (`lowerBetter`: times). */
function Delta({ cur, prev, lowerBetter }: { cur: number | null | undefined; prev: number | null | undefined; lowerBetter?: boolean }) {
  const t = useT();
  if (cur == null || !prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (!pct) return null;
  const better = lowerBetter ? pct < 0 : pct > 0;
  const Icon = pct < 0 ? ArrowDown : ArrowUp;
  return (
    <span className={cn("ml-1 inline-flex items-center text-xs", better ? "text-ok" : "text-ink-3")} aria-label={t(pct > 0 ? "tăng {n}% so với tuần trước" : "giảm {n}% so với tuần trước", { n: Math.abs(pct) })}>
      <Icon className="size-3" aria-hidden />{Math.abs(pct)}%
    </span>
  );
}

/** "Tuần của tôi" (top of Briefing): the last 7 days of tags: how many came, how you handled them, how fast, and the
 *  slowest groups; arrows compare with the 7 days before. From stored tags only (backend /api/stats/week, no AI). */
/** `className` replaces the strip's frame (Briefing shows it in a popover); `empty`: shown when there is nothing yet. */
export function WeekStatsCard({ className, empty = null }: { className?: string; empty?: React.ReactNode } = {}) {
  const t = useT();
  const q = useQuery({
    queryKey: ["stats-week"],
    queryFn: ({ signal }) => api<WeekStats>("/stats/week", { signal }),
    staleTime: 5 * 60_000,
  });
  const s = q.data;
  if (q.isError) return <p role="alert" className={cn(className ?? "shrink-0 border-b px-3 py-2 md:px-5", "text-xs text-error")}>{errorText(q.error, {}, t("Không đọc được số liệu tuần."))}</p>;
  if (!s) return <Skeleton className="h-10" />;
  if (!s.cur.received && !s.prev.received) return empty;
  const { cur, prev } = s;
  const stat = (label: string, value: React.ReactNode, hint?: string) => {
    const body = (
      <div className="grid gap-0.5">
        <dt className="text-xs text-ink-3">{label}</dt>
        <dd className="flex items-baseline font-mono text-sm font-bold text-ink tabular-nums">{value}</dd>
      </div>
    );
    return hint ? <Hint side="bottom" text={hint}>{body}</Hint> : body;
  };
  return (
    <section aria-label={t("Tuần của tôi")} className={className ?? "shrink-0 border-b px-3 py-2 md:px-5"}>
      <dl className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <span className="flex items-center gap-1.5 self-center text-xs font-bold text-ink"><Gauge className="size-3.5 text-ink-3" aria-hidden />{t("Tuần của tôi")}</span>
        {stat(t("Tag nhận"), <>{cur.received}<Delta cur={cur.received} prev={prev.received} /></>, t("Tin tag / trả lời bạn trong 7 ngày qua"))}
        {stat(t("Đã xử lý"), <>{cur.handled}<span className="ml-1 text-xs font-normal text-ink-3">{t("{r} trả lời, {d} Xong", { r: cur.replied, d: cur.marked })}</span></>,
          t("Trả lời (ở đây hoặc trên Telegram) hoặc bấm Xong; {n} tin quy tắc “Luôn bỏ qua” tự dọn không tính", { n: cur.auto }))}
        {stat(t("Thời gian xử lý (trung vị)"), <>{dur(cur.median_min)}<Delta cur={cur.median_min} prev={prev.median_min} lowerBetter /></>,
          t("Từ lúc được tag tới lúc trả lời / Xong; một nửa số tag được xử lý nhanh hơn mức này"))}
        {stat(t("90% xong trong"), dur(cur.p90_min), t("9/10 tag được xử lý trong khoảng này"))}
        {s.slow.length > 0 && (
          <div className="grid min-w-0 gap-0.5">
            <dt className="text-xs text-ink-3">{t("Nhóm chậm nhất")}</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-3 text-sm text-ink-2">
              {s.slow.map((g) => (
                <span key={g.chat_id} className="max-w-48 truncate">{g.title} <b className="font-mono font-bold text-ink tabular-nums">{dur(g.median_min)}</b></span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
