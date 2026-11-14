"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BellOff, BellRing, MessageCircleQuestion, Plus, Reply, RotateCw, Search, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { DayGroups, DayTrash, dayOf, newestDay, RailSection, revealRow, useDayFold } from "@/shared/components/ai/day-groups";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { groupMembers } from "@/features/telegram/lib/mentions";
import { Button } from "@/shared/components/ui/button";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Empty, NoPick } from "@/shared/components/ui/empty";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { api, errorText, type Message, type QaItem, type QaPosted } from "@/shared/lib/api";
import { type Key, t as tr, useT } from "@/shared/lib/i18n";
import { groupsQuery, msgKey, QA_PREFILL, sentQuery, takeQaAnswer, typing } from "@/features/telegram/lib/inbox";
import { useNow } from "@/shared/hooks/use-now";
import { toast } from "@/shared/lib/notifications";
import { fold } from "@/shared/lib/utils";
import { getPref, QA_REMIND_CHOICES, qaRemindLabel, setPref, useQaRemind } from "@/shared/lib/prefs";
import { parsePref, rememberQaGroup } from "@/features/telegram/lib/qa-recent";
import { cn } from "@/shared/lib/utils";
import { answered, atOf, deleteWithUndo, fresh, gist, hasTag, isLate, latest, markSeen, markWithUndo, mute, MUTED, nameTags, nudgeText, QA_DAYS, QA_MINE, qaQuery, type QaDays, resolve, resolvedIds, type Seen, SEEN, type Sent, sendable, sentCount, thread, useStored, waiting, who } from "@/features/telegram/lib/qa";
import { DaysPicker, LoadError, Row } from "@/features/telegram/components/qa/bits";
import { Thread } from "@/features/telegram/components/qa/thread";
import { MyQuestions, QaGroups } from "@/features/telegram/components/qa/groups";
import { draftStore, QaBox } from "@/features/telegram/components/qa/box";

// Q&A: post a question to any group (the text, then a "#QA…" line the backend adds) and read each one back as a thread:
// the question and the whole reply chain under it (backend /api/qa, live from Telegram, one group at a time).
// Layout: the questions as a list, the open one read beside it (one at a time on narrow screens), the box under it.

type Filter = "open" | "done" | "unsent" | "closed" | "mine" | "all";
const FILTERS: [Filter, Key, (i: QaItem, sent: Sent) => boolean, Key | ""][] = [
  ["all", "Tất cả", () => true, ""],
  ["open", "Chờ trả lời", waiting, "Người được tag chưa trả lời (hoặc bất kỳ ai ngoài người hỏi, theo Cài đặt), chưa chốt, chưa đánh dấu xong"],
  ["done", "Đã trả lời", (i) => !i.done && answered(i), "Người được tag đã trả lời (hoặc bất kỳ ai, theo Cài đặt), hoặc bạn đã chốt câu trả lời"],
  ["unsent", "Chưa gửi AI", (i, s) => !!s && !i.done && sentCount(i, s) < sendable(i).length,
    "Còn tin của người khác (trả lời, hoặc câu hỏi chưa ai trả lời) chưa gửi kèm vào phiên AI Agent / Đối chiếu BE / Trợ lý AI nào; chưa đánh dấu xong"],
  ["closed", "Xong", (i) => i.done, "Bạn đã đánh dấu xong: không nhắc, không tính là chờ"],
  ["mine", "Bạn hỏi", (i) => i.question.outgoing, "Câu hỏi bạn đăng"],
];

/** Q&A page: one group's questions and the open thread; with no group picked yet, the groups to pick from.
 *  `focus`: a "#QA…" code to open (a badge on a message), widening to 30 days when it is older. */
