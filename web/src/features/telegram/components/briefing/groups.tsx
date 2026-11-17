"use client";

import { Popover } from "@base-ui/react/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CircleAlert, Loader2, Plus, RotateCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { NavSkeleton, navRowCls, railHide } from "@/features/telegram/components/chat-list";
import { Avatar } from "@/shared/components/avatar";
import { NavPill } from "@/app/_components/shell";
import { answeredQuery, digestError, openCount, useDone } from "@/features/telegram/components/digest-page";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { api, type BriefingItem, errorText } from "@/shared/lib/api";
import { groupsQuery } from "@/features/telegram/lib/inbox";
import { t as tr, useT } from "@/shared/lib/i18n";
import { useNow } from "@/shared/hooks/use-now";
import { toast } from "@/shared/lib/notifications";
import { timeLabel } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { briefingQuery, hasNews, runBrief, type RunState, sortGroups, useBriefRun } from "@/features/telegram/components/briefing/run";
import { FADE } from "@/features/telegram/components/briefing/todo";

const RENEW_DAYS = 30;
const SOON_MS = 3 * 86_400_000;

/** Groups whose AI consent ended or ends within 3 days: one click renews them all for RENEW_DAYS. */
export function RenewConsents({ items }: { items: BriefingItem[] }) {
  const tx = useT();
  const qc = useQueryClient();
  const now = useNow();
  const due = items.filter((i) => i.consent_until && Date.parse(i.consent_until) - now < SOON_MS);
  const renew = useMutation({
    mutationFn: () => Promise.all(due.map((i) =>
      api(`/chats/${encodeURIComponent(i.chat_id)}/digest-consent`, { method: "PUT", json: { enabled: true, days: RENEW_DAYS } }))),
    onSuccess: () => toast({ text: tr("Đã gia hạn {n} nhóm thêm {d} ngày", { n: due.length, d: RENEW_DAYS }) }),
    onError: (e) => toast({ text: errorText(e, {}, tr("Không gia hạn được, thử lại sau")) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["briefing"] }),
  });
  if (!due.length) return null;
  const ended = due.filter((i) => !i.consent).length;
  return (
    <motion.div {...FADE} className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-warn-wash/60 px-3 py-2 text-xs text-ink-2 md:px-5">
      <span className="min-w-0 flex-1">
        {ended ? tx("{n} nhóm đã hết quyền cho AI đọc", { n: ended }) : tx("{n} nhóm sắp hết quyền cho AI đọc", { n: due.length })}: {due.map((i) => i.title).join(", ")}
      </span>
      <Button size="xs" variant="outline" disabled={renew.isPending} onClick={() => renew.mutate()}>
        {renew.isPending && <Loader2 className="animate-spin" />} {tx("Gia hạn {n} ngày", { n: RENEW_DAYS })}
      </Button>
    </motion.div>
  );
}

// ---- group picker: one button, every group's status in its list ----------------------------------------------------

export function StatusDot({ i, r }: { i: BriefingItem; r?: RunState }) {
  return r?.status === "running" ? <Loader2 className="size-3 shrink-0 animate-spin text-hl" aria-hidden />
    : r?.status === "error" ? <CircleAlert className="size-3 shrink-0 text-error" aria-hidden />
    : <span aria-hidden className={cn("size-2 shrink-0 rounded-full", hasNews(i) ? "bg-signal ring-[3px] ring-signal-wash" : i.saved ? "bg-ok/70" : "bg-rule-2")} />;
}

