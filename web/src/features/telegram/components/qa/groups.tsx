"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck, MessageCircleQuestion, Search } from "lucide-react";
import { useState } from "react";
import { RailSection } from "@/shared/components/ai/day-groups";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { NavSkeleton, navRowCls, railHide } from "@/features/telegram/components/chat-list";
import { Avatar } from "@/shared/components/avatar";
import { NavPill } from "@/app/_components/shell";
import { Button } from "@/shared/components/ui/button";
import { Empty } from "@/shared/components/ui/empty";
import { Input } from "@/shared/components/ui/input";
import { errorText, type GroupInfo, type QaItem } from "@/shared/lib/api";
import { type Key, t as tr, useT } from "@/shared/lib/i18n";
import { groupsQuery, openQa } from "@/features/telegram/lib/inbox";
import { useNow } from "@/shared/hooks/use-now";
import { toast } from "@/shared/lib/notifications";
import { fold } from "@/shared/lib/utils";
import { qaRemindLabel, useQaRemind } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { isLate, mineOpen, mute, MUTED, QA_DAYS, QA_MINE, type QaDays, useQaNews, useQaRecent, useStored } from "@/features/telegram/lib/qa";
import { DaysPicker, LoadError, Row } from "@/features/telegram/components/qa/bits";

const MINE_LINES: Key[] = ["AI đang kết nối Telegram", "Đang đọc câu bạn hỏi ở các nhóm", "Đang tìm câu chưa ai trả lời", "Sắp xong rồi"];

/** "Câu hỏi của tôi": your unanswered questions across the groups you asked lately, oldest first, grouped by group.
 *  A row opens its thread in its own group (openQa); the late ones lead, with nudge / mute like a group's list.
 *  No new reads: the same per-group queries the sidebar badges poll. */
export function MyQuestions({ days, onDays }: { days: QaDays; onDays: (d: QaDays) => void }) {
  const tx = useT();
  const { lists, loading, error } = useQaNews(days, true);
  const qc = useQueryClient();
  const now = useNow();
  const mins = useQaRemind();
  const muted = useStored<string[]>(MUTED, []);
  const recent = useQaRecent();
  const open = mineOpen(lists);
  const wait = useAiWait(loading && !open.length);
  const late = open.filter((i) => isLate(i, mins, now, muted));
  const groups: [string, QaItem[]][] = [];
  for (const i of open.filter((x) => !late.includes(x))) {
    const g = groups.find(([t]) => t === i.chat_title);
    if (g) g[1].push(i);
    else groups.push([i.chat_title, [i]]);
  }
  const row = (i: QaItem, isLateRow: boolean) => (
    <Row key={`${i.question.chat_id}:${i.code}`} i={i} now={now} on={false} news={0} late={isLateRow}
      onOpen={() => openQa(i.question.chat_id, i.code)} onNudge={() => openQa(i.question.chat_id, i.code)}
      onMute={() => { mute(i.code, true); toast({ text: tr("Đã bỏ qua nhắc {code}", { code: i.code }), undo: () => mute(i.code, false) }); }} />
  );
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-4">
        <p className="min-w-0 flex-1 truncate text-sm text-ink-2">
          {tx.n("{n} câu bạn hỏi chưa ai trả lời", { n: <span className="font-mono text-base font-bold text-ink tabular-nums">{open.length}</span> })}
          <span className="hidden text-ink-3 sm:inline">{tx(" · {n} nhóm hỏi gần đây", { n: recent.slice(0, 8).length })}</span>
        </p>
        <DaysPicker days={days} onDays={onDays} />
      </header>
      <div className="min-h-0 overflow-y-auto px-2 pb-2">
        {!wait && error && (
          <LoadError onRetry={() => void qc.refetchQueries({ queryKey: ["qa"], type: "active" })}>
            {errorText(error, { not_connected: tx("Chưa kết nối Telegram") }, tx("Không đọc được nhóm."))}
          </LoadError>
        )}
        {wait ? (
          <AiFetching kind="qa" lines={MINE_LINES.map((l) => tx(l))} />
        ) : error && !open.length ? null : !open.length ? (
          <Empty icon={<CheckCheck />} tone="bg-ok-wash text-ok" title={recent.length ? tx("Câu nào bạn hỏi cũng có người trả lời rồi") : tx("Bạn chưa hỏi nhóm nào")}
            action={recent.length > 0 && days < 30 && <Button size="xs" variant="outline" onClick={() => onDays(30)}>{tx("Xem 30 ngày")}</Button>}>
            {recent.length ? tx("Trong {x} qua.", { x: tx(QA_DAYS.find(([v]) => v === days)![1]) }) : tx("Chọn một nhóm bên trái để đăng câu hỏi kèm mã #QA…")}
          </Empty>
        ) : (
          [...(late.length ? [["late", late] as const] : []), ...groups].map(([g, its]) => (
            <RailSection key={g} name={g === "late" ? tx("Cần nhắc") : g} late={g === "late"} count={its.length} icon={g === "late" && <BellRing aria-hidden />}
              label={g === "late" ? tx("Chưa ai trả lời sau {x}", { x: qaRemindLabel(mins) }) : g}>
              {its.map((i) => row(i, g === "late"))}
            </RailSection>
          ))
        )}
      </div>
    </div>
  );
}

