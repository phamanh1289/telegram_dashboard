"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { onChanges } from "@/hooks/use-events";
import { api, ApiError, type AiResult, type Message, type Outbox } from "@/lib/api";

const MAX = 4096; // UTF-16 code units == JS string length

type Outcome =
  | { kind: "idle" }
  | { kind: "sent" }
  | { kind: "unknown"; reason: string }
  | { kind: "error"; message: string; until?: number };

export type DraftInjection = { result: AiResult; chatId: string; nonce: number };

const ERRORS: Record<string, string> = {
  not_tracking: "Nhóm không còn được theo dõi.",
  reply_not_found: "Tin đích không còn hoặc không thuộc nhóm này.",
  not_connected: "Chưa kết nối Telegram. Bản nháp vẫn được giữ.",
  forbidden: "Không có quyền gửi trong nhóm này.",
  request_payload_mismatch: "Nội dung đã đổi so với yêu cầu đang chờ.",
};

export function Composer({
  chatId,
  replyTo,
  onClearReply,
  draft,
}: {
  chatId: string;
  replyTo: Message | null;
  onClearReply: () => void;
  draft: DraftInjection | null;
}) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [targetDeleted, setTargetDeleted] = useState(false);
  const [draftStale, setDraftStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // One UUID per send attempt until its result is known; reused on explicit retry.
  const [requestId, setRequestId] = useState<string | null>(null);
  const [draftSources, setDraftSources] = useState<Set<string>>(new Set());
  const [seenDraft, setSeenDraft] = useState<number | null>(null);
  const [seenReply, setSeenReply] = useState(replyTo?.message_id);

  // Adjust state while rendering when inputs change (no effect round-trip).
  if (draft && draft.chatId === chatId && draft.nonce !== seenDraft) {
    setSeenDraft(draft.nonce);
    setText(draft.result.text);
    setDraftSources(new Set(draft.result.source_message_ids));
    setDraftStale(false);
  }
  if (replyTo?.message_id !== seenReply) {
    setSeenReply(replyTo?.message_id);
    setTargetDeleted(false);
  }

  useEffect(
    () =>
      onChanges((items) => {
        for (const it of items) {
          if (it.chat_id !== chatId || !it.message_id) continue;
          if (it.message_id === replyTo?.message_id && it.kind === "delete") setTargetDeleted(true);
          if (draftSources.has(it.message_id)) setDraftStale(true);
        }
      }),
    [chatId, replyTo?.message_id, draftSources],
  );

  useEffect(() => {
    if (outcome.kind !== "error" || !outcome.until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [outcome]);

  const send = useMutation({
    mutationFn: (v: { id: string; retryUnknown: boolean }) =>
      api<Outbox>("/messages/reply", {
        method: "POST",
        json: {
          request_id: v.id,
          chat_id: chatId,
          reply_to_message_id: replyTo!.message_id,
          text,
          retry_unknown: v.retryUnknown,
        },
      }),
    retry: false,
    networkMode: "always",
    onSuccess: (rec) => handle(rec),
    onError: (err) => {
      if (err instanceof ApiError) {
        setRequestId(null); // rejected => certainly not sent
        const until = err.retryAfter ? Date.now() + err.retryAfter * 1000 : undefined;
        setOutcome({
          kind: "error",
          message: err.code === "retry_after" ? "Telegram yêu cầu chờ trước khi gửi tiếp." : (ERRORS[err.code] ?? "Gửi thất bại."),
          until,
        });
      } else {
        setOutcome({ kind: "unknown", reason: "Không liên lạc được máy chủ local." });
      }
    },
  });

  const check = useMutation({
    mutationFn: (id: string) => api<Outbox>(`/outbox/${id}`),
    retry: false,
    networkMode: "always",
    onSuccess: (rec) => handle(rec),
  });

  function handle(rec: Outbox) {
    if (rec.status === "sent") {
      setRequestId(null);
      setText("");
      setDraftSources(new Set());
      setDraftStale(false);
      onClearReply();
      setOutcome({ kind: "sent" });
    } else if (rec.status === "failed") {
      setRequestId(null);
      setOutcome({ kind: "error", message: ERRORS[rec.error_code ?? ""] ?? "Gửi thất bại." });
    } else {
      setOutcome({
        kind: "unknown",
        reason: rec.status === "sending" ? "Đang gửi…" : "Chưa rõ Telegram đã nhận tin hay chưa.",
      });
    }
  }

  const pending = requestId !== null && outcome.kind === "unknown";
  const waitLeft = outcome.kind === "error" && outcome.until ? Math.max(0, Math.ceil((outcome.until - now) / 1000)) : 0;
  const canSend = !!replyTo && text.trim().length > 0 && text.length <= MAX && !send.isPending && !pending && waitLeft === 0 && !targetDeleted;

  function submit() {
    if (!canSend) return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    setOutcome({ kind: "idle" });
    send.mutate({ id, retryUnknown: false });
  }

  return (
    <form
      aria-label="Soạn trả lời"
      className="grid gap-2 border-t p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {replyTo ? (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs">
          <div className="min-w-0 flex-1">
            <span className="font-medium">Trả lời #{replyTo.message_id}</span>
            {replyTo.sender_name && <> · {replyTo.sender_name}</>}
            <p className="truncate text-muted-foreground">{replyTo.text || "[không có chữ]"}</p>
            {targetDeleted && <p className="text-destructive">Tin đích đã bị xóa.</p>}
          </div>
          <Button type="button" size="xs" variant="ghost" onClick={onClearReply} disabled={pending}>
            Bỏ
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Chọn “Trả lời” trên một tin để soạn.</p>
      )}
      <Textarea
        aria-label="Nội dung trả lời"
        value={text}
        readOnly={pending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={4}
        placeholder="Enter xuống dòng · Ctrl/Cmd+Enter gửi"
      />
      {draftStale && (
        <p role="status" className="text-xs text-amber-600">
          Tin nguồn của bản nháp AI đã thay đổi; bản nháp có thể đã cũ.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={text.length > MAX ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {text.length}/{MAX}
        </span>
        <div className="ml-auto flex gap-2">
          {pending && (
            <>
              <Button type="button" size="sm" variant="outline" disabled={check.isPending} onClick={() => requestId && check.mutate(requestId)}>
                Kiểm tra
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={send.isPending}
                onClick={() => requestId && send.mutate({ id: requestId, retryUnknown: true })}>
                Thử lại cùng yêu cầu
              </Button>
              <Button type="button" size="sm" variant="ghost"
                onClick={() => {
                  setRequestId(null);
                  setOutcome({ kind: "idle" });
                }}>
                Bỏ theo dõi yêu cầu
              </Button>
            </>
          )}
          <Button type="submit" size="sm" disabled={!canSend}>
            {send.isPending ? "Đang gửi…" : "Gửi"}
          </Button>
        </div>
      </div>
      <div aria-live="polite" className="text-xs">
        {outcome.kind === "sent" && <span className="text-emerald-600">Đã gửi.</span>}
        {outcome.kind === "unknown" && (
          <span className="text-amber-600">
            {outcome.reason} Thử lại sẽ dùng cùng yêu cầu, Telegram có thể đã nhận tin.
          </span>
        )}
        {outcome.kind === "error" && (
          <span className="text-destructive">
            {outcome.message}
            {waitLeft > 0 && ` Còn ${waitLeft} giây.`}
          </span>
        )}
      </div>
    </form>
  );
}
