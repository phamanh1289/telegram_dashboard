"use client";

import { ArrowLeft, BellOff, BellRing, CheckCheck, CircleCheck, Copy, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiResultCard, AiStop, AiThinking } from "@/shared/components/ai/chat";
import { DeepAnswerAction } from "@/features/telegram/components/deep-think";
import { Markdown } from "@/shared/components/markdown";
import { AttachThread } from "@/features/telegram/components/message/attach";
import { MessageItem } from "@/features/telegram/components/message-item";
import { AiAsk } from "@/features/youtrack/components/bits";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { apiStream, errorText, type Message, type QaItem } from "@/shared/lib/api";
import { type Key, t as tr, useT } from "@/shared/lib/i18n";
import { msgKey } from "@/features/telegram/lib/inbox";
import { copyText } from "@/shared/lib/notifications";
import { qaRemindLabel, readIntro } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { accepted, fresh, gist, type QaMark, type Seen, thread, transcript, untag, waiting, who } from "@/features/telegram/lib/qa";
import { PILL, State } from "@/features/telegram/components/qa/bits";

const sumErr = () => ({ ai_not_configured: tr("Chưa cài AI (Cài đặt › AI)."), ai_context_too_large: tr("Chuỗi quá dài để AI đọc."), message_not_found: tr("Không đọc được các tin của chuỗi.") });
const SUM_LINES: Key[] = ["Đang đọc cả chuỗi", "Đang tìm câu trả lời chốt", "Đang gom việc còn mở"];

/** The open question: its code, state and people, the answer you settled on, then the chain as tag rows (`MessageItem`,
 *  bare) on one rail. Kept tags keep their tag actions; a click on a message makes it the one the box below answers;
 *  "Chốt" on a reply marks it as the answer. AI can sum the thread up (question, conclusion, what is still open).
 *  Keyed by code: a new thread starts with no summary. */
