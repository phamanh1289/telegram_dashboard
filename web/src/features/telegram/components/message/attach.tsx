"use client";

import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { SquareCheck, Square, Loader2, Paperclip } from "lucide-react";
import { AiBotIcon } from "@/shared/components/ai/chat";
import { createContext, useContext, useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Hint } from "@/shared/components/ui/hint";
import { MENU_ITEM, MENU_POPUP, MENU_SEP } from "@/shared/components/ui/menu";
import { errorText, type Message, type Task } from "@/shared/lib/api";
import { attach, MAX_REFS, messageQuery, sameRef, wantConfirm, wantEdit } from "@/features/telegram/lib/attach";
import { msgKey, openTask, QA_CODE, qaRole, sentQuery, sessionId, SESSION_CODE, taskListQuery } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";
import { t, useT } from "@/shared/lib/i18n";

/** Session id tails named in a text ("#REF-97c501", or the old "#AI-…"), lowercase. */
export const sessionTails = (text?: string | null) => [...(text ?? "").matchAll(SESSION_CODE)].map((x) => x[1].toLowerCase());
export const qaIds = (text?: string | null) => [...(text ?? "").matchAll(QA_CODE)].map((x) => x[1].toUpperCase());

const CHAIN_MAX = 12; // ponytail: ancestors read one by one (cached per message); a deeper thread stops here

/** The session (#REF-…) and Q&A (#QA…) a message answers: the nearest one named by it or any message up its reply chain
 *  (a BE answer often replies to a reply to the copied ask). `at`: the message naming the session. Read on hover only. */
export const chainQuery = (qc: QueryClient, m: Message) => queryOptions({
  queryKey: ["reply-chain", m.chat_id, m.message_id],
  queryFn: async () => {
    let tails: string[] = [], qas: string[] = [], at = "";
    let cur: Message | null = m;
    for (let i = 0; cur; i++) {
      if (!tails.length && (tails = sessionTails(cur.text)).length) at = cur.message_id;
      if (!qas.length) qas = qaIds(cur.text);
      if ((tails.length && qas.length) || !cur.reply_to_id || i >= CHAIN_MAX) break;
      const up: string = cur.reply_to_id;
      cur = await qc.fetchQuery(messageQuery({ chat_id: m.chat_id, message_id: up })).catch((e) => {
        if (!tails.length && !qas.length) throw e; // nothing found yet: an unread chain is an error, not "no session"
        return null; // a deleted ancestor ends the walk with what was found below it
      });
    }
    return { tails, qas, at };
  },
  staleTime: 60_000,
  retry: false,
});

/** The open session a message's reply chain names, if any. */
export const findSession = (ts: Task[] | undefined, tails: string[]) =>
  ts?.filter((t) => t.mode !== "terminal").findLast((t) => tails.includes(t.id.slice(-6).toLowerCase()));

/** The replies of the Q&A thread a row sits in (Q&A page, not the question): the clip's menu can attach them all at once. */
export const AttachThread = createContext<readonly Message[] | null>(null);

/** Every attach from a message row (session chip, clip, its menu) lands here: a message is attached to be built on,
 *  so a read-only (plan) session's next turn gets "Cho sửa code" ticked. An answer (not yours) in a Q&A thread whose
 *  code names a role ("#QA_PO_…") adds "PO đã confirm" to the prompt (the chain read is cached from the clip's hover). */
export function attachTo(qc: QueryClient, tk: Task, ms: readonly Message[]) {
  const name = sessionId(tk);
  const draft = attach(tk.id, ms.map((m) => ({ chat_id: m.chat_id, message_id: m.message_id })));
  const n = ms.filter((m) => draft.some((r) => sameRef(r, m))).length;
  if (n > 0 && tk.kind !== "assist") { // Trợ lý AI drafts replies: no code to trace
    void Promise.all(ms.filter((m) => !m.outgoing).map((m) => qc.fetchQuery(chainQuery(qc, m)).then((c) => c.qas, () => qaIds(m.text))))
      .then((qas) => wantConfirm(tk.id, qas.flat().flatMap((id) => qaRole(id) ?? [])));
  }
  const edit = n > 0 && tk.mode === "plan" && tk.kind !== "assist"; // Trợ lý AI never edits code
  if (edit) wantEdit(tk.id);
  const more = edit ? ` · ${t("đã bật Cho sửa code")}` : "";
  toast({ text: (!n ? t("Phiên {name} đã đủ tin đính kèm cho lượt tới", { name })
    : n < ms.length ? t("Đã đính kèm {n}/{total} tin vào phiên {name} (tối đa {max} tin mỗi lượt)", { n, total: ms.length, name, max: MAX_REFS })
    : ms.length > 1 ? t("Đã đính kèm {n} tin vào phiên {name}", { n, name }) : t("Đã đính kèm {id} vào phiên {name}", { id: `#${ms[0].message_id}`, name })) + more });
  openTask(tk.id);
}

