"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Reply } from "lucide-react";
import { useState } from "react";
import { IssueDialog, TaskPage } from "@/features/telegram/components/composer-dialogs";
import { DeepItemAction, DeepTopicAction, isStale, useVerdicts, VerdictChip, verdictKey } from "@/features/telegram/components/deep-think";
import { TicketChip } from "@/features/telegram/components/message/rich-text";
import { getMessage, openReplyById, openTask, taskToast, useSessionOn } from "@/features/telegram/lib/inbox";
import { useOpenSimilar } from "@/features/youtrack/components/ticket-form";
import { AiBotIcon } from "@/shared/components/ai/chat";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { type DigestItem, errorText, type Message, statusQuery } from "@/shared/lib/api";
import { t as tr, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { useRole, usesCode } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

const OPEN = new Set(["confirmations", "actions"]);

/** "Cần confirm" / "Việc cần làm" (and Briefing's asks): answer the message it came from, or make it a ticket.
 *  `suggest`: no ticket yet and none similar on YouTrack, so "Tạo ticket" stands out; `onCreated`: after one is made.
 *  `agent` (a to-do): "AI Agent" hands it to the agent, the to-do's text already in the note; once handed over the
 *  button is that session (its state; opens it), so it is not handed over twice. */
export function ItemActions({ chatId, ids, text, suggest, agent, onCreated }: {
  chatId: string; ids: string[]; text: string; suggest?: boolean; agent?: boolean; onCreated?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const status = useQuery({ ...statusQuery, staleTime: Infinity }).data; // the shell keeps it fresh
  const code = usesCode(useRole());
  const session = useSessionOn("task", chatId, agent ? ids[0] : undefined).data; // the shared task list, no query per row
  const [m, setM] = useState<{ m: Message; to: "ticket" | "agent" } | null>(null);
  const load = useMutation({
    mutationFn: async (to: "ticket" | "agent") => ({ m: await getMessage(chatId, ids[0]), to }), // the ticket form / agent read it
    onSuccess: setM,
    onError: (e) => toast({ text: errorText(e, {}, tr("Không mở được tin gốc, thử lại sau")) }),
  });
  if (!ids.length) return null;
  const cls = "ml-1 h-5 px-1 text-ink-3 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3";
  return (
    <>
      <Button type="button" size="xs" variant="ghost" className={cls} onClick={() => void openReplyById(chatId, ids[0])}><Reply aria-hidden /> {t("Trả lời")}</Button>
      {status?.youtrack_configured && (
        <Button type="button" size="xs" variant="ghost" disabled={load.isPending} onClick={() => load.mutate("ticket")}
          className={cn(cls, suggest && "bg-hl-wash font-medium text-hl-2")}><Bug aria-hidden /> {suggest ? t("Chưa có ticket · Tạo") : t("Tạo ticket")}</Button>
      )}
      {agent && session ? (
        <Hint side="bottom" title="AI Agent" text={t("Việc này đã giao AI Agent: bấm để mở phiên.")}>
          <Button type="button" size="xs" variant="ghost" onClick={() => openTask(session.id)} className={cn(cls, "bg-hl-wash text-hl-2")}>
            <AiBotIcon aria-hidden /> AI Agent · {session.running ? t("đang chạy") : session.result ? t("có kết quả") : t("dừng")}
          </Button>
        </Hint>
      ) : agent && code && status?.ai_configured && (
        <Hint side="bottom" title="AI Agent" text={t("Giao cho AI Agent làm trong một dự án (sửa bug, thêm tính năng…)")}>
          <Button type="button" size="xs" variant="ghost" disabled={load.isPending} onClick={() => load.mutate("agent")} className={cls}>
            <AiBotIcon aria-hidden /> AI Agent
          </Button>
        </Hint>
      )}
      {m?.to === "ticket" && (
        <IssueDialog m={m.m} note={text} ai={status?.ai_configured ?? false} open onOpenChange={(o) => { if (!o) setM(null); }}
          onCreated={(line) => {
            setM(null);
            onCreated?.();
            toast({ text: line.split(":")[0], action: { label: tr("Báo nhóm"), run: () => void openReplyById(chatId, m.m.message_id, line) } });
          }} />
      )}
      {m?.to === "agent" && (
        <Dialog open onOpenChange={(o) => { if (!o) setM(null); }}>
          <DialogContent showCloseButton={false} className={cn(DIALOG_SHEET, "sm:max-w-6xl")}>
            <TaskPage m={m.m} analysis="" seed={text} onBack={() => setM(null)}
              onCreated={(id) => { setM(null); taskToast(id, () => void qc.invalidateQueries({ queryKey: ["tasks"] })); }} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** "Trả lời" / "Tạo ticket" / "AI Agent"; a to-do with no ticket is checked against YouTrack: a likely match is shown, else creating one is suggested. */
function TodoActions({ chatId, it, kind, onCreated }: { chatId: string; it: DigestItem; kind: string; onCreated?: () => void }) {
  const tx = useT();
  const ytOn = useQuery({ ...statusQuery, staleTime: Infinity }).data?.youtrack_configured; // the shell keeps it fresh
  const check = !!ytOn && kind === "actions" && !it.tickets?.length;
  const similar = useOpenSimilar(it.text, { enabled: check });
  const hit = similar.data?.[0];
  return (
    <>
      {hit && <span className="inline-flex items-center gap-1">{tx("có thể đã có")} <TicketChip id={hit.id} /></span>}
      <ItemActions chatId={chatId} ids={it.message_ids ?? []} text={it.text} suggest={check && similar.isSuccess && !hit}
        agent={kind === "actions"} onCreated={onCreated} />
    </>
  );
}

/** A to-do's last code check (its own or a group's, from Briefing): where the code stands, opening that session. */
function TodoVerdict({ chatId, it }: { chatId: string; it: DigestItem }) {
  const tv = useVerdicts(chatId)?.get(verdictKey(it.text));
  return tv ? <VerdictChip tv={tv} open stale={isStale(tv, it.message_ids ?? [])} className="ml-1" /> : null;
}

/** The next step on a digest item, for Briefing's rows, a group's digest and the Trợ lý's cited points alike: an open
 *  question / to-do is answered, made a ticket or (a to-do) handed to the AI Agent; one with BE, and every to-do (is it
 *  done in the code yet?), is also checked against the code; the rest checked against the code. */
export function NextSteps({ chatId, it, kind, onCreated }: { chatId: string; it: DigestItem; kind: string; onCreated?: () => void }) {
  if (!OPEN.has(kind)) return <DeepItemAction chatId={chatId} ids={it.message_ids ?? []} />;
  return <>
    {kind === "actions" && <TodoVerdict chatId={chatId} it={it} />}
    <TodoActions chatId={chatId} it={it} kind={kind} onCreated={onCreated} />
    {(it.be || kind === "actions") && <DeepTopicAction chatId={chatId} item={{ text: it.text, message_ids: it.message_ids ?? [], waiting: kind === "confirmations" }} />}
  </>;
}
