"use client";

import { Popover } from "@base-ui/react/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Copy, Gauge, ListTodo, Loader2, MessageCircleQuestion, PanelRightClose, Plus, RotateCw, Send, Sparkles } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { AiBot, AiStop } from "@/shared/components/ai/chat";
import { AiFetching, digestLines, useAiWait } from "@/shared/components/ai/fetching";
import { BeTopics } from "@/features/telegram/components/be-topics";
import { answeredQuery, beRepliesQuery, digestError, isClosedItem, isAnswered, openCount, todoKey, toMarkdown, useDone } from "@/features/telegram/components/digest-page";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { Segmented } from "@/shared/components/ui/segmented";
import { WeekStatsCard } from "@/features/telegram/components/week-stats";
import { type BriefingItem } from "@/shared/lib/api";
import { type Key, t as tr, useT } from "@/shared/lib/i18n";
import { copyText } from "@/shared/lib/notifications";
import { getPref, put, useRole, usesCode } from "@/shared/lib/prefs";
import { timeLabel } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { yt } from "@/features/youtrack/lib/yt";
import { briefingQuery, briefRunning, hasNews, runBrief, sortGroups, stopBrief, useBriefRun, useSaveBriefing } from "@/features/telegram/components/briefing/run";
import { FADE, KIND, KINDS, type Tab, tgBriefing, type Todo, TodoRow } from "@/features/telegram/components/briefing/todo";
import { AddGroup, RenewConsents, StatusDot } from "@/features/telegram/components/briefing/groups";
import { AiPane } from "@/features/telegram/components/briefing/assistant";

// Layout: header, a strip of group chips (status + filter), then two panes that scroll on their own: the to-do feed
// and the AI assistant (on phones one at a time). The page itself never scrolls.

const AUTO_MS = 2 * 3_600_000; // a group with news is summarized again at most this often
const AUTO_TICK = 5 * 60_000;
export const AUTO_BRIEF = "autoBrief"; // "0": no background runs (Cài đặt › Telegram)
// when each group last ran in the background: a run that fails (no text, too many messages, quota) keeps the group
// "has news" with the old digest, so without this it would run again every tick
const autoTried = new Map<string, number>();

/** Keeps Briefing fresh while the app is open: every few minutes (one shared timer) the groups that have news and a
 *  digest older than AUTO_MS run in the background batch, so opening Briefing shows it ready. Off when AI isn't set. */
export function useAutoBrief(on: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!on) return;
    const tick = async () => {
      if (briefRunning() || getPref(AUTO_BRIEF) === "0") return;
      const items = await qc.fetchQuery({ ...briefingQuery, staleTime: AUTO_TICK }).catch(() => []);
      const now = Date.now();
      const due = items.filter((i) => i.consent && hasNews(i) && (!i.saved || now - Date.parse(i.saved.created_at) >= AUTO_MS)
        && now - (autoTried.get(i.chat_id) ?? 0) >= AUTO_MS);
      for (const i of due) autoTried.set(i.chat_id, now);
      if (due.length) await runBrief(qc, due);
    };
    const first = setTimeout(() => void tick(), 60_000); // after the app has settled
    const every = setInterval(() => void tick(), AUTO_TICK);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [on, qc]);
}

const AI_PANE = "briefAi"; // "0": the AI column is hidden on desktop

function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action: ReactNode }) {
  return (
    <motion.div {...FADE} className="grid content-center justify-items-center gap-2 p-8 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-hl-wash text-hl-2">{icon}</span>
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-ink-3">{text}</p>
      <div className="mt-1">{action}</div>
    </motion.div>
  );
}

// ---- the page --------------------------------------------------------------------------------------------------------

/** Every group at a glance: a to-do feed across groups, an AI assistant over all digests, and each group's status. */
/** `group`: the one group whose items show (null: all; undefined: not picked yet, the sidebar's first group);
 *  the sidebar's Briefing tab picks it too. */
