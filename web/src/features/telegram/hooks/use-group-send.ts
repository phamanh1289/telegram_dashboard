"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SEND_ERRORS, sendLost, sendLostText } from "@/features/telegram/lib/send";
import { api, errorText, type Outbox, type QaPosted } from "@/shared/lib/api";
import { t } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";

/** idle: nothing sent · queued: in the outbox, not yet on Telegram · sent · unknown: a timeout / lost connection, Telegram
 *  may have it (the user checks the group; only their next click sends again). */
export type GroupSent = "idle" | "queued" | "sent" | "unknown";

/** `got`: the groups this text is already in (a second click never posts it there again). */
type Req = { text: string; id: string; got: string[] };

/** One message to a group, sent from outside the reply panel (Cập nhật story › Telegram). With `replyTo` it is a reply
 *  through the outbox: the same request id while the text is the same, so a second click cannot post it twice. Without:
 *  a new message in each of `chatIds`, the Q&A post (the app's way to post to any group; a text that tags someone gets
 *  a "#QA…" line); one group failing does not stop the others, and sending again only goes to those still without it.
 *  `text`: what the state is about (the caller shows "sent" only while its box still reads that). `lost`: the groups
 *  whose send has no known outcome. */
export function useGroupSend(chatIds: string[], replyTo?: string) {
  const [req, setReq] = useState<Req | null>(null);
  const [state, setState] = useState<GroupSent>("idle");
  const [lost, setLost] = useState<string[]>([]);
  // ponytail: one poll of this request while it waits in the outbox (no event names a request id); SSE if more callers need it
  const rec = useQuery<Outbox>({
    queryKey: ["outbox", req?.id], enabled: state === "queued" && !!req, retry: false,
    refetchInterval: (q) => (!q.state.data || q.state.data.status === "pending" || q.state.data.status === "sending" ? 1500 : false), // settled: stop
    queryFn: ({ signal }) => api<Outbox>(`/outbox/${req!.id}`, { signal }),
  });
  const settled = state !== "queued" || !rec.data ? state : rec.data.status === "sent" ? "sent" : rec.data.status === "unknown" ? "unknown" : rec.data.status === "failed" ? "idle" : "queued";
  // new messages: "sent" only while every group picked has the text (one picked after the send still waits for it)
  const live: GroupSent = !replyTo && settled === "sent" && !chatIds.every((c) => req?.got.includes(c)) ? "idle" : settled;
  const post = useMutation({
    retry: false, // a send is never sent again on its own
    mutationFn: async ({ text, retry }: { text: string; retry: boolean }) => {
      const r = req?.text === text ? req : { text, id: crypto.randomUUID(), got: [] };
      setReq(r);
      if (replyTo) {
        return { retry, fails: [], status: (await api<Outbox>("/messages/reply", { method: "POST", json: {
          request_id: r.id, chat_id: chatIds[0], reply_to_message_id: replyTo, text, retry_unknown: retry,
        } })).status };
      }
      const got = [...r.got], fails: { chat: string; e: unknown }[] = [];
      for (const chat of chatIds.filter((c) => !got.includes(c))) {
        try {
          await api<QaPosted>("/qa", { method: "POST", json: { chat_id: chat, text, reply_to: null, start: false } });
          got.push(chat);
        } catch (e) {
          fails.push({ chat, e });
        }
      }
      setReq({ ...r, got });
      return { retry, fails, status: "sent" as Outbox["status"] };
    },
    onSuccess: ({ status: s, fails, retry }) => {
      const maybe = fails.filter((f) => sendLost(f.e, retry)), no = fails.find((f) => !sendLost(f.e, retry));
      setLost(maybe.map((f) => f.chat));
      if (fails.length) { // said per group: how many have it, what is unknown, why the first one was refused
        setState(maybe.length ? "unknown" : "idle");
        const why = [maybe.length ? sendLostText() : "", no ? errorText(no.e, SEND_ERRORS, t("Gửi thất bại.")) : ""].filter(Boolean).join(" ");
        return void toast({ text: chatIds.length > 1 ? t("Đã gửi {n}/{total} nhóm. {why}", { n: chatIds.length - fails.length, total: chatIds.length, why }) : why });
      }
      if (s === "failed") { setState("idle"); return void toast({ text: t("Gửi thất bại.") }); }
      setState(s === "sent" ? "sent" : s === "unknown" ? "unknown" : "queued");
      toast({ text: s === "sent" ? t("Đã gửi vào nhóm") : s === "unknown" ? sendLostText() : t("Đang gửi vào nhóm…") });
    },
    onError: (e, v) => {
      const lost = sendLost(e, v.retry);
      setState(lost ? "unknown" : "idle");
      toast({ text: lost ? sendLostText() : errorText(e, SEND_ERRORS, t("Gửi thất bại.")) });
    },
  });
  // the user saw "chưa rõ" (here, or as the queued send settled) and sends the same text again: the same request
  return { send: (text: string) => post.mutate({ text, retry: live === "unknown" && req?.text === text }), busy: post.isPending || live === "queued", state: live, text: req?.text ?? "",
    failed: state === "queued" && rec.data?.status === "failed", lost };
}
