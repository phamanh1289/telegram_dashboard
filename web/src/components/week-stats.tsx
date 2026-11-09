"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Gauge } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { api } from "@/lib/api";
import type { components } from "@/lib/api.generated";
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
  if (cur == null || !prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (!pct) return null;
  const better = lowerBetter ? pct < 0 : pct > 0;
  const Icon = pct < 0 ? ArrowDown : ArrowUp;
  return (
    <span className={cn("ml-1 inline-flex items-center text-xs", better ? "text-ok" : "text-ink-3")} aria-label={`${pct > 0 ? "tăng" : "giảm"} ${Math.abs(pct)}% so với tuần trước`}>
      <Icon className="size-3" aria-hidden />{Math.abs(pct)}%
    </span>
  );
}

/** "Tuần của tôi" (top of Briefing): the last 7 days of tags: how many came, how you handled them, how fast, and the
 *  slowest groups; arrows compare with the 7 days before. From stored tags only (backend /api/stats/week, no AI). */
export function WeekStatsCard() {
  const q = useQuery({
    queryKey: ["stats-week"],
    queryFn: ({ signal }) => api<WeekStats>("/stats/week", { signal }),
    staleTime: 5 * 60_000,
  });
  const s = q.data;
  if (!s || (!s.cur.received && !s.prev.received)) return null;
  const { cur, prev } = s;
  const stat = (label: string, value: React.ReactNode, hint?: string) => {
    const body = (
      <div className="grid gap-0.5">
        <dt className="text-xs text-ink-3">{label}</dt>
        <dd className="flex items-baseline font-mono text-sm font-semibold text-ink tabular-nums">{value}</dd>
      </div>
    );
    return hint ? <Hint side="bottom" text={hint}>{body}</Hint> : body;
  };
  return (
    <section aria-label="Tuần của tôi" className="shrink-0 border-b px-3 py-2 md:px-5">
      <dl className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <span className="flex items-center gap-1.5 self-center text-xs font-semibold text-ink"><Gauge className="size-3.5 text-ink-3" aria-hidden />Tuần của tôi</span>
        {stat("Tag nhận", <>{cur.received}<Delta cur={cur.received} prev={prev.received} /></>, "Tin tag / trả lời bạn trong 7 ngày qua")}
        {stat("Đã xử lý", <>{cur.handled}<span className="ml-1 text-xs font-normal text-ink-3">{cur.replied} trả lời, {cur.marked} Xong</span></>,
          `Trả lời (ở đây hoặc trên Telegram) hoặc bấm Xong; ${cur.auto} tin quy tắc “Luôn bỏ qua” tự dọn không tính`)}
        {stat("Thời gian xử lý (trung vị)", <>{dur(cur.median_min)}<Delta cur={cur.median_min} prev={prev.median_min} lowerBetter /></>,
          "Từ lúc được tag tới lúc trả lời / Xong; một nửa số tag được xử lý nhanh hơn mức này")}
        {stat("90% xong trong", dur(cur.p90_min), "9/10 tag được xử lý trong khoảng này")}
        {s.slow.length > 0 && (
          <div className="grid min-w-0 gap-0.5">
            <dt className="text-xs text-ink-3">Nhóm chậm nhất</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-3 text-sm text-ink-2">
              {s.slow.slice(0, 3).map((g) => (
                <span key={g.chat_id} className="max-w-48 truncate">{g.title} <b className="font-mono font-semibold text-ink tabular-nums">{dur(g.median_min)}</b></span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