export function Thread({ i, now, title, seenAt, target, onTarget, onClose, late, muted, remind, onNudge, onMute, onResolve, onMark }: {
  i: QaItem; now: number; title?: string; seenAt: Seen; target: Message | null; onTarget: (m: Message) => void; onClose: () => void;
  late: boolean; muted: boolean; remind: number; onNudge: () => void; onMute: (off: boolean) => void; onResolve: (id: string | null) => void;
  onMark: (state: QaMark) => void;
}) {
  const tx = useT();
  const [sure, setSure] = useState(false); // Xóa waits for a second click
  const all = thread(i);
  const news = new Set(fresh(i, seenAt).map((m) => m.message_id));
  const nudged = i.answers.filter((a) => a.outgoing).length;
  const answer = accepted(i);
  const [sum, setSum] = useState<{ text: string; busy: boolean; error?: string } | null>(null);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  async function summarize() {
    stop.current?.abort();
    const ctl = (stop.current = new AbortController());
    setSum({ text: "", busy: true });
    try {
      const r = await apiStream<{ text: string }>("/qa/summary", {
        chat_id: i.question.chat_id, message_ids: all.map((m) => m.message_id), accepted_id: answer?.message_id ?? null, intro: readIntro(),
      }, ctl.signal, (text) => setSum({ text, busy: true }));
      setSum({ text: r.text, busy: false });
    } catch (e) {
      setSum({ text: "", busy: false, error: ctl.signal.aborted ? tr("Đã dừng.") : errorText(e, sumErr(), tr("AI không tóm tắt được.")) });
    }
  }
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 @4xl/qa:px-5">
        <Hint side="bottom" text={tx("Về danh sách câu hỏi (Esc)")}>
          <Button size="icon-sm" variant="ghost" className="@4xl/qa:hidden" aria-label={tx("Về danh sách")} onClick={onClose}><ArrowLeft /></Button>
        </Hint>
        <Hint side="bottom" title={i.code} text={tx("Mã Q&A, bấm để chép. Ghi mã này trong tin trên Telegram là gắn vào chuỗi; bấm hashtag đó trong Telegram để xem cả chuỗi.")}>
          <button type="button" aria-label={tx("Chép mã {code}", { code: i.code })} onClick={() => void copyText(i.code, tr("Đã chép {code}", { code: i.code }))}
            className="rounded-full bg-hl-wash px-2 font-mono text-xs leading-5 font-medium text-hl-2 tabular-nums transition-colors duration-(--dur-micro) hover:bg-hl hover:text-hl-ink">
            {i.code}
          </button>
        </Hint>
        <State i={i} now={now} late={late} />
        <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{[...new Set(all.map(who))].join(", ")}</span>
        <AiAsk label={tx("AI tóm tắt kết luận")} hint={tx("Mình tóm câu hỏi, kết luận và việc còn mở nhé!")} onClick={() => void summarize()} />
        <Hint side="bottom" text={tx("Chép cả chuỗi (người, giờ, nội dung; câu trả lời đã chốt ở đầu) để dán vào ticket, AI hay gửi người khác")}>
          <Button size="icon-sm" variant="ghost" aria-label={tx("Chép chuỗi {code}", { code: i.code })} onClick={() => void copyText(transcript(i, title), tr("Đã chép chuỗi {code}", { code: i.code }))}><Copy /></Button>
        </Hint>
        <Hint side="bottom" text={i.done ? tx("Mở lại: chuỗi quay về trạng thái theo các trả lời, nhắc lại như cũ; tin tag trong chuỗi thành chưa xử lý")
          : tx("Đánh dấu xong: không nhắc nữa, rời Chờ trả lời và Câu hỏi của tôi (xem lại ở bộ lọc Xong); tin tag trong chuỗi cũng thành đã xử lý")}>
          <Button size="icon-sm" variant="ghost" aria-pressed={i.done} aria-label={i.done ? tx("Mở lại {code}", { code: i.code }) : tx("Đánh dấu xong {code}", { code: i.code })}
            className={cn(i.done && "text-ok")} onClick={() => onMark(i.done ? null : "done")}>{i.done ? <RotateCcw /> : <CircleCheck />}</Button>
        </Hint>
        <Hint side="bottom" text={tx("Xóa chuỗi khỏi Q&A trên dashboard (tin trên Telegram vẫn còn). Bấm 2 lần để xác nhận")}>
          <Button size={sure ? "xs" : "icon-sm"} variant={sure ? "destructive" : "ghost"} aria-label={tx("Xóa {code} khỏi Q&A", { code: i.code })} onBlur={() => setSure(false)}
            onClick={() => { if (!sure) return setSure(true); setSure(false); onMark("deleted"); }}>
            <Trash2 />{sure && tx("Bấm lần nữa để xóa")}
          </Button>
        </Hint>
      </div>
      {answer && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-ok-wash px-3 py-2 text-xs text-ok @4xl/qa:px-5">
          <CheckCheck className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-ink-2"><b className="font-bold text-ok">{tx("Đã chốt · {who}:", { who: who(answer) })}</b> {gist(answer)}</span>
          <DeepAnswerAction m={answer} q={i.question.message_id} />
          <Hint side="bottom" text={tx("Bỏ chốt: chuỗi quay lại trạng thái theo các trả lời")}>
            <Button size="xs" variant="ghost" onClick={() => onResolve(null)}>{tx("Bỏ chốt")}</Button>
          </Hint>
        </div>
      )}
      {late ? (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-signal-wash px-3 py-2 text-xs text-signal-2 @4xl/qa:px-5">
          <BellRing className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{tx("Chưa ai trả lời sau {x}", { x: qaRemindLabel(remind) })}{nudged > 0 && tx(", bạn đã nhắc {n} lần", { n: nudged })}.</span>
          <Button size="xs" className="bg-hl" onClick={onNudge}><BellRing /> {tx("Nhắc lại trong nhóm")}</Button>
          <Hint side="bottom" text={tx("Không nhắc câu này nữa (bật lại ngay tại đây)")}>
            <Button size="xs" variant="ghost" onClick={() => onMute(true)}><BellOff /> {tx("Bỏ qua")}</Button>
          </Hint>
        </div>
      ) : muted && i.question.outgoing && waiting(i) && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-ink-3 @4xl/qa:px-5">
          <BellOff className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{tx("Đã tắt nhắc cho câu này.")}</span>
          <Button size="xs" variant="ghost" onClick={() => onMute(false)}>{tx("Bật lại")}</Button>
        </div>
      )}
      {/* The rail runs through the avatars, so the chain reads as one conversation. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sum && (
          <div aria-live="polite" className="grid grid-cols-[minmax(0,1fr)] gap-2 px-4 pt-3 @4xl/qa:px-5">
            {sum.error ? (
              <AiResultCard error actions={<Button size="xs" variant="ghost" onClick={() => setSum(null)}><X /> {tx("Đóng")}</Button>}>{sum.error}</AiResultCard>
            ) : sum.busy && !sum.text ? (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1"><AiThinking lines={SUM_LINES.map((l) => tx(l))} /></div>
                <AiStop onClick={() => stop.current?.abort()} hint={tx("Dừng tóm tắt")} />
              </div>
            ) : (
              <AiResultCard title={tx("Kết luận (AI)")} busy={sum.busy} actions={sum.busy ? <AiStop onClick={() => stop.current?.abort()} hint={tx("Dừng tóm tắt")} /> : <>
                <Button size="xs" variant="ghost" onClick={() => void copyText(sum.text, tr("Đã chép kết luận"))}><Copy /> Copy</Button>
                <Button size="xs" variant="ghost" onClick={() => setSum(null)}><X /> {tx("Đóng")}</Button>
              </>}>
                <Markdown text={sum.text} className="text-ink" />
              </AiResultCard>
            )}
          </div>
        )}
        <AttachThread.Provider value={i.answers}>
        <ol aria-label={tx("Chuỗi {code}", { code: i.code })} className="@container relative py-2 before:absolute before:inset-y-6 before:left-8 before:w-px before:bg-rule-2 @xl:before:left-9">
          {all.map((m, k) => (
            <MessageItem key={m.message_id} m={untag(m)} now={now} head={k === 0 || all[k - 1].sender_id !== m.sender_id || all[k - 1].outgoing !== m.outgoing}
              isReplyTarget={!!target && msgKey(target) === msgKey(m)} onReply={onTarget} live={!m.kept} liveReply bare fresh={news.has(m.message_id)}
              extra={<>{k > 0 && !m.deleted && (answer?.message_id === m.message_id ? (
                <span className={cn(PILL, "mr-1 bg-ok-wash text-ok")}><CheckCheck aria-hidden />{tx("Câu trả lời")}</span>
              ) : (
                <Hint side="bottom" text={tx("Chốt tin này là câu trả lời của câu hỏi: chuỗi thành Đã chốt, không nhắc nữa, tin này hiện ở đầu chuỗi và trong Chép chuỗi")}>
                  <Button size="xs" variant="ghost" onClick={() => onResolve(m.message_id)}
                    className="opacity-0 transition-opacity duration-(--dur-micro) group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
                    <CheckCheck /> {tx("Chốt")}
                  </Button>
                </Hint>
              ))}</>} />
          ))}
        </ol>
        </AttachThread.Provider>
      </div>
    </>
  );
}