export function QaPage({ focus, group, onGroup, days, onDays, onBack }: {
  focus: string | null; group: string | null; onGroup: (chatId: string) => void; days: QaDays; onDays: (d: QaDays) => void; onBack: () => void;
}) {
  const tx = useT();
  const groups = useQuery(groupsQuery);
  const title = groups.data?.find((g) => g.chat_id === group)?.title;
  return (
    <section aria-label="Q&A" className="flex min-h-0 flex-col">
      {group === QA_MINE ? <MyQuestions days={days} onDays={onDays} /> : group ? <GroupQa key={group} chatId={group} title={title} focus={focus} days={days} onDays={onDays} /> : (
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-4 sm:p-6">
          <div className="grid w-full max-w-sm justify-items-center gap-2 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-hl-wash text-hl-2"><MessageCircleQuestion className="size-5" aria-hidden /></span>
            <p className="text-sm font-bold text-ink">{tx("Hỏi nhóm nào?")}</p>
            <p className="text-sm leading-relaxed text-ink-3">{tx("Đăng câu hỏi vào bất kỳ nhóm nào (kèm mã #QA…) và xem lại từng câu với cả chuỗi trả lời.")}</p>
            <div className="mt-2 h-[min(55vh,26rem)] w-full rounded-xl border bg-cotton pt-2 text-left">
              <QaGroups days={days} selected={null} onSelect={onGroup} collapsed={false} />
            </div>
            <Button size="sm" variant="ghost" className="md:hidden" onClick={onBack}><ArrowLeft /> {tx("Việc cần xử lý")}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function GroupQa({ chatId, title, focus, days, onDays }: {
  chatId: string; title?: string; focus: string | null; days: QaDays; onDays: (d: QaDays) => void;
}) {
  const tx = useT();
  const qc = useQueryClient();
  const list = useQuery({ ...qaQuery(chatId, days), refetchInterval: 60_000 }); // answers show up while you read
  const listWait = useAiWait(list.isPending);
  const sentQ = useQuery(sentQuery);
  const sent = sentQ.data;
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  // The box text lives outside this component's state: a keystroke re-renders only the box, not the list and thread.
  const [draft] = useState(() => draftStore(`qa-draft:${chatId}`));
  useEffect(() => draft.flush, [draft]); // leaving within the save debounce
  const edit = draft.set;
  // The open thread's code, or "new": the empty box on its own. The box shows only then (`reading`).
  const [open, setOpen] = useState<string | null>(null);
  const [target, setTarget] = useState<Message | null>(null); // the message picked to answer (default: the thread's last)
  const box = useRef<HTMLDivElement>(null);
  const focusBox = () => box.current?.querySelector("textarea")?.focus();
  const pick = (m: Message) => { setTarget(m); focusBox(); };
  const [read, setRead] = useState<ReadonlySet<string>>(new Set()); // opened this visit: the list drops their "mới"
  const [autoText, setAutoText] = useState(""); // the nudge last put in the box: dropped on leaving its thread unsent
  const show = (code: string | null) => {
    setOpen(code);
    setTarget(null);
    if (code) setRead((r) => new Set(r).add(code));
    if (autoText && draft.get() === autoText) edit(""); // a nudge tags that thread's people: never carry it to another
  };
  const mins = useQaRemind();
  const muted = useStored<string[]>(MUTED, []);
  // Nudge: open the thread, answer the question itself (Telegram quotes it), a reminder line in the box unless you
  // already typed something. Sending stays one Enter: nothing goes to the group on its own.
  const [ask, setAsk] = useState(0); // bumped: focus the box once the opened thread has rendered
  useEffect(() => { if (ask) box.current?.querySelector("textarea")?.focus(); }, [ask]);
  const nudge = (i: QaItem) => {
    show(i.code);
    setTarget(i.question);
    if (!draft.get().trim() || draft.get() === autoText) {
      const first = nudgeText(i); // "@Name" now; "@username" once the group's members load (the "@" popup's cache)
      edit(first);
      setAutoText(first);
      if (Object.keys(nameTags(i.question)).length) {
        const src = groupMembers(i.question.chat_id);
        qc.fetchQuery({ queryKey: src.queryKey, queryFn: src.queryFn, staleTime: 5 * 60_000 }).then((ms) => {
          const text = nudgeText(i, ms);
          if (text !== first && draft.get() === first) { edit(text); setAutoText(text); } // untouched since
        }, () => {}); // members hidden / offline: the "@Name" tag stays, it still tags them
      }
    }
    setAsk((n) => n + 1);
  };
  const onMute = (i: QaItem, off: boolean) => {
    mute(i.code, off);
    if (off) toast({ text: tr("Đã bỏ qua nhắc {code}", { code: i.code }), undo: () => mute(i.code, false) });
  };
  const onResolve = (i: QaItem, id: string | null) => {
    const was = resolvedIds()[i.code] ?? null;
    resolve(i.code, id);
    toast({ text: id ? tr("Đã chốt câu trả lời cho {code}", { code: i.code }) : tr("Đã bỏ chốt {code}", { code: i.code }), undo: () => resolve(i.code, was) });
  };
  // "Trả lời bằng Q&A" on a message of this group, from anywhere (taken on open, or while open).
  useEffect(() => {
    const take = () => { const m = takeQaAnswer(chatId); if (m) { setOpen("new"); setTarget(m); requestAnimationFrame(focusBox); } };
    take();
    addEventListener("qa-answer", take);
    return () => removeEventListener("qa-answer", take);
  }, [chatId]);
  // "Hỏi lại trong nhóm" from a YouTrack ticket (the inbox stores `qa-prefill` and opens this group): a new question
  // with that text, under whatever you had typed.
  useEffect(() => {
    const take = () => {
      let p: { chatId?: string; text?: string } | null = null;
      try { p = JSON.parse(sessionStorage.getItem(QA_PREFILL) ?? "null"); } catch {}
      if (!p?.text || p.chatId !== chatId) return;
      try { sessionStorage.removeItem(QA_PREFILL); } catch {}
      const cur = draft.get().trim();
      setOpen("new");
      setTarget(null);
      edit(cur ? `${cur}\n${p.text}` : p.text);
      requestAnimationFrame(focusBox);
    };
    take();
    addEventListener(QA_PREFILL, take);
    return () => removeEventListener(QA_PREFILL, take);
  }, [chatId, draft, edit]);

  // "Mới" is against what you had seen when the group opened; everything shown counts as seen from then on.
  const [seenAt, setSeenAt] = useState(() => parsePref<Seen>(getPref(SEEN), {}));
  useEffect(() => {
    if (list.data) markSeen(list.data.map((i) => [i.code, Math.max(...thread(i).map((m) => Number(m.message_id)))]));
  }, [list.data]);


  // One-shot open of a code once the list has it (effect below the list).
  const want = useRef<{ code: string; widen: boolean } | null>(focus ? { code: focus, widen: true } : null);
  const items = list.data ?? [];
  const cur = items.find((i) => i.code === open);
  const to = target ?? (cur && latest(cur)) ?? null; // what a send answers; none: a new question
  // A target outside every thread (someone's question): the answer opens a thread on it.
  const start = !!target && !!list.data && !items.some((i) => thread(i).some((m) => msgKey(m) === msgKey(target)));
  const reading = !!cur || open === "new" || !!target; // narrow screens: the reader takes the list's place

  const post = useMutation({
    mutationFn: (text: string) => api<QaPosted>("/qa", { method: "POST", json: { chat_id: chatId, text, reply_to: to?.message_id ?? null, start } }),
    onSuccess: (r) => {
      rememberQaGroup(chatId);
      edit("");
      setTarget(null);
      if (r.code) {
        markSeen([[r.code, Number(r.message_id)]]);
        setSeenAt((x) => ({ ...x, [r.code!]: Number(r.message_id) })); // you just answered it: nothing in it is "Mới"
        setFilter("all");
        setFind("");
        want.current = { code: r.code, widen: r.joined }; // joined: an older thread, maybe outside the range
      }
      toast({ text: r.joined ? tr("Đã trả lời trong chuỗi {code}", { code: r.code ?? "" }) : r.code ? tr(start ? "Đã trả lời, mở Q&A {code}" : "Đã đăng câu hỏi {code}", { code: r.code })
        : !to || start ? tr("Đã gửi như tin thường: không tag ai nên không tạo Q&A") : tr("Đã gửi trả lời") });
      void qc.invalidateQueries({ queryKey: ["qa", chatId] });
    },
    onError: (e) => toast({ text: errorText(e, { forbidden: tr("Nhóm không cho bạn gửi tin"), reply_not_found: tr("Tin được trả lời không còn") }, tr("Không gửi được, thử lại")) }),
  });
  const send = (t: string) => { if (t.trim() && !post.isPending) post.mutate(t); };

  const s = fold(find.trim());
  const keep = FILTERS.find(([f]) => f === filter)![2];
  const shown = items.filter((i) => keep(i, sent))
    .filter((i) => !s || fold(`${i.code} ${thread(i).map((m) => `${who(m)} ${m.text}`).join(" ")}`).includes(s));
  // Your questions due a nudge lead the list (what needs you first), the rest by the day of their latest message
  // (`DayGroups`, the AI Agent rail's). Days start folded but the newest; "late" starts open. A bar click folds /
  // unfolds (this visit only); j / k skip folded days; a search opens every day.
  const late = shown.filter((i) => isLate(i, mins, now, muted));
  const rest = shown.filter((i) => !late.includes(i));
  const newest = newestDay(rest, atOf);
  const dayFold = useDayFold((d) => d === "late" || d === newest);
  const [isOpen, fold1] = dayFold;
  const ordered = [...(isOpen("late") ? late : []), ...rest.filter((i) => !!s || isOpen(dayOf(atOf(i)))).sort((a, b) => atOf(b) - atOf(a))];
  const dayTrash = (its: QaItem[], what: string) => (
    <DayTrash label={tx("Xóa {n} Q&A {what}", { n: its.length, what })} ask={tx("Xóa {n} câu?", { n: its.length })} onRemove={() => remove(its)}
      hint={tx("Xóa {n} câu của {what} khỏi Q&A trên dashboard (tin trên Telegram vẫn còn). Bấm 2 lần để xác nhận", { n: its.length, what })} />
  );
  // Its day folded: open it so the row shows.
  const reveal = useEffectEvent((it: QaItem) => {
    const d = late.includes(it) ? "late" : dayOf(atOf(it));
    if (!isOpen(d)) fold1(d);
  });
  // One-shot open of a code once the list has it: a badge's code (not in range: widen to 30 days, then give up)
  // or the question just posted (waits for the refetch).
  useEffect(() => {
    const w = want.current;
    if (!w || !list.data) return;
    if (!list.data.some((i) => i.code === w.code)) {
      if (!w.widen) return;
      if (days < 30) return onDays(30);
      want.current = null;
      toast({ text: tr("Không thấy {code} trong 30 ngày qua của nhóm này", { code: w.code }) });
      return;
    }
    want.current = null;
    reveal(list.data.find((i) => i.code === w.code)!);
    setOpen(w.code); // `show` minus the nudge cleanup: a send already emptied the box
    setTarget(null);
    setRead((r) => new Set(r).add(w.code));
    requestAnimationFrame(() => revealRow(document.querySelector<HTMLElement>(`[data-qa="${CSS.escape(w.code)}"]`)));
  }, [list.data, days, onDays]);

  const remove = (its: QaItem[]) => { if (cur && its.includes(cur)) show(null); void deleteWithUndo(qc, its); };
  const qaRow = (i: QaItem, isLate: boolean) => (
    <Row key={i.code} i={i} now={now} on={i.code === open} news={read.has(i.code) ? 0 : fresh(i, seenAt).length} late={isLate} sent={sent}
      onOpen={() => show(i.code === open ? null : i.code)} onNudge={() => nudge(i)} onMute={() => onMute(i, true)} onDelete={() => remove([i])} />
  );

  // j / k the next / previous question, r the box, Esc back to the list (outside text fields).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || typing(e)) return;
    if (e.key === "Escape" && reading) return show(null);
    if (e.key === "r" && reading) { e.preventDefault(); return focusBox(); }
    if (e.key !== "j" && e.key !== "k") return;
    const k = ordered.findIndex((i) => i.code === open);
    const next = ordered[e.key === "j" ? k + 1 : Math.max(0, k - 1)];
    if (!next) return;
    e.preventDefault();
    show(next.code);
    document.querySelector(`[data-qa="${CSS.escape(next.code)}"]`)?.scrollIntoView({ block: "nearest" });
  });
  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="@container/qa grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2 @4xl/qa:px-4">
        <div className={cn("max-w-full overflow-x-auto [scrollbar-width:none]", reading && "@max-4xl/qa:hidden")}>
          <Segmented id="qa-filter" label={tx("Lọc Q&A")} value={filter} onChange={setFilter} className="w-max"
            items={FILTERS.map(([v, l, f, hint]) => ({
              value: v, title: hint ? tx(hint) : undefined,
              label: <span className="flex items-center gap-1.5">{tx(l)}<span className="font-mono tabular-nums opacity-70">{items.filter((i) => f(i, sent)).length}</span></span>,
            }))} />
        </div>
        <label className={cn("relative min-w-36 flex-1 @2xl/qa:max-w-64", reading && "@max-4xl/qa:hidden")}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx("Tìm nội dung, người, #QA…")} aria-label={tx("Tìm Q&A")}
            className="h-8 pl-8 text-xs md:text-xs" />
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          <DaysPicker days={days} onDays={onDays} />
          <Hint side="bottom" text={tx("Nhắc khi câu hỏi của bạn chưa ai trả lời sau khoảng này (cũng ở Cài đặt › Telegram)")}>
            <span className="inline-flex">
              <Dropdown label={tx("Nhắc khi chưa ai trả lời sau")} value={String(mins)} onChange={(v) => setPref("qaRemindMins", v)} className="w-[7.25rem]"
                prefix={mins ? <BellRing aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : <BellOff aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
                options={QA_REMIND_CHOICES.map((m) => ({ value: String(m), label: qaRemindLabel(m), hint: m ? tx("Nhắc sau {x}", { x: qaRemindLabel(m) }) : tx("Không nhắc") }))} />
            </span>
          </Hint>
          <Hint side="bottom" text={tx("Đọc lại nhóm (tự đọc lại mỗi phút)")}>
            <Button size="icon-sm" variant="ghost" aria-label={tx("Đọc lại")} disabled={list.isFetching} onClick={() => void list.refetch()}>
              <RotateCw className={cn(list.isFetching && "animate-spin")} />
            </Button>
          </Hint>
          <Hint side="bottom" text={tx("Đăng câu hỏi mới vào nhóm này")}>
            <Button size="sm" onClick={() => { show("new"); requestAnimationFrame(focusBox); }}><Plus /><span className="@max-md/qa:sr-only">{tx("Câu hỏi mới")}</span></Button>
          </Hint>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-1 @4xl/qa:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)]">
        <div className={cn("min-h-0 overflow-y-auto px-2 pb-2 @4xl/qa:border-r", reading ? "hidden @4xl/qa:block" : "block")}>
          {listWait ? (
            <AiFetching kind="qa" />
          ) : list.isError ? (
            <LoadError onRetry={() => void list.refetch()}>
              {errorText(list.error, { not_connected: tx("Chưa kết nối Telegram") }, tx("Không đọc được nhóm."))}
            </LoadError>
          ) : filter === "unsent" && sentQ.isError ? (
            <LoadError onRetry={() => void sentQ.refetch()}>
              {errorText(sentQ.error, {}, tx("Không đọc được tin nào đã gửi AI."))}
            </LoadError>
          ) : !shown.length ? (
            <Empty icon={items.length ? <Search /> : <MessageCircleQuestion />} title={items.length ? tx("Không thấy Q&A khớp") : tx("Chưa có Q&A nào")}
              action={items.length ? <Button size="xs" variant="outline" onClick={() => { setFilter("all"); setFind(""); }}>{tx("Bỏ lọc")}</Button>
                : days < 30 && <Button size="xs" variant="outline" onClick={() => onDays(30)}>{tx("Xem 30 ngày")}</Button>}>
              {items.length ? tx("Thử từ khác hoặc bộ lọc khác.") : tx("Trong {x} qua chưa có câu hỏi kèm mã #QA… ở nhóm này.", { x: tx(QA_DAYS.find(([v]) => v === days)![1]) })}
            </Empty>
          ) : <>
            {late.length > 0 && (
              <RailSection name={tx("Chưa ai trả lời")} late count={late.length} icon={<BellRing aria-hidden />} open={isOpen("late")} onToggle={() => fold1("late")}
                label={tx("Chưa ai trả lời sau {x}", { x: qaRemindLabel(mins) })} actions={dayTrash(late, tx("chưa ai trả lời"))}>
                {late.map((i) => qaRow(i, true))}
              </RailSection>
            )}
            <DayGroups items={rest} at={atOf} open={!!s} fold={dayFold} row={(i) => qaRow(i, false)}
              actions={(d, its) => dayTrash(its, tx(d).toLowerCase())} />
          </>}
        </div>

        <div className={cn("min-h-0 flex-col", reading ? "flex" : "hidden @4xl/qa:flex")}>
          {cur ? (
            <Thread key={cur.code} i={cur} now={now} title={title} seenAt={seenAt} target={target} onTarget={pick} onClose={() => show(null)}
              late={late.includes(cur)} muted={muted.includes(cur.code)} remind={mins} onNudge={() => nudge(cur)} onMute={(off) => onMute(cur, off)}
              onResolve={(id) => onResolve(cur, id)}
              onMark={(state) => { if (state === "deleted") show(null); void markWithUndo(qc, cur, state); }} />
          ) : open === null && !target ? (shown.length
            ? <NoPick title={tx("Chưa chọn câu hỏi nào")}>{tx("Chọn một câu bên trái để đọc cả chuỗi, hoặc bấm “Câu hỏi mới” để hỏi.")}</NoPick>
            : <NoPick title={tx("Không có câu hỏi nào để xem")}>{tx("Danh sách bên trái đang trống. Đổi bộ lọc, khoảng thời gian, hoặc bấm “Câu hỏi mới” để hỏi.")}</NoPick>) : (
            <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
              <div className="grid max-w-sm justify-items-center gap-2 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-hl-wash text-hl-2"><MessageCircleQuestion className="size-5" aria-hidden /></span>
                <p className="text-sm font-bold text-ink">{tx("Câu hỏi mới cho {title}", { title: title ?? tx("nhóm") })}</p>
                <p className="text-sm leading-relaxed text-ink-3">
                  {tx("Gõ ở ô dưới: tin đăng vào nhóm kèm một dòng mã #QA…, mọi trả lời nối tiếp gom thành một chuỗi.")}
                  <span className="hidden @4xl/qa:inline">{tx(" Chọn một câu bên trái để đọc cả chuỗi.")}</span>
                </p>
                <Button size="sm" variant="ghost" className="@4xl/qa:hidden" onClick={() => show(null)}><ArrowLeft /> {tx("Danh sách câu hỏi")}</Button>
              </div>
            </div>
          )}
          {reading && <div ref={box} className="shrink-0 border-t px-3 py-3 @4xl/qa:px-5" onKeyDown={(e) => { if (e.key === "Escape" && target && !e.defaultPrevented) { e.preventDefault(); setTarget(null); } }}>
            <QaBox chatId={chatId} draft={draft} onSend={send} busy={post.isPending} to={to} title={title}
              top={(text) => to && (
                <div className="flex items-center gap-2 rounded-md border-l-[3px] border-hl bg-paper-2 py-1 pr-1 pl-2.5 text-xs">
                  <Reply className="size-3.5 shrink-0 text-hl-2" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink-2"><b className="font-bold text-ink">{who(to)}:</b> {gist(to)}</span>
                  {start && (hasTag(text) ? (
                    <Hint side="bottom" text={tx("Tin này không thuộc chuỗi nào đang hiện và bạn có tag người: câu trả lời kèm mã #QA…, tin này đứng đầu chuỗi mới. Nếu nó nằm trong một chuỗi cũ hơn thì trả lời vào đúng chuỗi đó, không thêm mã.")}>
                      <span className="shrink-0 rounded-full bg-hl-wash px-2 leading-5 font-medium text-hl-2">{tx("Mở Q&A mới")}</span>
                    </Hint>
                  ) : (
                    <Hint side="bottom" text={tx("Chưa tag ai (@tên): gửi như một tin trả lời thường, không mở Q&A. Tag người được hỏi để mở chuỗi Q&A.")}>
                      <span className="shrink-0 rounded-full bg-paper-3 px-2 leading-5 font-medium text-ink-2">{tx("Tin thường")}</span>
                    </Hint>
                  ))}
                  {target ? (
                    <Hint side="bottom" text={cur ? tx("Bỏ chọn (Esc): trả lời tin mới nhất của chuỗi") : tx("Bỏ trả lời (Esc): gửi thành câu hỏi mới")}>
                      <Button size="icon-xs" variant="ghost" aria-label={tx("Bỏ chọn tin")} onClick={() => setTarget(null)}><X /></Button>
                    </Hint>
                  ) : <span className="hidden shrink-0 pr-1.5 text-ink-3 @2xl/qa:inline">{tx("Bấm một tin để trả lời tin đó")}</span>}
                </div>
              )}
            />
          </div>}
        </div>
      </div>
    </div>
  );
}
