"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Bug, CheckCheck, ChevronRight, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode, use } from "react";
import type { Message } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { msgKey, openQa, openTask, QaCodes, useTaskList } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { ytDetailQuery, ytProjectsQuery } from "@/lib/yt";

const TICKETS = /(?<![\w-])[A-Z][A-Z0-9]{1,9}-\d{1,6}(?!\w)/g;
const CHIP = "inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-cotton px-2 text-xs text-ink-2 shadow-stock no-underline transition-colors duration-(--dur-micro) hover:text-ink";

/** "Luồng việc" of one tag: the steps it has been through, in order (the tag, its tickets with their state, the AI Agent
 *  sessions on it, its Q&A thread, the reply), each a jump to that step. Reads only what is already cached / polled;
 *  ticket states load per chip (one cached query each). Hidden when the tag has gone nowhere yet. */
export function WorkTrail({ m }: { m: Message }) {
  const t = useT();
  const known = useQuery(ytProjectsQuery).data;
  const ids = known ? [...new Set(m.text.match(TICKETS) ?? [])].filter((id) => known.some((p) => p.shortName === id.split("-")[0])).slice(0, 3) : [];
  const tasks = (useTaskList().data ?? []).filter((x) => x.chat_id === m.chat_id && String(x.message_id) === m.message_id);
  const qa = use(QaCodes).get(msgKey(m));
  const replied = m.handled && (m.handled_by === "reply" || m.handled_by === "dashboard");
  const steps: ReactNode[] = [
    ...ids.map((id) => <TicketStep key={id} id={id} />),
    ...tasks.map((x) => (
      <button key={x.id} type="button" className={CHIP} onClick={() => openTask(x.id)}>
        <Bot className="size-3.5 text-ink-3" aria-hidden />AI Agent · {x.running ? t("đang chạy") : x.result ? t("có kết quả") : t("dừng")}
      </button>
    )),
    ...(qa ? [<button key="qa" type="button" className={CHIP} onClick={() => openQa(m.chat_id, qa)}><MessageCircleQuestion className="size-3.5 text-info" aria-hidden />Q&A {qa}</button>] : []),
    ...(replied ? [<span key="re" className={cn(CHIP, "text-ok")}><CheckCheck className="size-3.5" aria-hidden />{t("Đã trả lời")}</span>] : []),
  ];
  if (!steps.length) return null;
  return (
    <nav aria-label={t("Luồng việc của tin này")} className="flex flex-wrap items-center gap-1 animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short) motion-reduce:animate-none">
      <span className="mr-1 text-xs font-medium text-ink-3">{t("Luồng việc")}</span>
      {steps.map((s, i) => <Fragment key={i}>{i > 0 && <ChevronRight className="size-3 text-ink-3" aria-hidden />}{s}</Fragment>)}
    </nav>
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
