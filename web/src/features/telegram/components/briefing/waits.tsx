"use client";

import { Menu } from "@base-ui/react/menu";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Bug, Check, FilePenLine, Hammer, Hourglass, Palette, RotateCw, Server, UserCheck, Undo2, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Tickets } from "@/features/telegram/components/digest-page";
import { todoKey } from "@/features/telegram/lib/digest";
import { changeFollow, followQuery, setDone, useFollow, useStoried, type Wait } from "@/features/telegram/lib/follow";
import { openReplyById, ticketsIn } from "@/features/telegram/lib/inbox";
import { tagsFor } from "@/features/telegram/lib/mentions";
import { StoryUpdate } from "@/features/youtrack/components/story-update";
import { ytTraceQuery } from "@/features/youtrack/lib/trace";
import { bucket, isBuilt, nextStates, type Ticket, yt, ytFieldsQuery, ytProjectsQuery, ytWorkflowQuery } from "@/features/youtrack/lib/yt";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { MENU_ACTION, MENU_ITEM, MENU_POPUP } from "@/shared/components/ui/menu";
import { useNow } from "@/shared/hooks/use-now";
import { api, type DigestItem, errorText, type Message, statusQuery, type WaitReplies } from "@/shared/lib/api";
import { type Key, t as tr, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { goApp } from "@/shared/lib/nav";
import { getPref, isString, put, readNotify, readYtRole, setPref, usePrefValue, useRole, useRoleOrDev, type YtRole } from "@/shared/lib/prefs";
import { timeLabel, ymd } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

// ---- Chờ bổ sung: items still waiting on someone else, the reasons by role (kept on the server: lib/follow) -------------

export type { Wait };
export type WaitOn = Wait["on"];
export const WAIT_ON: Record<WaitOn, { label: Key; Icon: typeof Palette; nudge: (text: string) => string }> = {
  // nudge: the reply line "Nhắc" puts in the group (to the team, in Vietnamese like recordText)
  design: { label: "Chờ design", Icon: Palette, nudge: (x) => `Nhờ bổ sung design cho: ${x}` },
  bu: { label: "Chờ BU", Icon: Users, nudge: (x) => `Nhờ BU confirm giúp: ${x}` },
  be: { label: "Chờ BE", Icon: Server, nudge: (x) => `Nhờ BE hỗ trợ giúp: ${x}` },
  po: { label: "Chờ PO", Icon: UserCheck, nudge: (x) => `Nhờ PO chốt giúp: ${x}` },
  build: { label: "Chờ build", Icon: Hammer, nudge: (x) => `Nhờ build bản có: ${x}` },
  fix: { label: "Chờ fix", Icon: Bug, nudge: (x) => `Nhờ fix giúp: ${x}` },
  other: { label: "Chờ người khác", Icon: Hourglass, nudge: (x) => `Nhờ phản hồi giúp: ${x}` }, // a reason of the user's own (its label)
};
/** What each role waits on by default: PO a design / the BU's confirm; Dev the BE / the PO; QC a build / a fix. */
export const ROLE_WAITS: Record<YtRole, WaitOn[]> = { po: ["design", "bu"], dev: ["be", "po"], qa: ["build", "fix"] };
/** The built-in reasons, any role's (Cài đặt offers the others' too). */
export const BUILTIN_WAITS = Object.keys(WAIT_ON).filter((k) => k !== "other") as WaitOn[];

// ---- The "Chờ…" menu's reasons, per role (Cài đặt › Telegram › Briefing): built-in ids and the user's own words ----------
/** One reason: built-in, or the user's own ("other" + the words, as written). */
export type WaitChoice = Pick<Wait, "on" | "label">;
const choicesKey = (r: YtRole) => `waitChoices.${r}`;
/** Save the role's reasons; null: back to the defaults. */
export const saveWaitChoices = (r: YtRole, list: string[] | null) => setPref(choicesKey(r), list && JSON.stringify(list));
export const toChoice = (s: string): WaitChoice => (BUILTIN_WAITS as string[]).includes(s) ? { on: s as WaitOn, label: "" } : { on: "other", label: s };
/** The role's reasons, live (a change in Cài đặt shows in every open menu): built-in ids and the user's words; none
 *  saved (or unreadable): ROLE_WAITS. */
export function useWaitChoices(r: YtRole) {
  const raw = usePrefValue(choicesKey(r));
  return useMemo(() => {
    let v: unknown = null;
    try { v = JSON.parse(raw || "null"); } catch {} // unreadable: the defaults
    return Array.isArray(v) ? v.filter(isString) : ROLE_WAITS[r];
  }, [r, raw]);
}
/** A wait's reason as shown: the user's words, else the built-in name. */
export const waitName = (w: WaitChoice) => w.label || tr(WAIT_ON[w.on].label);
/** The people a digest's "who" names: "Tùng (BE), Hà" → ["Tùng", "Hà"]. */
const people = (who: string) => who.split(/\s*[,;/&]\s*|\s+và\s+/).map((s) => s.replace(/\(.*?\)/g, "").trim()).filter(Boolean);
const DAY = 864e5;
const LATE_DAYS = 3; // waiting this long: the age stands out, and a nudge comes once a day
const NONE: Wait[] = [];
// "Có vẻ xong": what a wait was for has happened. On the ticket (fix / build / design, its first ticket): its State moved
// on after the wait began. In the group (BE / PO / BU): someone replied to the message it cites. Suggested, never closed alone.
const BY_TICKET = new Set<WaitOn>(["fix", "build", "design"]);
const BY_REPLY = new Set<WaitOn>(["be", "po", "bu", "other"]); // "other": any reply to the message ends it
const ytOnQuery = { ...statusQuery, staleTime: Infinity, select: (s: { youtrack_configured: boolean }) => s.youtrack_configured }; // the shell keeps it fresh

/** The parked items; `error`: the list could not be read (said, not shown as empty). */
export function useWaits(on: boolean) {
  const q = useFollow(on);
  return { waits: q.data?.waits ?? NONE, error: q.isError ? q.error : null, retry: () => void q.refetch() };
}

/** The state a "Chờ design" ticket moves to on YouTrack: the project's own design state ("ASSIGN TO DESIGN" first), only when the
 *  team workflow has an arrow there from the ticket's State `from` (the server would refuse it). */
async function designState(qc: QueryClient, id: string, from: string) {
  const p = id.split("-")[0];
  const fields = await qc.fetchQuery(ytFieldsQuery(p)).catch(() => undefined);
  const states: string[] = fields?.State ?? []; // unreadable: no offer (the wait itself is saved)
  const to = states.find((s) => /assign to design/i.test(s)) ?? states.find((s) => /design/i.test(s) && !/confirm/i.test(s));
  if (!to) return undefined;
  const wf = await qc.fetchQuery(ytWorkflowQuery(p, readYtRole() ?? "dev")).catch(() => undefined);
  return wf && nextStates(wf.edges, from || null).includes(to) ? to : undefined;
}

type StoryItem = Pick<DigestItem, "text" | "why" | "tickets" | "message_ids">;
/** What a wait is made of: a digest row, or a Q&A thread (no "who": "Nhắc" tags nobody). */
type WaitItem = StoryItem & Partial<Pick<DigestItem, "who">>;

/** Parks an item as waiting: it leaves its open list (ticked done) and shows under Chờ bổ sung. A design wait on a ticket
 *  offers moving it to the project's design state, so the team sees it on YouTrack too. Not saved (said by
 *  changeFollow): it goes back to its open list. */
async function park(qc: QueryClient, chatId: string, kind: string, it: WaitItem, c: WaitChoice, key = todoKey(chatId, kind, it)) {
  const { on, label } = c;
  const id = it.tickets?.[0] ?? "";
  const ytOn = !!id && qc.getQueryData<{ youtrack_configured: boolean }>(statusQuery.queryKey)?.youtrack_configured;
  setDone([key], true);
  // the ticket's State now: "có vẻ xong" only once it has moved on from here (unreadable: none, as before)
  const state = ytOn && BY_TICKET.has(on) ? await qc.fetchQuery(ytTraceQuery([id])).then((d) => d[id]?.state ?? "", () => "") : "";
  // who must answer / do it (an open question's "who", a to-do's owner): the one "Nhắc" tags
  const who = kind === "confirmations" || kind === "actions" || kind === "msg" ? it.who ?? "" : "";
  const w: Wait = { key, chat_id: chatId, on, label, text: it.text, why: it.why ?? "", who, tickets: it.tickets ?? [], message_ids: it.message_ids ?? [], state, at: Date.now() };
  if (!await changeFollow(qc, { add: [w] })) return setDone([key], false);
  const to = ytOn && on === "design" && await designState(qc, id, state);
  toast({
    text: tr("Đã chuyển sang {on}", { on: waitName(c) }), undo: () => unpark(qc, key, true),
    action: to ? { label: tr("{id} sang {state}", { id, state: to }), run: () => void yt.setField(id, "State", to)
      .then(() => {
        void changeFollow(qc, { add: [{ ...w, state: to }] }); // waits from the design state on
        toast({ text: tr("{id} đã sang {state}", { id, state: to }) });
      })
      .catch((e) => toast({ text: tr("Không chuyển được {id}: {msg}", { id, msg: errorText(e, {}, (e as Error).message) }) })) } : undefined,
  });
}
/** Waiting items, for Saved Messages: one line each, after the digest's kinds. */
export const tgWaits = (ws: Wait[]) => ws.length
  ? [`⏳ ${tr("Chờ bổ sung")}`, ...ws.map((w) => `• ${w.text} — ${waitName(w)}${w.tickets.length ? `, ${w.tickets.join(", ")}` : ""}`)]
  : [];

/** Off the waiting list; `reopen`: back to its open list too (not settled after all). Not saved: it stays as it was. */
async function unpark(qc: QueryClient, key: string, reopen: boolean) {
  const ok = await changeFollow(qc, { drop: [key] });
  if (ok && reopen) setDone([key], false);
  return ok;
}

const stop = (e: React.MouseEvent) => e.stopPropagation(); // in a message row: a click here must not open its reply panel

/** "Chờ…" on an item still waiting on someone else, the reasons of `role` (useWaitChoices; none: no button). `itemKey`: an
 *  item that is not a digest row (a Q&A thread: its StoryAction's key; a message: msg:chat:id), else its todoKey. `icon`:
 *  an icon button, for a message's hover strip. */
export function WaitMenu({ chatId, kind, it, role, itemKey, icon }: { chatId: string; kind: string; it: WaitItem; role: YtRole; itemKey?: string; icon?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const choices = useWaitChoices(role).map(toChoice);
  if (!choices.length) return null;
  return (
    <Menu.Root>
      <Hint side="bottom" title={icon ? t("Chờ…") : undefined} text={t("Còn chờ người khác ({who}): đưa vào tab Chờ bổ sung để theo dõi và nhắc", { who: choices.map(waitName).join(" / ") })}>
        {icon ? (
          <Menu.Trigger aria-label={t("Chờ…")} onClick={stop} render={<Button type="button" size="icon-xs" variant="ghost" className="data-popup-open:bg-paper-3 data-popup-open:text-ink" />}>
            <Hourglass />
          </Menu.Trigger>
        ) : (
          <Menu.Trigger onClick={stop} className="ml-1 inline-flex h-5 items-center gap-1 rounded-md px-1 text-xs text-ink-3 hover:bg-hl-wash hover:text-hl-2 data-popup-open:bg-hl-wash data-popup-open:text-hl-2">
            <Hourglass className="size-3" aria-hidden /> {t("Chờ…")}
          </Menu.Trigger>
        )}
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="z-50 outline-none">
          <Menu.Popup onClick={stop} className={cn(MENU_POPUP, "w-56")}>
            {choices.map((c) => {
              const { Icon } = WAIT_ON[c.on];
              return <Menu.Item key={c.on + c.label} className={cn(MENU_ITEM, MENU_ACTION)} onClick={() => void park(qc, chatId, kind, it, c, itemKey)}><Icon /><span className="min-w-0 truncate">{waitName(c)}</span></Menu.Item>;
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** "Chờ…" on any group message (Cả nhóm): kept under Chờ bổ sung until someone replies to it (or, a fix / build / design
 *  wait, its first ticket moves on); "Nhắc" tags its sender. */
export function MessageWaitMenu({ m }: { m: Message }) {
  const qc = useQueryClient();
  const role = useRoleOrDev();
  const it: WaitItem = {
    text: m.text.trim().slice(0, 4000) || tr("(tin không có chữ)"), why: "", who: m.outgoing ? "" : (m.sender_name ?? ""),
    tickets: ticketsIn(m.text, qc.getQueryData<{ shortName: string }[]>(ytProjectsQuery.queryKey)), message_ids: [m.message_id],
  };
  return <WaitMenu chatId={m.chat_id} kind="msg" it={it} role={role} itemKey={`msg:${m.chat_id}:${m.message_id}`} icon />;
}

const saved = new Set<string>(); // items saved into a story while their dialog is still open
/** StoryUpdate's props for an item (`key`: its todoKey): its tickets, its text and context as the change; once saved it is
 *  marked "đã vào story", and ticked done when the dialog closes (ticked at once, its row and so the dialog would go
 *  before the comment / the group message are sent); the group is told on the message that settled it (as a rule the
 *  last one cited). */
function storyFor(qc: QueryClient, chatId: string, key: string, it: StoryItem, close: () => void) {
  const at = it.message_ids?.at(-1);
  return {
    ids: it.tickets ?? [], note: [it.text, it.why].filter(Boolean).join("\n"),
    onSaved: (id: string) => {
      saved.add(key);
      void changeFollow(qc, { storied: { [key]: { id, at: Date.now() } } });
    },
    onClose: () => { if (saved.delete(key)) setDone([key], true); close(); },
    notify: { chatId, replyTo: at }, // no message cited: a new message in the item's group
  };
}

/** "Cập nhật story": the item goes into its ticket's description; once done it reads "Đã vào story VA-1" (open again to
 *  update once more). `itemKey`: the item's todoKey. */
export function StoryAction({ chatId, itemKey, it }: { chatId: string; itemKey: string; it: StoryItem }) {
  const t = useT();
  const qc = useQueryClient();
  const ytOn = useQuery(ytOnQuery).data;
  const done = useStoried(itemKey);
  const [open, setOpen] = useState(false);
  if (!ytOn) return null;
  return (
    <>
      <Hint side="bottom" text={done ? t("Đã đưa vào mô tả {id}: bấm để cập nhật lần nữa", { id: done.id }) : t("Đưa nội dung này vào mô tả ticket (AC, nghiệp vụ) rồi báo nhóm để mọi người check")}>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}
          className={cn("ml-1 h-5 px-1 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3", done ? "font-medium text-ok" : "text-ink-3")}>
          {done ? <><Check aria-hidden /> {t("Đã vào story {id}", { id: done.id })}</> : <><FilePenLine aria-hidden /> {t("Cập nhật story")}</>}
        </Button>
      </Hint>
      {open && <StoryUpdate {...storyFor(qc, chatId, itemKey, it, () => setOpen(false))} />}
    </>
  );
}

/** "Đã vào story VA-1" on an item already handled (saving it into the story ticks it done, and a done row has no
 *  buttons): the PO still sees where it went. */
export function StoryMark({ itemKey }: { itemKey: string }) {
  const t = useT();
  const po = useRole() === "po";
  const done = useStoried(itemKey, po);
  return po && done ? <span className="inline-flex items-center gap-1 font-medium text-ok"><Check className="size-3" aria-hidden />{t("Đã vào story {id}", { id: done.id })}</span> : null;
}

/** Once a day, when something has waited LATE_DAYS or more: a desktop notification when the app is in the
 *  background (Thông báo on), else a toast; either opens Briefing on that group. One clock, mounted in the top bar of
 *  every page (Telegram, YouTrack, Tài liệu, Cài đặt). */
export function useWaitNudge(on: boolean) {
  const waits = useQuery({ ...followQuery, enabled: on }).data?.waits;
  const now = useNow();
  const router = useRouter();
  useEffect(() => {
    const late = on ? (waits ?? NONE).filter((w) => now - w.at >= LATE_DAYS * DAY) : NONE;
    const day = ymd(now);
    if (!late.length || getPref("waitNudged") === day) return;
    put("waitNudged", day);
    const text = tr("{n} việc ở Chờ bổ sung đã chờ quá {d} ngày", { n: late.length, d: LATE_DAYS });
    const open = () => goApp(router, `/?brief=${encodeURIComponent(late[0].chat_id)}`);
    if (document.hidden && readNotify()) {
      try {
        const n = new Notification(text, { tag: "brief-wait" });
        n.onclick = () => { focus(); open(); n.close(); };
      } catch {} // no Notification constructor here (Android Chrome, webviews)
    } else toast({ text, action: { label: tr("Xem"), run: open } });
  }, [on, waits, now, router]);
}

type TraceRow = { state?: string | null; updated?: number; resolved?: number | null };
/** The ticket moved on since the wait began. Still in the State it was parked in: no (a comment is not progress); a
 *  wait from before that State was kept (`state` empty): any update counts, as it did then. */
function ticketDone(w: Wait, x: TraceRow) {
  if (!x.updated || x.updated <= w.at || (w.state && (x.state ?? "") === w.state)) return false;
  const i = { state: x.state ?? null, resolved: x.resolved ?? null } as Ticket;
  return w.on === "fix" ? bucket(i) >= 2 : w.on === "build" ? !!i.resolved || isBuilt(i) : !/design/i.test(i.state ?? "");
}

/** The suggestions for a list of waits: one trace read for their tickets, one replies read for their messages. */
function useSettled(waits: Wait[], ytOn: boolean | undefined) {
  const ids = [...new Set(waits.filter((w) => BY_TICKET.has(w.on) && w.tickets[0]).map((w) => w.tickets[0]))].sort();
  const trace = useQuery({ ...ytTraceQuery(ids), enabled: !!ytOn && ids.length > 0 });
  const refs = waits.filter((w) => BY_REPLY.has(w.on) && w.message_ids.length).map(({ key, chat_id, message_ids, at }) => ({ key, chat_id, message_ids, at }));
  const replies = useQuery({
    queryKey: ["briefing-follow-replies", refs], enabled: refs.length > 0, staleTime: 60_000,
    queryFn: ({ signal }) => api<WaitReplies>("/briefing/follow/replies", { method: "POST", json: { items: refs }, signal }),
  });
  const hint = (w: Wait): string | null => {
    const x = BY_TICKET.has(w.on) && w.tickets[0] ? trace.data?.[w.tickets[0]] : undefined;
    if (x && ticketDone(w, x)) return tr("{id} đã sang {state}", { id: w.tickets[0], state: x.state ?? "Done" });
    const r = replies.data?.replies?.[w.key]?.[0];
    return r ? tr("{who} đã trả lời: {text}", { who: r.sender, text: r.text }) : null;
  };
  const failed = replies.data?.failed ?? [];
  const error = trace.error ?? replies.error;
  return { hint, failed, error };
}

const ROW = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, x: 24 }, transition: { duration: 0.2 } } as const;

/** Chờ bổ sung: the parked items (of one group, or all), oldest first; each is reminded, put in its story, or settled. */
export function WaitList({ waits, error, retry, titleOf, po }: { waits: Wait[]; error: unknown; retry: () => void; titleOf: (chatId: string) => string | undefined; po: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const now = useNow(); // one clock for the list's ages
  const ytCfg = useQuery(ytOnQuery).data;
  const ytOn = ytCfg && po; // Cập nhật story: a PO tool
  const settled = useSettled(waits, ytCfg);
  const [story, setStory] = useState<Wait | null>(null); // "Cập nhật story" offered right after Xong
  // Settled (PO): a design / the BU's answer usually changes the story, so its update is one click away.
  const settle = (w: Wait) => {
    void unpark(qc, w.key, false).then((ok) => ok &&
      toast({ text: tr("Đã xong: {text}", { text: w.text }), action: ytOn ? { label: tr("Cập nhật story"), run: () => setStory(w) } : undefined }));
  };
  const storyDialog = story && <StoryUpdate {...storyFor(qc, story.chat_id, story.key, story, () => setStory(null))} />;
  if (error) return (
    <p role="alert" className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-error">
      {errorText(error, {}, t("Không đọc được danh sách Chờ bổ sung"))}
      <Button size="xs" variant="outline" onClick={retry}><RotateCw /> {t("Thử lại")}</Button>
    </p>
  );
  if (!waits.length) return <>{storyDialog}<p className="px-4 py-10 text-center text-sm text-ink-3">{t("Không có việc nào đang chờ người khác.")}</p></>;
  return (
    <>{storyDialog}
    {(settled.error || settled.failed.length > 0) && (
      <p role="alert" className="px-2.5 pb-1 text-xs text-warn">
        {settled.error ? t("Không kiểm được việc nào đã xong: {msg}", { msg: errorText(settled.error, {}, (settled.error as Error).message) })
          : t("Không đọc được nhóm {groups}: chưa biết đã có ai trả lời chưa", { groups: settled.failed.map((c) => titleOf(c) ?? c).join(", ") })}
      </p>
    )}
    <ul aria-label={t("Chờ bổ sung")} className="zebra grid gap-0.5">
      <AnimatePresence initial={false}>
        {waits.map((w) => {
          const { Icon, nudge } = WAIT_ON[w.on];
          const days = Math.floor((now - w.at) / DAY);
          const done = settled.hint(w);
          return (
            <motion.li key={w.key} layout="position" {...ROW} className="flex gap-3 rounded-lg px-2.5 py-2.5 hover:bg-paper-2/70">
              <Hint side="bottom" text={t("Hết chờ (đã có design, build, câu trả lời…): đánh dấu xong")}>
                <button type="button" aria-label={t("Xong")} onClick={() => settle(w)}
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-rule-2 text-transparent transition-colors duration-(--dur-short) hover:border-ok hover:bg-ok-wash hover:text-ok">
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                </button>
              </Hint>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm leading-relaxed text-ink">{w.text}<Tickets ids={w.tickets} /></p>
                {w.why && <p className="text-xs leading-relaxed text-ink-3">{w.why}</p>}
                {done && (
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="min-w-0 rounded-md bg-ok-wash px-1.5 py-0.5 text-ok"><b className="font-medium">{t("Có vẻ xong")}</b> · <span className="line-clamp-1 inline">{done}</span></span>
                    <Button type="button" size="xs" variant="outline" className="h-5 px-1.5" onClick={() => settle(w)}><Check aria-hidden /> {t("Đóng")}</Button>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-3">
                  <span className="inline-flex items-center gap-1 rounded-full bg-warn-wash px-1.5 leading-5 font-medium text-warn"><Icon className="size-3" aria-hidden />{waitName(w)}</span>
                  {days >= LATE_DAYS
                    ? <span className="font-medium text-error">{t("chờ {n} ngày", { n: days })}</span>
                    : <span>{timeLabel(new Date(w.at).toISOString())}</span>}
                  {titleOf(w.chat_id) && <span className="max-w-48 truncate">{titleOf(w.chat_id)}</span>}
                  {!!w.message_ids.length && (
                    <Hint side="bottom" text={t("Mở ô trả lời ngay tin đã chốt, soạn sẵn câu nhắc, @tag sẵn người cần trả lời (nếu tìm thấy trong nhóm)")}>
                      <Button type="button" size="xs" variant="ghost" className="ml-1 h-5 px-1 text-ink-3 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3"
                        onClick={() => void tagsFor(qc, w.chat_id, people(w.who)).then((tags) => openReplyById(w.chat_id, w.message_ids.at(-1)!, tags ? `${tags} ${nudge(w.text)}` : nudge(w.text)))}><BellRing aria-hidden /> {t("Nhắc")}</Button>
                    </Hint>
                  )}
                  {po && <StoryAction chatId={w.chat_id} itemKey={w.key} it={w} />}
                  <Hint side="bottom" text={t("Không chờ nữa: trả về danh sách chưa xử lý")}>
                    <Button type="button" size="xs" variant="ghost" className="ml-1 h-5 px-1 text-ink-3 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3"
                      onClick={() => void unpark(qc, w.key, true)}><Undo2 aria-hidden /> {t("Bỏ chờ")}</Button>
                  </Hint>
                </div>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul></>
  );
}
