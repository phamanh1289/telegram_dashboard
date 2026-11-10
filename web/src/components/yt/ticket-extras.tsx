"use client";

import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { type Link, similar, type Ticket, yt } from "@/lib/yt";
import { Label, StatePill } from "./bits";
import { useYt } from "./state";

// Ticket sheet extras: tickets that look like this one.

/** Tickets with a similar title in the loaded data; the AI can say which are real duplicates.
 *  `links`: this ticket's YouTrack links, so one already linked shows how ("duplicates", "relates to"). */
export function Related({ t: tk, links }: { t: Ticket; links?: Link[] }) {
  const t = useT();
  const y = useYt();
  const list = useMemo(() => similar(tk, y.rows), [tk, y.rows]);
  const linked = useMemo(() => new Map(links?.flatMap((l) => l.issues.map((x) => [x.id, l.rel] as const))), [links]);
  if (!list.length) return null;
  const ids = [tk.id, ...list.map(([i]) => i.id)];
  const check = () => y.setSheet({ kind: "work", title: t("AI · kiểm tra trùng {id}", { id: tk.id }), ids, auto: {
    label: t("AI đang so sánh"),
    run: (sig) => yt.aiTickets(ids, `${tk.id} và các ticket giống`, "ask", sig,
      `Ticket nào trong danh sách là TRÙNG với ${tk.id} (cùng một việc), ticket nào chỉ LIÊN QUAN (nên link), ticket nào không liên quan? Mỗi dòng '- ID: trùng / liên quan / không, vì sao'. Cuối cùng đề xuất: gộp, link hay giữ riêng.`),
  } });
  return (
    <section className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label>{t("Ticket giống / liên quan ({n})", { n: list.length })}</Label>
        {y.aiOn && <Button size="xs" variant="ghost" className="ml-auto" onClick={check}><Sparkles /> {t("AI kiểm tra trùng")}</Button>}
      </div>
      {list.map(([i, score]) => (
        <button key={i.id} type="button" onClick={() => y.openTicket(i.id)} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-paper-2">
          <b className={cn("font-mono text-xs", i.resolved && "text-ink-3 line-through")}>{i.id}</b>
          <span className="truncate">{i.summary}</span>
          <span className="flex items-center gap-2">
            {linked.has(i.id) && <em className="rounded bg-paper-2 px-1.5 text-xs text-ink-3 not-italic">{t("đã link · {rel}", { rel: linked.get(i.id) ?? "" })}</em>}
            <StatePill state={i.state} /><span className="font-mono text-xs text-ink-3">{Math.round(score * 100)}%</span></span>
        </button>
      ))}
    </section>
  );
}