/** Row button: attach this message to the next prompt of a Doing AI Agent session, Giao AI Agent or Đối chiếu BE
 *  (this group's first). Always shown, so the feature is found; with no Doing session the menu says so. The session
 *  list lives in the popup, so rows don't each watch the task list. A message naming a session (#REF-…) attaches to
 *  it at once; otherwise the menu of open sessions. */
export function AttachPick({ m }: { m: Message }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState<Task>(); // the session the chain names, first in the menu
  const chain = useContext(AttachThread);
  const many = !!chain && chain.length > 1; // in a Q&A thread the menu always opens: one message or the whole thread
  // Hovering (or focusing) the clip walks the reply chain once for a session / Q&A code (cached, shared with AnswersFor).
  const [peek, setPeek] = useState(false);
  const own = useMemo(() => sessionTails(m.text), [m.text]);
  const parent = useQuery({ ...chainQuery(qc, m), enabled: peek && !!m.reply_to_id });
  const tails = own.length ? own : parent.data?.tails ?? [];
  const named = useQuery({ ...taskListQuery, enabled: peek && tails.length > 0, select: (ts) => findSession(ts, tails) }).data;
  const name = named && sessionId(named);
  const where = own.length || parent.data?.at === m.message_id ? t("tin này")
    : parent.data?.at === m.reply_to_id ? t("tin gốc nó trả lời") : t("tin #{id} trong chuỗi trả lời", { id: parent.data?.at ?? "" });
  const toggle = (next: boolean) => {
    if (!next) return setOpen(false);
    const go = (t: Task | undefined) => (t && !many ? attachTo(qc, t, [m]) : (setPin(t), setOpen(true)));
    if (named) return go(named);
    void Promise.all([qc.fetchQuery(chainQuery(qc, m)), qc.ensureQueryData(taskListQuery)]).catch(() => undefined)
      .then((r) => go(r ? findSession(r[1], r[0].tails) : undefined));
  };
  return (
    <Menu.Root open={open} onOpenChange={toggle}>
      <Hint side="bottom" title={name || undefined} text={named && many
        ? t("Chọn tin trong chuỗi Q&A (mặc định tick hết) rồi đính kèm vào phiên {name}: {where} có mã phiên đó.", { name: `${name}${named.title ? ` (${named.title})` : ""}`, where })
        : named
        ? t("Bấm để đính kèm tin này vào phiên {name}: {where} có mã phiên đó.", { name: `${name}${named.title ? ` (${named.title})` : ""}`, where })
        : parent.isFetching ? t("Đang đọc chuỗi trả lời tìm mã phiên #REF-… / #QA…")
        : parent.isError ? errorText(parent.error, { not_connected: t("Chưa kết nối Telegram"), message_not_found: t("Không tìm thấy tin gốc") }, t("Không đọc được chuỗi trả lời")).trim()
        : many ? t("Chọn các tin trả lời của chuỗi Q&A (mặc định tick hết) rồi chọn phiên AI Agent để đính kèm vào lượt nhắn tiếp.")
        : t("Đính kèm tin này vào lượt nhắn tiếp của một phiên AI Agent. Tin (hoặc tin nào trong chuỗi trả lời) có mã #REF-… thì tự vào đúng phiên đó.")}>
        <Menu.Trigger aria-label={name ? t("Đính kèm vào phiên {name}", { name }) : t("Đính kèm vào phiên AI")} aria-busy={parent.isFetching}
          onClick={(e) => e.stopPropagation()} onPointerEnter={() => setPeek(true)} onFocus={() => setPeek(true)}
          className={cn("relative inline-flex h-[30px] min-w-[30px] items-center justify-center gap-1 rounded-md text-ink-2 transition-colors duration-(--dur-micro) pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 hover:bg-hl-wash hover:text-hl-2 data-popup-open:bg-hl-wash data-popup-open:text-hl-2",
            named && "bg-hl-wash px-2 text-hl-2")}>
          {parent.isFetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden />
            : named ? <><AiBotIcon className="size-3.5" aria-hidden /><span className="font-mono text-2xs">{name}</span></>
            : <Paperclip className="size-3.5" aria-hidden />}
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          {/* Portalled, but React events still bubble to the row: a click here must not open the reply panel. */}
          <Menu.Popup onClick={(e) => e.stopPropagation()} className={MENU_POPUP}>
            <AttachList m={m} pin={pin} chain={many ? chain : null} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** `pin`: the session the reply chain names (even Done), first. `chain`: the Q&A thread's replies, each with a tick
 *  (all ticked at first; the clicked message too when it is the question). */
function AttachList({ m, pin, chain }: { m: Message; pin?: Task; chain: readonly Message[] | null }) {
  const t = useT();
  const qc = useQueryClient();
  const items = useMemo(() => chain ? [...(chain.some((x) => x.message_id === m.message_id) ? [] : [m]), ...chain].filter((x) => !x.deleted) : [m], [chain, m]);
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set()); // unticked message IDs
  const ms = items.filter((x) => !off.has(x.message_id));
  const sentTo = useQuery(sentQuery).data?.[msgKey(m)] ?? []; // sessions a turn carrying this message already went to
  const tasks = useQuery({ ...taskListQuery, enabled: !(pin && chain) }).data ?? [];
  // The chain names its session: the picked messages go there, no other session to choose from.
  const open = pin && chain ? [pin] : [...(pin ? [pin] : []), ...tasks.filter((tk) => tk.mode !== "terminal" && !tk.handled && tk.id !== pin?.id)
    .sort((a, b) => Number(b.chat_id === m.chat_id) - Number(a.chat_id === m.chat_id))] // stable: newest first within
    .slice(0, 8);
  const tick = (on: boolean) => on ? <SquareCheck className="size-4 shrink-0 text-hl-2" aria-hidden /> : <Square className="size-4 shrink-0" aria-hidden />;
  return (
    <div className="grid w-80 grid-cols-1 gap-0.5">
            <p className="px-2.5 pt-1 pb-0.5 text-xs text-ink-3">{ms.length === 1 ? t("Đính kèm {id} vào phiên", { id: `#${ms[0].message_id}` }) : t("Đính kèm {n} tin vào phiên", { n: ms.length })}</p>
            {chain && (
              <>
                <Menu.CheckboxItem checked={!off.size} onCheckedChange={(on) => setOff(new Set(on ? [] : items.map((x) => x.message_id)))} className={cn("flex items-center gap-2 text-sm text-ink-2", MENU_ITEM)}>
                  {tick(!off.size)}
                  <span className="min-w-0 flex-1">{items.length > MAX_REFS ? t("Mọi tin trả lời trong chuỗi ({n} tin, tối đa {max})", { n: items.length, max: MAX_REFS }) : t("Mọi tin trả lời trong chuỗi ({n} tin)", { n: items.length })}</span>
                </Menu.CheckboxItem>
                <div className="grid max-h-60 grid-cols-1 overflow-y-auto">
                  {items.map((x) => {
                    const on = !off.has(x.message_id);
                    return (
                      <Menu.CheckboxItem key={x.message_id} checked={on} className={cn("flex items-center gap-2 pl-6 text-sm", MENU_ITEM)}
                        onCheckedChange={(v) => setOff((o) => { const n = new Set(o); if (v) n.delete(x.message_id); else n.add(x.message_id); return n; })}>
                        {tick(on)}
                        <span className="min-w-0 flex-1 truncate text-ink">
                          <span className="font-medium">{x.outgoing ? t("Bạn") : x.sender_name ?? "?"}</span>
                          <span className="text-ink-2">: {x.text.replace(QA_CODE, "").trim() || t("[Tệp đính kèm]")}</span>
                        </span>
                      </Menu.CheckboxItem>
                    );
                  })}
                </div>
                <Menu.Separator className={MENU_SEP} />
              </>
            )}
            {!open.length && (
              <p className="px-2.5 pb-1.5 text-xs leading-relaxed text-ink-2">
                {t("Chưa có phiên nào đang làm (Doing). Với phiên đã Done: chép ID tin (nút # trên dòng tin) rồi dán vào ô nhắn của phiên đó.")}
              </p>
            )}
            {open.map((tk) => (
              <Menu.Item key={tk.id} disabled={!ms.length} onClick={() => attachTo(qc, tk, ms)} className={cn("grid gap-0.5 data-disabled:opacity-50", MENU_ITEM)}>
                <span className="truncate text-sm font-medium text-ink">{tk.title || tk.message_text || tk.prompt}</span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
                  {tk.running && <Loader2 className="-mr-1 size-3 shrink-0 animate-spin text-hl-2" aria-label={t("Đang chạy")} />}
                  <span className="shrink-0 font-mono tabular-nums">{sessionId(tk)}</span>
                  <span className="shrink-0">{tk.kind === "deep" ? t("Đối chiếu BE") : tk.kind === "assist" ? t("Trợ lý AI") : t("Giao AI Agent")}</span>
                  <span className="truncate">{tk.chat_title || tk.project.split("/").pop()}</span>
                  {tk.chat_id === m.chat_id && <span className="shrink-0 rounded-full bg-paper-3 px-1.5 leading-4">{t("nhóm này")}</span>}
                  {sentTo.includes(tk.id) && <span className="shrink-0 rounded-full bg-hl-wash px-1.5 leading-4 text-hl-2">{t("đã gửi tin này")}</span>}
                </span>
              </Menu.Item>
            ))}
    </div>
  );
}
