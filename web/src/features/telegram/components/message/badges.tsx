"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Hash, Loader2, MessageCircleQuestion, Paperclip } from "lucide-react";
import { AiBotIcon } from "@/shared/components/ai/chat";
import { useContext, useMemo } from "react";
import { useDeepTask } from "@/features/telegram/components/deep-think";
import { Feat } from "@/shared/components/ui/feat";
import { type Message, type Task } from "@/shared/lib/api";
import { QaCodes, msgKey, openQa, openTask, sentQuery, sessionId, settled, taskListQuery } from "@/features/telegram/lib/inbox";
import { copyText } from "@/shared/lib/notifications";
import { groupBy } from "@/shared/lib/utils";
import { useT } from "@/shared/lib/i18n";
import { attachTo, chainQuery, findSession, qaIds, sessionTails } from "@/features/telegram/components/message/attach";

/** Badges for what this message answers: the AI Agent session and the Q&A questions it names, from its own text (no
 *  reads), plus the Q&A thread it sits in when the groups asked lately were read (`QaCodes`). A session badge opens the session, its clip attaches the message; a Q&A badge opens the question. A code
 *  only in the replied-to message is read when the row's clip (AttachPick) is hovered, never on render. */
export function AnswersFor({ m, qa }: { m: Message; qa: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const own = useMemo(() => sessionTails(m.text), [m.text]);
  const inThread = useContext(QaCodes).get(msgKey(m))?.slice(3); // a reply in a thread, code or not
  const chained = useQuery({ ...chainQuery(qc, m), enabled: false }).data?.qas; // filled once the clip was hovered
  const qas = useMemo(() => qa ? [...new Set(qaIds(m.text).concat(inThread ?? [], chained ?? []))] : [], [m.text, inThread, chained, qa]);
  return <>
    {own.length > 0 && <SessionBadge m={m} tails={own} />}
    {qas.map((id) => (
      <Feat key={id} icon={<MessageCircleQuestion />} label={`#QA${id}`} mono tone="bg-info-wash text-info" onClick={() => openQa(m.chat_id, `#QA${id}`)}
        hint={t("Tin này thuộc Q&A {code}. Bấm để mở cả chuỗi ở trang Q&A.", { code: `#QA${id}` })} />
    ))}
  </>;
}

/** On a message a sent turn of an AI Agent / Đối chiếu BE session carried (attached from any row or pasted, cited, or
 *  the tag it started on): the latest session; opens it. Sessions already shown as a card under the row (`shown`) aren't repeated. */
export function SentBadge({ m, shown }: { m: Message; shown?: Task[] }) {
  const t = useT();
  const ids = (useQuery(sentQuery).data?.[msgKey(m)] ?? []).filter((id) => !shown?.some((tk) => tk.id === id));
  if (!ids.length) return null;
  const names = ids.map((id) => sessionId({ id }));
  return (
    <Feat icon={<Paperclip />} label={<>{t("Đã gửi")} <span className="font-mono">{names[0]}{ids.length > 1 && ` +${ids.length - 1}`}</span></>}
      tone="bg-hl-wash text-hl-2" onClick={() => openTask(ids[0])}
      hint={t("Đã gửi kèm vào phiên {names}. Bấm để mở phiên mới nhất.", { names: names.join(", ") })} />
  );
}

function SessionBadge({ m, tails }: { m: Message; tails: string[] }) {
  const t = useT();
  const qc = useQueryClient();
  const tk = findSession(useQuery(taskListQuery).data, tails);
  if (!tk) return null;
  const name = sessionId(tk);
  return (
    <Feat icon={<Hash />} label={name} mono tone="bg-hl-wash text-hl-2" onClick={() => openTask(tk.id)} title={name}
      hint={t("Tin này có mã phiên AI Agent {name}. Bấm để mở phiên.", { name: `${name}${tk.title ? ` (${tk.title})` : ""}` })}
      actions={[{ icon: <Paperclip />, label: t("Đính kèm vào phiên {name}", { name }), hint: t("Đính kèm tin này vào lượt nhắn tiếp của phiên {name}", { name }), onClick: () => attachTo(qc, tk, [m]) }]} />
  );
}

/** AI Agent sessions of a row (newest first) by state: one mark each, the newest standing for the rest ("+N"). */
export const byState = (ts: Task[]) => [...groupBy(ts, (tk) => `${tk.running}${!!tk.result}`).values()];

/** An AI Agent / Đối chiếu BE session on this message: opens its detail; hover adds copy the code (#REF-…, paste it in
 *  the group so later messages attach there). Delete lives with the session (AI Agent). `more`: older sessions in the same state. */
export function TaskFeat({ tk, more = 0 }: { tk: Task; more?: number }) {
  const t = useT();
  const name = sessionId(tk);
  const deep = tk.kind === "deep";
  const label = deep ? t(tk.running ? "Đang đối chiếu BE" : "Đã đối chiếu BE") : tk.running ? t("AI đang làm…") : tk.result ? t("AI đã trả lời") : t("Phiên AI");
  const hint = deep ? t("Bấm để xem kết quả ở AI Agent › Đối chiếu BE.") : tk.title || t("Mở lại phiên AI này ở trang AI Agent");
  return (
    <Feat icon={tk.running ? <Loader2 className="animate-spin" /> : deep ? <BrainCircuit /> : <AiBotIcon />}
      tone={tk.running ? "bg-info-wash text-info" : deep ? "bg-ok-wash text-ok" : "bg-hl-wash text-hl-2"}
      label={more ? <>{label} <span className="font-mono tabular-nums">+{more}</span></> : label}
      onClick={() => openTask(tk.id)} title={`${name} · ${tk.project.split("/").pop()}`}
      hint={more ? `${t("{n} phiên, bấm để mở phiên mới nhất.", { n: more + 1 })} ${hint}` : hint}
      actions={[
        { icon: <Hash />, label: t("Chép mã phiên {id}", { id: `#${name}` }), hint: t("Mã phiên AI Agent. Bấm để chép, dán vào tin nhóm để tin sau tự đính kèm đúng phiên."),
          onClick: () => void copyText(`#${name}`, t("Đã chép mã phiên {id}", { id: `#${name}` })) },
      ]} />
  );
}

/** Đối chiếu BE on this message (from the task list, so rows without a `tasks` map show it too), placed by `settled`. */
export function DeepFeat({ m, settled: done }: { m: Message; settled: boolean }) {
  const tk = useDeepTask(m);
  return tk && settled(tk) === done ? <TaskFeat tk={tk} /> : null;
}
