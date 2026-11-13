"use client";

import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, Bug, CheckCheck, ChevronRight, MessageCircleQuestion, MessageSquare } from "lucide-react";
import { AiBotIcon } from "@/components/ai/chat";
import Link from "next/link";
import { Fragment, type ReactNode, use, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { Message } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { msgKey, openQa, openReply, openTask, smooth, qaAskKey, QaCodes, ticketsIn, useTaskList } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { ytDetailQuery, ytProjectsQuery } from "@/lib/yt";

const CHIP = "inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-cotton px-2 text-xs text-ink-2 shadow-stock no-underline transition-colors duration-(--dur-micro) hover:text-ink";

/** "Luồng việc" of one tag: the steps it has been through, in order (the tag, its tickets with their state, the AI Agent
 *  / Đối chiếu BE sessions on it, its Q&A thread, the reply), each a jump to that step; a session with a result opens
 *  it here instead (read it, "Dùng làm nháp" into this reply). Reads only what is already cached / polled; ticket states
 *  load per chip (one cached query each). Hidden when the tag has gone nowhere yet. */
export function WorkTrail({ m }: { m: Message }) {
  const t = useT();
  const known = useQuery(ytProjectsQuery).data;
  const ids = ticketsIn(m.text, known);
  const tasks = (useTaskList().data ?? []).filter((x) => x.chat_id === m.chat_id && String(x.message_id) === m.message_id);
  const codes = use(QaCodes);
  const qa = codes.get(msgKey(m)) ?? codes.get(qaAskKey(m)); // its thread, or one a question replying to it opened
  const replied = m.handled && (m.handled_by === "reply" || m.handled_by === "dashboard");
  const [openId, setOpen] = useState<string | null>(null);
  const shown = tasks.find((x) => x.id === openId && x.result);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (openId) panel.current?.scrollIntoView({ block: "nearest", behavior: smooth() }); }, [openId]); // it opens below the fold
  const steps: ReactNode[] = [
    ...ids.map((id) => <TicketStep key={id} id={id} />),
    ...tasks.map((x) => {
      const Icon = x.kind === "deep" ? BrainCircuit : AiBotIcon;
      return (
        <button key={x.id} type="button" aria-expanded={x.result ? openId === x.id : undefined}
          className={cn(CHIP, openId === x.id && "bg-hl-wash text-hl-2")}
          onClick={() => (x.result ? setOpen((o) => (o === x.id ? null : x.id)) : openTask(x.id))}>
          <Icon className="size-3.5 text-ink-3" aria-hidden />{x.kind === "deep" ? t("Đối chiếu BE") : "AI Agent"} · {x.running ? t("đang chạy") : x.result ? t("có kết quả") : t("dừng")}
        </button>
      );
    }),
    ...(qa ? [<button key="qa" type="button" className={CHIP} onClick={() => openQa(m.chat_id, qa)}><MessageCircleQuestion className="size-3.5 text-info" aria-hidden />Q&A {qa}</button>] : []),
    ...(replied ? [<span key="re" className={cn(CHIP, "text-ok")}><CheckCheck className="size-3.5" aria-hidden />{t("Đã trả lời")}</span>] : []),
  ];
  if (!steps.length) return null;
  return (
    <div className="grid gap-2">
      <nav aria-label={t("Luồng việc của tin này")} className="flex flex-wrap items-center gap-1 animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short) motion-reduce:animate-none">
        <span className="mr-1 text-xs font-medium text-ink-3">{t("Luồng việc")}</span>
        {steps.map((s, i) => <Fragment key={i}>{i > 0 && <ChevronRight className="size-3 text-ink-3" aria-hidden />}{s}</Fragment>)}
      </nav>
      {shown && (
        <div ref={panel} className="grid gap-2 rounded-[var(--radius-input)] bg-cotton p-3 shadow-stock animate-in fade-in-0 duration-(--dur-short) motion-reduce:animate-none">
          {/* Actions first: a long result would push them below the fold. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" onClick={() => openReply(m, shown.result!)}><MessageSquare />{t("Dùng làm nháp trả lời")}</Button>
            <Button size="xs" variant="ghost" onClick={() => openTask(shown.id)}>{shown.kind === "deep" ? <BrainCircuit /> : <AiBotIcon />}{t("Mở phiên")}</Button>
          </div>
          <Markdown text={shown.result} className="line-clamp-12 text-sm text-ink" />
        </div>
      )}
    </div>
  );
}

function TicketStep({ id }: { id: string }) {
  const d = useQuery({ ...ytDetailQuery(id), retry: false }).data;
  return (
    <Link href={`/youtrack/?ticket=${encodeURIComponent(id)}`} className={CHIP}>
      <Bug className="size-3.5 text-ink-3" aria-hidden /><b className="font-mono font-medium">{id}</b>
      {d?.state && <span className={cn(d.resolved ? "text-ok" : "text-ink-3")}>· {d.state}</span>}
    </Link>
  );
}