/** Groups not here yet: those waiting for "Cho phép", and any other Telegram group; picking one opens its Digest. */
export function AddGroup({ blocked, known, onPick, className, children }: {
  blocked: BriefingItem[]; known: Set<string>; onPick: (chatId: string, title: string) => void; className: string; children: ReactNode;
}) {
  const tx = useT();
  const [open, onOpenChange] = useState(false);
  const [q, setQ] = useState("");
  const groups = useQuery({ ...groupsQuery, enabled: open });
  const needle = q.trim().toLowerCase();
  const match = (t: string) => t.toLowerCase().includes(needle);
  const waiting = blocked.filter((b) => match(b.title));
  const others = (groups.data ?? []).filter((g) => !known.has(g.chat_id) && match(g.title));
  const item = (id: string, title: string, allow?: boolean) => (
    <li key={id} className="rounded-md">
      <button type="button" onClick={() => { onOpenChange(false); onPick(id, title); }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink">
        {allow && <ShieldCheck className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {allow && <span className="text-xs font-medium text-hl-2">{tx("Cho phép")}</span>}
      </button>
    </li>
  );
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Hint side="right" text={tx("Thêm nhóm vào Briefing: chọn nhóm rồi cho phép AI đọc")}>
        <Popover.Trigger aria-label={tx("Thêm nhóm")} className={className}>{children}</Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" side="right" className="z-40 outline-none">
          <Popover.Popup aria-label={tx("Thêm nhóm")}
            className="grid w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) gap-2 rounded-lg bg-cotton p-2.5 text-sm shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Tìm nhóm Telegram…")} aria-label={tx("Tìm nhóm")} />
            <div className="grid max-h-72 gap-2 overflow-y-auto">
              {waiting.length > 0 && (
                <div className="grid gap-0.5">
                  <p className="px-2 text-xs font-medium text-ink-3">{tx("Chưa cho phép AI")}</p>
                  <ul className="zebra grid gap-0.5">{waiting.map((b) => item(b.chat_id, b.title, true))}</ul>
                </div>
              )}
              <div className="grid gap-0.5">
                <p className="px-2 text-xs font-medium text-ink-3">{tx("Nhóm khác")}</p>
                {groups.isPending && <Skeleton className="mx-2 h-12" />}
                {groups.isError && <p role="alert" className="px-2 text-error">{digestError(groups.error)}</p>}
                {groups.data && (others.length ? <ul className="zebra grid gap-0.5">{others.map((g) => item(g.chat_id, g.title))}</ul>
                  : <p className="px-2 text-ink-3">{tx("Không có nhóm nào khác.")}</p>)}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Sidebar under "Briefing": the groups (what still waits in each, how fresh), and everything done to one group:
 *  summarize it, open its Tóm tắt, take it out; "Thêm nhóm" at the end. A pick shows Briefing for that group. */
export function BriefingGroups({ selected, onSelect, onOpenDigest, collapsed }: {
  selected: string | null | undefined; onSelect: (chatId: string | null) => void; onOpenDigest: (chatId: string, title: string) => void; collapsed: boolean;
}) {
  const tx = useT();
  const qc = useQueryClient();
  const list = useQuery(briefingQuery);
  const { runs, batch } = useBriefRun();
  const [done] = useDone();
  const answered = useQuery({ ...answeredQuery, enabled: !!list.data?.some((i) => i.consent && i.saved) }).data;
  const [asking, setAsking] = useState<BriefingItem | null>(null); // the group whose removal waits for its dialog
  const items = list.data ?? [];
  const left = (i: BriefingItem) => openCount(i.chat_id, i.saved?.result, done, answered);
  const groups = sortGroups(items, left);
  const running = batch !== null;
  // Out of Briefing = AI may no longer read it: revoking the consent also drops its saved digest (as "Thu hồi" does).
  const remove = useMutation({
    mutationFn: (id: string) => api(`/chats/${encodeURIComponent(id)}/digest-consent`, { method: "PUT", json: { enabled: false, days: 30 } }),
    onSuccess: (_, id) => {
      setAsking(null);
      if (selected === id) onSelect(null);
      for (const key of [["briefing"], ["digest-saved", id], ["digest-consent", id]]) void qc.invalidateQueries({ queryKey: key });
      toast({ text: tr("Đã bỏ nhóm khỏi Briefing") });
    },
  });
  const row = (on: boolean) => cn(navRowCls(on), "min-w-0");
  const fade = collapsed ? railHide : undefined;
  const count = (n: number, cls?: string) => n > 0 && <span className={cn("relative shrink-0 rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums", cls, fade)}>{n}</span>;
  const act = "grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-paper-3 hover:text-ink disabled:opacity-40";
  const status = (i: BriefingItem) => {
    const r = runs[i.chat_id];
    return r?.status === "error" ? tx("Lỗi: {e}", { e: r.error ?? "" }) : r?.status === "running" ? tx("Đang tóm tắt…")
      : !i.saved ? tx("Chưa tóm tắt lần nào") : `${tx("Tóm tắt lúc {time}", { time: timeLabel(i.saved.created_at) })}${hasNews(i) ? tx(" · có tin mới") : ""}`;
  };
  return (
    <nav aria-label={tx("Nhóm Briefing")} className="no-scrollbar h-full min-h-0 overflow-y-auto px-2 pb-3">
      <ul className="zebra grid grid-cols-[minmax(0,1fr)] gap-1">
        {groups.map((i) => (
          <li key={i.chat_id} className="group/g relative rounded-md">
            <Hint side="right" text={status(i)}>
              <button type="button" aria-current={selected === i.chat_id} onClick={() => onSelect(i.chat_id)} className={row(selected === i.chat_id)}>
                {selected === i.chat_id && <NavPill />}
                <span className="relative shrink-0">
                  <Avatar name={i.title} />
                  <span className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-paper-2 p-0.5"><StatusDot i={i} r={runs[i.chat_id]} /></span>
                </span>
                <span className={cn("relative min-w-0 flex-1 truncate", hasNews(i) && "font-medium text-ink", fade)}>{i.title}</span>
                {count(left(i), !collapsed ? "group-hover/g:invisible group-focus-within/g:invisible" : undefined)}
              </button>
            </Hint>
            {!collapsed && (
              <span className="absolute inset-y-0 right-1 hidden items-center rounded-md bg-paper-3 group-focus-within/g:flex group-hover/g:flex">
                {hasNews(i) && (
                  <Hint side="bottom" text={tx("Tóm tắt tin mới của nhóm này")}>
                    <button type="button" aria-label={tx("Tóm tắt {title}", { title: i.title })} disabled={running} onClick={() => void runBrief(qc, [i])} className={cn(act, "text-hl-2")}>
                      <Sparkles className="size-3.5" aria-hidden />
                    </button>
                  </Hint>
                )}
                <Hint side="bottom" text={tx("Mở trang Tóm tắt của nhóm (chọn khoảng thời gian, chọn tin)")}>
                  <button type="button" aria-label={tx("Mở {title}", { title: i.title })} onClick={() => onOpenDigest(i.chat_id, i.title)} className={act}>
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </button>
                </Hint>
                <Hint side="bottom" text={tx("Bỏ khỏi Briefing: AI thôi đọc nhóm này, bản tóm tắt đã lưu bị xóa")}>
                  <button type="button" aria-label={tx("Bỏ {title} khỏi Briefing", { title: i.title })} disabled={running} onClick={() => { remove.reset(); setAsking(i); }} className={cn(act, "hover:bg-error/10 hover:text-error")}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </Hint>
              </span>
            )}
          </li>
        ))}
        {list.isSuccess && (
          <li>
            <AddGroup blocked={items.filter((i) => !i.consent)} known={new Set(items.map((i) => i.chat_id))} onPick={onOpenDigest}
              className={cn(row(false), "text-ink-3 data-popup-open:bg-paper-3 data-popup-open:text-ink")}>
              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-rule-2"><Plus className="size-3" aria-hidden /></span>
              <span className={cn("min-w-0 flex-1 truncate", fade)}>{tx("Thêm nhóm")}</span>
              {count(items.filter((i) => !i.consent).length)}
            </AddGroup>
          </li>
        )}
      </ul>
      {list.isPending && <NavSkeleton />}
      {list.isError && (
        <div role="alert" className="grid justify-items-start gap-2 px-3 py-2 text-sm">
          <p className="text-error">{tx("Không tải được danh sách Briefing.")}</p>
          <Button size="sm" variant="outline" onClick={() => void list.refetch()}><RotateCw /> {tx("Thử lại")}</Button>
        </div>
      )}
      {list.isSuccess && !groups.length && (
        <p className={cn("px-3 py-2 text-sm leading-relaxed text-ink-3", fade)}>{tx("Chưa có nhóm nào. Bấm “Thêm nhóm” để chọn nhóm cho AI tóm tắt.")}</p>
      )}
      <ConfirmDialog open={!!asking} onOpenChange={(o) => { if (!o) setAsking(null); }} icon={Trash2}
        title={tx("Bỏ nhóm khỏi Briefing?")} confirmLabel={tx("Bỏ nhóm")}
        description={tx("AI thôi đọc nhóm này và bản tóm tắt đã lưu bị xóa. Thêm lại lúc nào cũng được bằng “Thêm nhóm”.")}
        items={asking ? [{ id: asking.chat_id, label: asking.title,
          tag: asking.saved ? tx("{n} việc chờ", { n: left(asking) }) : tx("chưa tóm tắt") }] : undefined}
        busy={remove.isPending}
        error={running ? tx("Đang tóm tắt, chờ xong rồi bỏ nhóm.") : remove.isError && errorText(remove.error, {}, tx("Không bỏ được nhóm, thử lại."))}
        onConfirm={() => { if (asking && !running) remove.mutate(asking.chat_id); }} />
    </nav>
  );
}