/** Group list for Q&A (sidebar tab, and the page before a group is picked): every group the account is in (any can be
 *  asked), the ones you asked lately first, with their new replies. */
export function QaGroups({ days, selected, onSelect, collapsed }: {
  days: QaDays; selected: string | null | undefined; onSelect: (chatId: string) => void; collapsed: boolean;
}) {
  const tx = useT();
  const list = useQuery(groupsQuery);
  const { by: news, late, lists } = useQaNews(days, true);
  const mine = mineOpen(lists).length;
  const recents = useQaRecent();
  const [q, setQ] = useState("");
  const s = fold(q.trim());
  const all = (list.data ?? []).filter((g) => !s || fold(g.title).includes(s)).sort((a, b) => a.title.localeCompare(b.title, "vi"));
  const recent = s ? [] : recents.flatMap((id) => all.filter((g) => g.chat_id === id));
  const rest = all.filter((g) => !recent.includes(g));
  const fade = collapsed ? railHide : undefined;
  const row = (g: GroupInfo) => (
    <li key={g.chat_id} className="rounded-md">
      <button type="button" aria-current={selected === g.chat_id} onClick={() => onSelect(g.chat_id)}
        className={cn(navRowCls(selected === g.chat_id), !!news[g.chat_id] && "font-medium text-ink")}>
        {selected === g.chat_id && <NavPill />}
        <Avatar name={g.title} className="relative" />
        <span className={cn("relative min-w-0 flex-1 truncate", fade)}>{g.title}</span>
        {!!late[g.chat_id] && (
          <span className={cn("relative inline-flex shrink-0 items-center gap-0.5 rounded-full bg-signal-wash px-1.5 font-mono text-xs leading-5 font-medium text-signal-2 tabular-nums", fade)}
            aria-label={tx("{n} câu chưa ai trả lời, cần nhắc", { n: late[g.chat_id] })}><BellRing className="size-3" aria-hidden />{late[g.chat_id]}</span>
        )}
        {!!news[g.chat_id] && (
          <span className={cn("relative shrink-0 rounded-full bg-hl px-1.5 text-xs leading-5 font-medium text-hl-ink tabular-nums", fade)}
            aria-label={tx("{n} trả lời mới", { n: news[g.chat_id] })}>{news[g.chat_id]}</span>
        )}
      </button>
    </li>
  );
  const label = (x: string) => <li data-zebra-off className={cn("px-3 pt-2 pb-0.5 text-xs font-medium text-ink-3", fade)}>{x}</li>;
  return (
    <nav aria-label={tx("Nhóm Q&A")} className="no-scrollbar h-full min-h-0 overflow-y-auto px-2 pb-3">
      <label className={cn("relative mb-1 block px-1", fade)}>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Tìm nhóm…")} aria-label={tx("Tìm nhóm")}
          className="h-8 pl-8 text-xs md:text-xs" />
      </label>
      <ul className="zebra grid grid-cols-[minmax(0,1fr)] gap-1">
        {!s && recents.length > 0 && (
          <li className="rounded-md">
            <button type="button" aria-current={selected === QA_MINE} onClick={() => onSelect(QA_MINE)}
              className={navRowCls(selected === QA_MINE)}>
              {selected === QA_MINE && <NavPill />}
              <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-paper-3 text-ink-2"><MessageCircleQuestion className="size-4" aria-hidden /></span>
              <span className={cn("relative min-w-0 flex-1 truncate", fade)}>{tx("Câu hỏi của tôi")}</span>
              {mine > 0 && <span className={cn("relative shrink-0 rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums", fade)}
                aria-label={tx("{n} câu chưa ai trả lời", { n: mine })}>{mine}</span>}
            </button>
          </li>
        )}
        {recent.length > 0 && <>{label(tx("Đã hỏi gần đây"))}{recent.map(row)}{label(tx("Mọi nhóm"))}</>}
        {rest.map(row)}
      </ul>
      {list.isPending && <NavSkeleton />}
      {list.isError && <p className={cn("px-3 py-2 text-sm text-error", fade)}>{tx("Không đọc được danh sách nhóm.")}</p>}
      {list.isSuccess && !all.length && <p className={cn("px-3 py-2 text-sm leading-relaxed text-ink-3", fade)}>{tx("Không thấy nhóm nào.")}</p>}
    </nav>
  );
}