export function BriefingPage({ group: picked, onGroup, onBack, onOpenDigest }: {
  group: string | null | undefined; onGroup: (chatId: string | null) => void; onBack: () => void; onOpenDigest: (chatId: string, title: string) => void;
}) {
  const tx = useT();
  const qc = useQueryClient();
  const list = useQuery(briefingQuery);
  const wait = useAiWait(list.isPending);
  const { runs, batch } = useBriefRun(); // null batch: nothing running
  const [aiOpen, setAiOpen] = useState(() => getPref(AI_PANE) === "1"); // desktop: closed until asked for, the list gets the room
  const showAi = (on: boolean) => { setAiOpen(on); put(AI_PANE, on ? "1" : null); };
  const [tab, setTab] = useState<Tab | null>(null); // null: the first tab with something left
  const [showDone, setShowDone] = useState(false);
  const [pane, setPane] = useState<"todo" | "ai">("todo"); // phones: one pane at a time

  const items = list.data ?? [];
  const allowed = items.filter((i) => i.consent);
  const blocked = items.filter((i) => !i.consent);
  const todo = allowed.filter(hasNews);
  const offline = allowed.length > 0 && allowed.every((i) => i.latest_id == null);
  const summarized = allowed.some((i) => i.saved);
  // Items whose cited message I have replied to on Telegram tick themselves off.
  const answered = useQuery({ ...answeredQuery, enabled: summarized });
  const beReplies = useQuery({ ...beRepliesQuery, enabled: summarized }).data; // BE answered since the digest
  const [done, toggle] = useDone();
  // Asked of / assigned to me (my YouTrack name; a PO also answers to "PO" / "PM").
  const role = useRole();
  const me = useQuery({ queryKey: ["yt", "me"], queryFn: yt.me, staleTime: Infinity, retry: false }).data?.name?.toLowerCase();
  const isMine = (who: string) => (!!me && who.toLowerCase().includes(me)) || (role === "po" && /\b(PO|PM|product owner)\b/i.test(who));
  const todos: Todo[] = allowed.flatMap((chat) => KINDS.flatMap((kind) =>
    (chat.saved?.result[kind] ?? []).map((it) => {
      const ask = kind === "confirmations" || kind === "actions";
      return {
        ...it, kind, chat, key: todoKey(chat.chat_id, kind, it),
        mine: ask && isMine(it.who ?? ""),
        replied: ask && !!it.message_ids?.some((id) => answered.data?.[chat.chat_id]?.includes(id)),
      };
    })));
  const isClosed = (t: Todo) => t.replied || done.has(t.key);
  const pending = (t: Todo) => !isClosed(t) && (t.kind === "confirmations" || t.kind === "actions");
  const leftAll = todos.filter(pending).length;
  // Opening Briefing lands on the sidebar's first group, pinned so the order shifting after a summary doesn't jump away.
  const first = sortGroups(items, (i) => openCount(i.chat_id, i.saved?.result, done, answered.data))[0]?.chat_id;
  const group = picked === undefined ? first ?? null : picked;
  useEffect(() => { if (picked === undefined && first) onGroup(first); }, [picked, first, onGroup]);

  const shown = group ? todos.filter((t) => t.chat.chat_id === group) : todos;
  const tabs: [Tab, Key, string][] = [
    ...(todos.some((x) => x.mine) ? [["mine", "Cần bạn", "bg-hl"] as [Tab, Key, string]] : []),
    // always for Dev (an empty one says how to get BE topics); QA / PO: none, its items stay in the kind tabs
    ...(usesCode(role) ? [["be", "Với BE", "bg-code"] as [Tab, Key, string]] : []),
    ...KINDS.map((k) => [k, KIND[k].label, KIND[k].dot] as [Tab, Key, string]),
  ];
  const inTabOf = (t: Tab) => shown.filter((x) => (t === "mine" ? x.mine : t === "be" ? x.be : x.kind === t));
  // "Với BE": topics still waiting on BE (as its "N chờ trả lời"); what is settled stays listed for the code check, uncounted.
  const left = (t: Tab) => t === "be"
    ? new Set(inTabOf(t).filter((x) => x.kind === "confirmations" && !isClosed(x) && !isAnswered(x, beReplies?.[x.chat.chat_id])).map((x) => `${x.chat.chat_id}:${x.topic || x.text}`)).size
    : inTabOf(t).filter((x) => !isClosed(x)).length;
  const cur = tabs.find(([t]) => t === tab)?.[0] ?? tabs.find(([t]) => left(t))?.[0] ?? "confirmations";
  const inTab = inTabOf(cur);
  const openItems = inTab.filter((x) => !isClosed(x));
  const closedItems = inTab.filter(isClosed);

  const last = allowed.map((i) => i.saved?.created_at).filter((x): x is string => !!x).sort().at(-1);
  const running = batch !== null;
  const now = allowed.find((i) => runs[i.chat_id]?.status === "running");
  const save = useSaveBriefing();

  const run = (groups: BriefingItem[], hours?: number) => runBrief(qc, groups, hours);
  // Digests made before BE topics existed: nothing in them is sorted by topic, so "Với BE" stays empty until a re-read.
  const legacy = allowed.filter((c) => c.saved && !KINDS.some((k) => c.saved!.result[k]?.some((it) => it.topic)))
    .filter((c) => !group || c.chat_id === group);

  async function copyAll() {
    const parts = allowed.filter((i) => i.saved).map((i) => toMarkdown(i.saved!.result, i.title).replace(/^# /, "## "));
    await copyText([`# Briefing ${timeLabel(new Date().toISOString(), true)}`, ...parts].join("\n\n"), tr("Đã copy markdown"));
  }

  const open = (i: Pick<BriefingItem, "chat_id" | "title">) => onOpenDigest(i.chat_id, i.title);
  // "Với BE" tab: each group's open Q&A with BE as topic cards (questions next to BE's answers), checkable against the code.
  const beCards = (c: BriefingItem) => c.saved && (
    <BeTopics chatId={c.chat_id} title={c.title} r={c.saved.result}
      open={(k, it) => !isClosedItem(c.chat_id, k, it, done, answered.data)} onToggle={(k, it) => toggle(todoKey(c.chat_id, k, it))} />
  );
  const beGroups = (group ? allowed.filter((c) => c.chat_id === group) : allowed).filter((c) => openItems.some((t) => t.chat === c));
  const byGroup = !group && allowed.length > 1; // all groups: items sit under their group's heading
  const row = (t: Todo) => (
    <TodoRow key={t.key} t={t} closed={isClosed(t)} showKind={cur === "mine" || cur === "be"} showGroup={byGroup && isClosed(t)}
      onToggle={() => toggle(t.key)} onOpen={() => open(t.chat)} />
  );
  const scope = group ? allowed.find((c) => c.chat_id === group) : undefined;
  const runFor = scope ? todo.filter((c) => c === scope) : todo; // one group picked in the sidebar: just that one
  const runButton = (
    <Button id="briefing-run" size="sm" disabled={!runFor.length || running} onClick={() => void run(runFor)}>
      <Sparkles /> {!runFor.length ? tx("Đã cập nhật") : scope ? tx("Tóm tắt tin mới") : tx("Tóm tắt tin mới · {n} nhóm", { n: runFor.length })}
    </Button>
  );
  const scopeLeft = shown.filter(pending).length;
  // The group on screen is being read (or nothing is summarized yet and a run is on): its AI scene, not an empty list.
  const reading = scope ? runs[scope.chat_id]?.status === "running" ? scope : undefined : !summarized ? now : undefined;
  const readingShown = useAiWait(!!reading);

  return (
    <MotionConfig reducedMotion="user">
      <section aria-label="Briefing" className="flex min-h-0 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 md:px-5">
          <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label={tx("Quay lại")}>
            <ArrowLeft />
          </Button>
          <div className="grid min-w-0 gap-0.5">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
              <span className="truncate">{scope?.title ?? tx("Tất cả nhóm")}</span>
              {scope && (
                <Hint side="bottom" text={tx("Xem việc của mọi nhóm")}>
                  <button type="button" onClick={() => onGroup(null)} className="shrink-0 rounded-sm text-xs font-normal text-ink-3 hover:text-ink hover:underline">{tx("Tất cả")}</button>
                </Hint>
              )}
            </h2>
            <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-3">
              {!list.data ? tx("Đang kiểm tra các nhóm…") : <>
                <span>{tx.n("{n} việc chờ xử lý", { n: <b className="font-bold text-ink-2 tabular-nums">{scope ? scopeLeft : leftAll}</b> })}</span>
                {(scope?.saved?.created_at ?? last) && <span className="hidden sm:inline">{tx("· cập nhật {time}", { time: timeLabel((scope?.saved?.created_at ?? last)!) })}</span>}
                {offline && <span className="text-warn">{tx("· Telegram chưa kết nối")}</span>}
              </>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <Popover.Root>
              <Hint side="bottom" text={tx("Tuần của tôi: số tag nhận, đã xử lý, thời gian xử lý")}>
                <Popover.Trigger aria-label={tx("Tuần của tôi")}
                  className="grid size-8 place-items-center rounded-md text-ink-2 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink data-popup-open:bg-hl-wash data-popup-open:text-hl-2">
                  <Gauge className="size-4" aria-hidden />
                </Popover.Trigger>
              </Hint>
              <Popover.Portal>
                <Popover.Positioner sideOffset={6} align="end" className="z-40 outline-none">
                  <Popover.Popup aria-label={tx("Tuần của tôi")}
                    className="w-[min(40rem,calc(100vw-2rem))] origin-(--transform-origin) rounded-lg bg-cotton p-3 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
                    <WeekStatsCard className="" empty={<p className="text-sm text-ink-3">{tx("Chưa có số liệu tuần này.")}</p>} />
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <Hint side="bottom" text={tx("Kiểm tra lại tin mới ở các nhóm")}>
              <Button size="icon-sm" variant="ghost" aria-label={tx("Kiểm tra lại")} disabled={running || list.isFetching}
                onClick={() => { void list.refetch(); void answered.refetch(); }}>
                <RotateCw className={cn(list.isFetching && "animate-spin")} />
              </Button>
            </Hint>
            <Hint side="bottom" text={tx("Copy tóm tắt của mọi nhóm thành một file markdown")}>
              <Button size="icon-sm" variant="ghost" aria-label={tx("Copy tất cả")} disabled={!summarized} onClick={() => void copyAll()}>
                <Copy />
              </Button>
            </Hint>
            <Hint side="bottom" text={tx("Gửi các mục chưa xử lý của mọi nhóm vào Saved Messages trên Telegram")}>
              <Button size="icon-sm" variant="ghost" aria-label={tx("Gửi vào Saved Messages")} disabled={!summarized || save.isPending}
                onClick={() => save.mutate(tgBriefing(todos.filter((t) => !isClosed(t))))}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </Hint>
            {summarized && (
              <Hint side="bottom" text={aiOpen ? tx("Ẩn Trợ lý AI để danh sách rộng hơn") : tx("Mở Trợ lý AI: hỏi về mọi nhóm")}>
                <Button size="sm" variant="ghost" className={cn("max-lg:hidden", aiOpen && "text-hl-2")} aria-pressed={aiOpen}
                  aria-label={tx("Trợ lý AI")} onClick={() => showAi(!aiOpen)}>
                  {aiOpen ? <PanelRightClose /> : <><AiBot className="size-4" /> {tx("Hỏi AI")}</>}
                </Button>
              </Hint>
            )}
            <span className="ml-1.5 flex items-center gap-2">
              {batch ? <>
                {batch.total > 1 && <span className="text-xs text-ink-3 tabular-nums">{Math.min(batch.done + 1, batch.total)}/{batch.total}</span>}
                <AiStop onClick={stopBrief} label={tx("Dừng tóm tắt")} hint={tx("Dừng tóm tắt (nhóm đang chạy bị hủy)")} />
              </> : runFor.length > 0 && runButton /* nothing new since the last digest: nothing to run */}
            </span>
          </div>
        </header>

        <AnimatePresence initial={false}>
          <RenewConsents key="renew" items={items} />
        </AnimatePresence>

        {summarized && (
          <div className="shrink-0 px-3 pt-2 lg:hidden">
            <Segmented id="brief-pane" label={tx("Khung")} variant="card" value={pane} onChange={setPane}
              items={[{ value: "todo", label: <><ListTodo className="size-3.5" aria-hidden />{tx("Việc · {n}", { n: leftAll })}</> }, { value: "ai", label: <><Sparkles className="size-3.5" aria-hidden />{tx("Trợ lý AI")}</> }]} />
          </div>
        )}

        {/* desktop: the AI column slides between 0 and 26rem (same track count, so the grid animates) */}
        <div className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] duration-(--dur-long) ease-(--ease-out) lg:transition-[grid-template-columns] motion-reduce:transition-none",
          summarized && (aiOpen ? "lg:grid-cols-[minmax(0,1fr)_26rem]" : "lg:grid-cols-[minmax(0,1fr)_0rem]"))}>
          <div className={cn("flex min-h-0 flex-col", summarized && pane === "ai" && "max-lg:hidden")}>
            {wait ? (
              <AiFetching kind="brief" />
            ) : readingShown ? (
              <AiFetching kind="digest" lines={digestLines((reading ?? scope ?? now)?.title)} />
            ) : list.isError ? (
              <p role="alert" className="flex items-center gap-2 p-5 text-sm text-error">
                {digestError(list.error)}
                <Button size="xs" variant="outline" onClick={() => void list.refetch()}><RotateCw /> {tx("Thử lại")}</Button>
              </p>
            ) : !allowed.length ? (
              <Empty icon={<Plus className="size-5" aria-hidden />} title={tx("Chưa có nhóm nào trong Briefing")}
                text={tx("Chọn một nhóm, cho phép AI đọc, rồi mỗi sáng chỉ cần bấm một nút để biết: ai đang chờ bạn, đã chốt gì, việc gì cần làm.")}
                action={
                  <AddGroup blocked={blocked} known={new Set(items.map((i) => i.chat_id))} onPick={onOpenDigest}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-hl px-3 text-sm font-medium text-hl-ink hover:brightness-110">
                    <Plus className="size-4" aria-hidden /> {tx("Thêm nhóm")}
                  </AddGroup>
                } />
            ) : !summarized ? (
              <Empty icon={<Sparkles className="size-5" aria-hidden />} title={tx("Chưa có bản tóm tắt nào")}
                text={tx("Tóm tắt các nhóm có tin mới: AI gom câu hỏi cần confirm, việc cần làm, quyết định và thay đổi vào một danh sách.")} action={runButton} />
            ) : (
              <>
                <div className="shrink-0 overflow-x-auto px-3 pt-3 [scrollbar-width:none] md:px-5">
                  <Segmented id="brief-tab" label={tx("Lọc việc")} value={cur} className="w-max"
                    onChange={(v) => { setTab(v); setShowDone(false); }}
                    items={tabs.map(([v, l]) => ({
                      value: v,
                      label: <span className="flex items-center gap-1.5">{tx(l)}<span className="font-mono tabular-nums opacity-70">{left(v)}</span></span>,
                      title: v === "mine" ? tx("Câu hỏi chờ bạn trả lời và việc giao cho bạn (theo tên YouTrack / vai trò PO)")
                        : v === "be" ? tx("Hỏi / trả lời / chốt với BE (API, field, data): đối chiếu với code để không sót") : undefined,
                    }))} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-4 md:px-3">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={`${cur}:${group}`} {...FADE}>
                      {cur === "be" && !openItems.length && legacy.length ? (
                        <Empty icon={<MessageCircleQuestion className="size-5" aria-hidden />} title={tx("Bản tóm tắt chưa gom theo chủ đề BE")}
                          text={tx("{groups}: bản tóm tắt làm trước khi có tính năng này. Đọc lại 7 ngày gần nhất để AI gom câu hỏi / trả lời với BE theo chủ đề.", { groups: legacy.map((c) => c.title).join(", ") })}
                          action={<Button size="sm" disabled={running} onClick={() => void run(legacy, 168)}><Sparkles /> {tx("Đọc lại 7 ngày · {n} nhóm", { n: legacy.length })}</Button>} />
                      ) : openItems.length && cur === "be" ? (
                        <div className="grid gap-4 px-1.5">
                          {beGroups.map((c) => (
                            <section key={c.chat_id} aria-label={c.title} className="grid gap-1.5">
                              {beGroups.length > 1 || !group ? (
                                <h3 className="flex items-center gap-2 text-xs font-bold text-ink-2">
                                  <StatusDot i={c} r={runs[c.chat_id]} />
                                  <button type="button" onClick={() => open(c)} className="min-w-0 truncate rounded-sm hover:text-ink hover:underline">{c.title}</button>
                                </h3>
                              ) : null}
                              {beCards(c)}
                            </section>
                          ))}
                        </div>
                      ) : openItems.length ? (
                        byGroup ? (
                          <div className="grid gap-3">
                            {allowed.map((c) => [c, openItems.filter((t) => t.chat === c)] as const).filter(([, its]) => its.length).map(([c, its]) => (
                              <section key={c.chat_id} aria-label={c.title} className="grid gap-0.5">
                                <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-cotton/95 px-2.5 py-1 text-xs font-bold text-ink-2 backdrop-blur-sm">
                                  <StatusDot i={c} r={runs[c.chat_id]} />
                                  <button type="button" onClick={() => onGroup(c.chat_id)} className="min-w-0 truncate rounded-sm hover:text-ink hover:underline">{c.title}</button>
                                  <span className="font-mono font-normal text-ink-3 tabular-nums">{its.length}</span>
                                  <Hint side="bottom" text={tx("Mở trang tóm tắt của nhóm")}>
                                    <button type="button" aria-label={tx("Mở {title}", { title: c.title })} onClick={() => open(c)} className="grid size-5 place-items-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
                                      <ArrowUpRight className="size-3" aria-hidden />
                                    </button>
                                  </Hint>
                                </h3>
                                <ul className="zebra grid gap-0.5"><AnimatePresence initial={false}>{its.map(row)}</AnimatePresence></ul>
                              </section>
                            ))}
                          </div>
                        ) : (
                          <ul aria-label={tx("Việc cần xử lý")} className="zebra grid gap-0.5"><AnimatePresence initial={false}>{openItems.map(row)}</AnimatePresence></ul>
                        )
                      ) : (
                        <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
                          <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}
                            className="grid size-10 place-items-center rounded-full bg-ok-wash text-ok">
                            <Check className="size-5" strokeWidth={2.5} aria-hidden />
                          </motion.span>
                          <p className="text-sm font-medium text-ink">{inTab.length ? tx("Đã xử lý hết mục này") : cur === "mine" ? tx("Không có gì đang chờ bạn") : tx("Không có mục nào")}</p>
                          {inTab.length > 0 && <p className="text-xs text-ink-3">{tx("Mục mới sẽ hiện ở đây sau lần tóm tắt tới.")}</p>}
                        </div>
                      )}
                      {closedItems.length > 0 && (
                        <div className="mt-2 grid gap-1 border-t border-rule px-2.5 pt-2">
                          <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}
                            className="flex items-center gap-1 justify-self-start rounded-sm text-xs text-ink-3 hover:text-ink">
                            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out)", showDone && "rotate-90")} aria-hidden />
                            {tx("Đã xử lý {n}", { n: closedItems.length })}
                          </button>
                          <AnimatePresence initial={false}>
                            {showDone && (
                              <motion.ul key="done" {...FADE} className="zebra -mx-2.5 grid gap-0.5">
                                <AnimatePresence initial={false}>{closedItems.map(row)}</AnimatePresence>
                              </motion.ul>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>
          {summarized && ( // nothing to ask before a digest exists
            // clipped while it slides; fixed width inside so the text doesn't reflow; invisible (not focusable) once closed
            <div className={cn("min-h-0 overflow-hidden duration-(--dur-long) ease-(--ease-out) lg:transition-[visibility,opacity] motion-reduce:transition-none",
              pane === "todo" && "max-lg:hidden", !aiOpen && "lg:invisible lg:opacity-0")}>
              <AiPane ready onSave={(t) => save.mutate(t)} saving={save.isPending} onClose={() => showAi(false)} className="h-full lg:w-[26rem]" />
            </div>
          )}
        </div>
      </section>
    </MotionConfig>
  );
}
