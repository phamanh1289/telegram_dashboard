"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bug, Check, Copy, MessageSquarePlus, Reply, RotateCw, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { IssueDialog } from "@/components/composer-dialogs";
import { AiThinking } from "@/components/ai/chat";
import { BeTopics } from "@/components/be-topics";
import { AiFetching, useAiWait } from "@/components/ai/fetching";
import { DateRangePicker, type DayRange, rangeLabel, rangeQuery } from "@/components/date-range";
import { DeepItemAction, DeepPick } from "@/components/deep-think";
import { TicketChip } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Hint } from "@/components/ui/hint";
import { api, ApiError, errorText, type DigestConsent, type DigestItem, type DigestResult, type HistoryPage, type Message, type SavedDigest, statusQuery } from "@/lib/api";
import { copyText, getMessage, openReplyById, smooth, toast } from "@/lib/inbox";
import { dayLabel, timeLabel } from "@/lib/time";
import { isString, put, readDigestTeams, readIntro, readList } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { lastSp, yt } from "@/lib/yt";
import { Segmented } from "@/components/ui/segmented";

const PRESETS = [["24h", 24], ["3 ngày", 72], ["7 ngày", 168]] as const;

const ERRORS: Record<string, string> = {
  digest_consent_required: "Cần cho phép AI đọc nhóm này trước.",
  digest_empty: "Không có tin nào để tóm tắt.",
  digest_too_large: "Quá nhiều tin cho một lần tóm tắt (tối đa 2.000 tin); hãy thu hẹp khoảng thời gian.",
  not_connected: "Telegram chưa kết nối.",
  ai_not_configured: "AI đang chọn chưa cài hoặc chưa đăng nhập, xem Cài đặt › AI.",
  ai_timeout: "AI phản hồi quá lâu; thử lại hoặc thu hẹp khoảng thời gian.",
  ai_provider_error: "AI gặp lỗi; thử lại.",
  ai_permission_changed: "Quyền đã đổi trong lúc xử lý; kết quả bị bỏ.",
  chat_not_found: "Không tìm thấy nhóm.",
};
/** The server's own explanation when it gives one, else the code's text. */
export const digestError = (e: unknown) =>
  e instanceof ApiError && e.detail && e.code !== "not_connected" ? e.detail : errorText(e, ERRORS);

// Reading order: what needs me first, the record after.
const SECTIONS = [
  ["confirmations", "Cần confirm"],
  ["decisions", "Đã chốt"],
  ["changes", "Thay đổi"],
  ["impacts", "Ảnh hưởng team"],
  ["actions", "Việc cần làm"],
] as const;
const STATUS: Record<string, [string, string]> = {
  decided: ["Đã chốt", "bg-ok-wash text-ok"],
  open: ["Đang bàn", "bg-warn-wash text-warn"],
  dropped: ["Bỏ ngỏ", "bg-paper-3 text-ink-3"],
};

// `until` is always set when a range is chosen, so the list and the digest cover the same messages.
type Span = { since: string; until: string };
const span = (since: string, until?: string | null): Span => ({ since, until: until ?? new Date().toISOString() });
const hoursAgo = (h: number) => span(new Date(Date.now() - h * 3_600_000).toISOString());
const CONSENT_DAYS = [7, 30, 90] as const;

// Handled marks, per browser, refs only (chat, kind, message ids; a hash when an item cites none): never the text.
// Shared by Briefing (where you tick them) and a group's Tóm tắt (whose "Với BE" view leaves them out).
const DONE = "briefDone";
const OPEN = ["confirmations", "actions"] as const;
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36);
export const todoKey = (chat: string, kind: string, it: DigestItem) => `${chat}:${kind}:${it.message_ids?.length ? it.message_ids.join(",") : hash(it.text)}`;

export function useDone() {
  const [done, setDone] = useState<Set<string>>(() => new Set(readList(DONE, [], isString)));
  const toggle = (key: string) => setDone((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    put(DONE, JSON.stringify([...next].slice(-500))); // ponytail: oldest marks drop off past 500
    return next;
  });
  return [done, toggle] as const;
}

/** chat_id -> digest-cited message ids I have replied to on Telegram: those items tick themselves off. */
export const answeredQuery = {
  queryKey: ["briefing-answered"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<Record<string, string[]>>("/briefing/answered", { signal }),
  staleTime: 60_000,
};

/** Ticked off (here) or replied to (on Telegram). */
export const isClosedItem = (chat: string, kind: string, it: DigestItem, done: Set<string>, answered?: Record<string, string[]>) =>
  done.has(todoKey(chat, kind, it)) || ((OPEN as readonly string[]).includes(kind) && !!it.message_ids?.some((id) => answered?.[chat]?.includes(id)));

/** A chat's open items I have closed, as their joined message ids: the next digest drops them instead of carrying them on. */
export function closedIds(chat: string, r: DigestResult | undefined, answered?: Record<string, string[]>) {
  const done = new Set(readList(DONE, [], isString));
  return OPEN.flatMap((k) => (r?.[k] ?? []).filter((it) => it.message_ids?.length && isClosedItem(chat, k, it, done, answered)))
    .map((it) => it.message_ids!.join(","));
}

/** Impacts grouped by team, in first-seen order. */
const THINKING = ["Đang đọc tin nhắn", "Đang tìm điều đã chốt, thay đổi", "Đang xếp việc cần PO/PM confirm"];

function byTeam(list: DigestItem[]): [string, DigestItem[]][] {
  const out = new Map<string, DigestItem[]>();
  for (const it of list) out.set(it.who || "Khác", [...(out.get(it.who || "Khác") ?? []), it]);
  return [...out];
}

function meta(key: string, it: DigestItem) {
  if (key === "decisions" && it.who) return `chốt bởi ${it.who}`;
  if (key === "confirmations" && it.who) return `hỏi ${it.who}`;
  if (key === "actions") return [it.who, it.due && `hạn ${it.due}`].filter(Boolean).join(", ");
  return "";
}

export function toMarkdown(r: DigestResult, title: string) {
  const refs = (ids: string[], tix: string[] = []) => (ids.length || tix.length ? ` (${[...tix, ...ids.map((i) => `#${i}`)].join(", ")})` : "");
  const out = [`# Tóm tắt: ${title}`];
  for (const [key, label] of SECTIONS) {
    const items = r[key] ?? [];
    if (!items.length) continue;
    out.push("", `## ${label}`);
    for (const it of items) {
      const m = key === "impacts" ? `**${it.who || "Khác"}**: ` : "";
      const extra = meta(key, it);
      const flags = `${it.be ? "[BE] " : ""}${it.carried && it.at ? `[còn mở từ ${dayLabel(it.at).toLowerCase()}] ` : ""}`;
      out.push(`- ${m}${flags}${it.text}${extra ? ` — ${extra}` : ""}${refs(it.message_ids ?? [], it.tickets)}`);
    }
  }
  if (r.topics?.length) {
    out.push("", "## Chủ đề");
    for (const t of r.topics) out.push(`- **${t.title}** [${STATUS[t.status ?? "open"][0]}]: ${t.summary}${refs(t.message_ids ?? [], t.tickets)}`);
  }
  if (r.raw) out.push("", r.raw);
  return out.join("\n");
}

/** Structured AI summary of a group conversation, read live from Telegram. Independent of tags. */
export function DigestPage({ chatId, title, onBack }: { chatId: string; title: string; onBack: () => void }) {
  const qc = useQueryClient();
  const enc = encodeURIComponent(chatId);
  const [preset, setPreset] = useState<number | "last" | null>(24);
  const [days, setDays] = useState<DayRange>({ from: "", to: "" });
  const [win, setWin] = useState<Span>(() => hoursAgo(24));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null); // message id: indices shift when the list reloads
  const [lit, setLit] = useState<string | null>(null);

  const consent = useQuery({
    queryKey: ["digest-consent", chatId],
    queryFn: ({ signal }) => api<DigestConsent>(`/chats/${enc}/digest-consent`, { signal }),
  });
  const [consentDays, setConsentDays] = useState<number>(30);
  const setConsent = useMutation({
    mutationFn: (enabled: boolean) => api<DigestConsent>(`/chats/${enc}/digest-consent`, { method: "PUT", json: { enabled, days: consentDays } }),
    onSuccess: (d) => {
      qc.setQueryData(["digest-consent", chatId], d);
      void qc.invalidateQueries({ queryKey: ["digest-saved", chatId] }); // revoking drops the saved digest
      void qc.invalidateQueries({ queryKey: ["briefing"] }); // the sidebar's Briefing tab lists consented groups
      if (!d.enabled && preset === "last") onPreset(24); // …and with it the "since last time" range
    },
  });
  // Latest digest of this chat and how far digests have read.
  const saved = useQuery({
    queryKey: ["digest-saved", chatId],
    queryFn: ({ signal }) => api<SavedDigest | null>(`/chats/${enc}/digest`, { signal }),
  });
  const last = saved.data ?? null;
  // Once a chat has a cursor, open on "since last time" (unless the user already picked a range).
  const touched = useRef(false);
  useEffect(() => {
    if (!last || touched.current) return;
    touched.current = true;
    setPreset("last");
    setWin(span(last.last_date));
  }, [last]);
  const history = useQuery({
    queryKey: ["digest-history", chatId, win.since, win.until],
    queryFn: ({ signal }) =>
      api<HistoryPage>(`/chats/${enc}/history?${new URLSearchParams(win)}`, { signal }),
    staleTime: 60_000,
  });
  const items = useMemo(() => history.data?.items ?? [], [history.data]);
  const wait = useAiWait(history.isPending);
  const run = useMutation({
    mutationFn: () =>
      api<DigestResult>("/digest", {
        method: "POST",
        json: {
          chat_id: chatId,
          since: win.since,
          until: win.until,
          message_ids: [...picked],
          after_id: preset === "last" && last ? Number(last.last_message_id) : null,
          closed: closedIds(chatId, last?.result, qc.getQueryData(answeredQuery.queryKey)),
          teams: readDigestTeams(),
          intro: readIntro(),
        },
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["digest-saved", chatId] }); void qc.invalidateQueries({ queryKey: ["briefing"] }); },
  });

  function choose(next: Span) {
    touched.current = true;
    setWin(next);
    setPicked(new Set());
    anchor.current = null;
    run.reset();
  }
  function onPreset(h: number | "last") {
    if (h === "last" && !last) return;
    setPreset(h);
    setDays({ from: "", to: "" });
    choose(h === "last" ? span(last!.last_date) : hoursAgo(h)); // re-clicking refreshes "now"
  }
  function onDays(r: DayRange) {
    setDays(r);
    const q = new URLSearchParams(rangeQuery(r));
    const since = q.get("since");
    if (!since) return onPreset(24); // "Tất cả" makes no sense for a digest: back to the default
    setPreset(null);
    choose(span(since, q.get("until")));
  }
  // Click toggles one; Shift+click selects the whole stretch from the last click (a conversation segment).
  function toggle(i: number, shift: boolean) {
    const id = items[i].message_id;
    const from = items.findIndex((m) => m.message_id === anchor.current); // read now, not in the updater
    setPicked((prev) => {
      const next = new Set(prev);
      if (shift && from >= 0) {
        const [a, b] = [from, i].sort((x, y) => x - y);
        for (const m of items.slice(a, b + 1)) next.add(m.message_id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }
  function jump(id: string) {
    setLit(id);
    document.querySelector(`[data-digest-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: smooth() });
  }
  async function copy() {
    if (!shown) return;
    await copyText(toMarkdown(shown, title), "Đã copy markdown");
  }

  const enabled = consent.data?.enabled ?? false;
  const tooMany = !!history.data?.truncated && !picked.size; // the server would refuse the whole range
  const label = preset === "last" ? "từ lần tóm tắt trước" : preset ? `${PRESETS.find(([, h]) => h === preset)?.[0]} qua` : rangeLabel(days);
  // A fresh run wins; otherwise the saved one (also after the range changes).
  const shown = run.data ?? (run.isIdle ? last?.result : undefined);
  const cut = last ? Number(last.last_message_id) : 0; // messages up to here were already summarized
  const isOld = (m: Message) => Number(m.message_id) <= cut;

  return (
    <section aria-label="Tóm tắt nhóm" className="flex min-h-0 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 md:px-5">
        <Hint side="bottom" text="Quay lại danh sách tin của nhóm">
          <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="Quay lại nhóm">
            <ArrowLeft />
          </Button>
        </Hint>
        <span className="text-sm font-semibold">Tóm tắt</span>
        <Segmented id="tg-digest" label="Khoảng thời gian" value={preset} onChange={onPreset} items={[
          ...(last ? [{ value: "last" as const, label: "Từ lần trước", title: `Tin mới từ lần tóm tắt trước (${timeLabel(last.last_date)})` }] : []),
          ...PRESETS.map(([l, h]) => ({ value: h, label: l })),
        ]} />
        <DateRangePicker value={days} onChange={onDays} emptyLabel="Tuỳ chọn ngày" />
        <Button size="sm" className="ml-auto" aria-busy={run.isPending}
          disabled={!enabled || !items.length || run.isPending || history.isFetching || tooMany}
          onClick={() => run.mutate()}>
          <Sparkles /> {run.isPending ? "Đang tóm tắt…" : picked.size ? `Tóm tắt ${picked.size} tin đã chọn` : tooMany ? "Quá nhiều tin" : `Tóm tắt ${items.length} tin`}
        </Button>
      </div>

      {consent.data && !enabled && (
        <div role="note" className="flex flex-wrap items-center gap-3 border-b bg-hl-wash/50 px-3 py-2.5 text-sm md:px-5">
          <ShieldCheck className="size-4 shrink-0 text-hl-2" aria-hidden />
          <span className="min-w-0 flex-1">Cho phép AI đọc tin của nhóm này để tóm tắt. Nội dung đã gửi cho AI provider không thu hồi được.</span>
          <Dropdown label="Thời hạn cho phép" value={String(consentDays)} onChange={(v) => setConsentDays(Number(v))} className="h-[30px] w-auto"
            options={CONSENT_DAYS.map((d) => ({ value: String(d), label: `${d} ngày` }))} />
          <Button size="xs" aria-busy={setConsent.isPending} disabled={setConsent.isPending} onClick={() => setConsent.mutate(true)}>Cho phép</Button>
        </div>
      )}
      {consent.isError && (
        <p role="alert" className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-error md:px-5">
          Không tải được quyền AI của nhóm này.
          <button type="button" className="underline underline-offset-2" onClick={() => void consent.refetch()}>Thử lại</button>
        </p>
      )}
      {setConsent.isError && (
        <p role="alert" className="border-b px-3 py-1.5 text-xs text-error md:px-5">Không đổi được quyền AI: {digestError(setConsent.error)}</p>
      )}
      {enabled && consent.data?.expires_at && (
        <p className="flex items-center gap-2 border-b px-3 py-1 text-xs text-ink-3 md:px-5">
          <ShieldCheck className="size-3.5" aria-hidden /> AI được đọc nhóm này đến {timeLabel(consent.data.expires_at, true)}
          <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setConsent.mutate(false)}>Thu hồi</button>
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-y-auto lg:grid-cols-2 lg:grid-rows-1 lg:overflow-hidden">
        {/* Result: first on phones, right column on desktop. */}
        <div className="border-b p-3 md:p-5 lg:order-2 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-l" aria-live="polite">
          {run.isPending ? (
            <AiThinking lines={THINKING} />
          ) : run.isError ? (
            <p role="alert" className="text-sm text-error">{digestError(run.error)}</p>
          ) : shown ? (
            <Result r={shown} title={title} chatId={chatId} when={run.data ? null : last?.created_at ?? null} lit={lit} onJump={jump} onCopy={() => void copy()} />
          ) : (
            <p className="text-sm leading-relaxed text-ink-3">
              Tóm tắt {label}: đã chốt gì, thay đổi gì, ảnh hưởng team nào, cần PO/PM confirm gì. Chọn tin bên dưới (Shift+click để chọn cả đoạn) nếu chỉ muốn tóm tắt một phần.
            </p>
          )}
        </div>

        <ol aria-label="Hội thoại" className="grid content-start divide-y divide-rule lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          {wait && <li><AiFetching kind="history" /></li>}
          {history.isError && (
            <li role="alert" className="flex items-center gap-2 px-3 py-3 text-sm text-error md:px-5">
              {digestError(history.error)}
              <Button size="xs" variant="outline" className="ml-auto" onClick={() => void history.refetch()}><RotateCw /> Thử lại</Button>
            </li>
          )}
          {!wait && history.data?.truncated && (
            <li className="px-3 py-2 text-xs text-warn md:px-5">Chỉ hiện {items.length} tin mới nhất; thu hẹp khoảng thời gian để tóm tắt đủ.</li>
          )}
          {!wait && history.data && !items.length && <li className="px-3 py-6 text-sm text-ink-3 md:px-5">Không có tin nào trong {label.toLowerCase()}.</li>}
          {!wait && items.map((m, i) => (
            <Fragment key={m.message_id}>
              <Row m={m} checked={picked.has(m.message_id)} lit={lit === m.message_id} old={isOld(m)}
                onToggle={(shift) => toggle(i, shift)} />
              {isOld(m) && items[i + 1] && !isOld(items[i + 1]) && (
                <li role="separator" className="flex items-center gap-2 px-3 py-1 text-xs font-medium text-hl-2 md:px-5">
                  <span className="h-px flex-1 bg-hl/40" />Đã tóm tắt đến đây, lúc {timeLabel(last!.created_at)}<span className="h-px flex-1 bg-hl/40" />
                </li>
              )}
            </Fragment>
          ))}
        </ol>
      </div>
      {picked.size > 0 && (
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-xs text-ink-2 md:px-5">
          Đã chọn {picked.size}/{items.length} tin
          <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setPicked(new Set())}>Bỏ chọn</button>
        </div>
      )}
    </section>
  );
}

function Row({ m, checked, lit, old, onToggle }: { m: Message; checked: boolean; lit: boolean; old: boolean; onToggle: (shift: boolean) => void }) {
  const text = m.text || (m.media_kind ? `[${m.media_kind === "photo" ? "ảnh" : "file"}]` : "");
  return (
    <li data-digest-id={m.message_id}
      className={cn("group/row flex cursor-pointer gap-3 px-3 py-2.5 transition-colors duration-(--dur-micro) hover:bg-paper-2 md:px-5", old && !checked && !lit && "opacity-60", checked && "bg-hl-wash/60", lit && "bg-hl-wash")}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,input") || getSelection()?.toString()) return;
        onToggle(e.shiftKey);
      }}>
      <input type="checkbox" checked={checked} aria-label={`Chọn tin #${m.message_id}`} className="mt-1 size-4 shrink-0 accent-hl"
        onChange={() => {}} onClick={(e) => onToggle(e.shiftKey)} />
      <div className="grid min-w-0 gap-0.5">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="truncate font-semibold text-ink">{m.outgoing ? "Bạn" : m.sender_name ?? "?"}</span>
          <span className="shrink-0 font-mono tabular-nums text-ink-3">{timeLabel(m.date)}</span>
          <span className="shrink-0 font-mono text-ink-3">#{m.message_id}</span>
          {old && <span className="sr-only">đã nằm trong lần tóm tắt trước</span>}
          <DeepPick m={m} className="-my-1 ml-auto opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" />
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{text}</p>
      </div>
    </li>
  );
}

/** A change to a ticket already in a sprint is scope creep: flag it (the ticket is fetched only for change items). */
function ScopeFlag({ id }: { id: string }) {
  const d = useQuery({ queryKey: ["yt", "detail", id], queryFn: () => yt.detail(id), staleTime: 60_000, retry: false });
  const sp = d.data && !d.data.resolved && lastSp(d.data);
  return sp ? (
    <Hint side="bottom" text={`${id} đang trong sprint ${sp}: thay đổi này làm đổi scope sprint`}>
      <span tabIndex={0} className="ml-1 inline-flex items-center gap-1 rounded-full bg-warn-wash px-1.5 text-xs leading-5 text-warn">
        <TriangleAlert className="size-3" aria-hidden /> đổi scope sprint {sp}
      </span>
    </Hint>
  ) : null;
}

/** A decision about a ticket goes on record there: one click adds it as a comment. */
function RecordOn({ id, text }: { id: string; text: string }) {
  const save = useMutation({ mutationFn: () => yt.comment(id, text), onSuccess: () => toast({ text: `Đã ghi quyết định vào ${id}` }) });
  return (
    <Hint side="bottom" text={save.isError ? `Không ghi được: ${save.error.message}` : `Thêm quyết định này làm bình luận trên ${id}`}>
      <button type="button" disabled={save.isPending || save.isSuccess} onClick={() => save.mutate()}
        className={cn("ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-xs transition-colors duration-(--dur-micro)", save.isError ? "text-error" : "text-ink-3 hover:bg-hl-wash hover:text-hl-2")}>
        {save.isSuccess ? <Check className="size-3" aria-hidden /> : <MessageSquarePlus className="size-3" aria-hidden />}
        {save.isSuccess ? "đã ghi" : save.isError ? `ghi lại vào ${id}` : `ghi vào ${id}`}
      </button>
    </Hint>
  );
}

/** Tickets an item names (known YouTrack projects only); `record`: a decision's comment text. */
export function Tickets({ ids, scope, record }: { ids: string[] | undefined; scope?: boolean; record?: string }) {
  const projects = useQuery({ queryKey: ["yt", "projects"], queryFn: yt.projects, staleTime: Infinity, retry: false });
  return (ids ?? []).filter((id) => projects.data?.some((p) => p.shortName === id.split("-")[0])).map((id) => (
    <Fragment key={id}>
      {" "}<TicketChip id={id} />
      {scope && <ScopeFlag id={id} />}
      {record && <RecordOn id={id} text={record} />}
    </Fragment>
  ));
}

/** "Cần confirm" / "Việc cần làm" (and Briefing's asks): answer the message it came from, or make it a ticket. */
/** `suggest`: no ticket yet and none similar on YouTrack, so "Tạo ticket" stands out; `onCreated`: after one is made. */
export function ItemActions({ chatId, ids, text, suggest, onCreated }: { chatId: string; ids: string[]; text: string; suggest?: boolean; onCreated?: () => void }) {
  const status = useQuery({ ...statusQuery, staleTime: Infinity }).data; // the shell keeps it fresh
  const [m, setM] = useState<Message | null>(null);
  const load = useMutation({
    mutationFn: () => getMessage(chatId, ids[0]), // the ticket form reads it
    onSuccess: setM,
    onError: (e) => toast({ text: errorText(e, {}, "Không mở được tin gốc, thử lại sau") }),
  });
  if (!ids.length) return null;
  const cls = "ml-1 h-5 px-1 text-ink-3 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3";
  return (
    <>
      <Button type="button" size="xs" variant="ghost" className={cls} onClick={() => void openReplyById(chatId, ids[0])}><Reply aria-hidden /> Trả lời</Button>
      {status?.youtrack_configured && (
        <Button type="button" size="xs" variant="ghost" disabled={load.isPending} onClick={() => load.mutate()}
          className={cn(cls, suggest && "bg-hl-wash font-medium text-hl-2")}><Bug aria-hidden /> {suggest ? "Chưa có ticket · Tạo" : "Tạo ticket"}</Button>
      )}
      {m && (
        <IssueDialog m={m} note={text} ai={status?.ai_configured ?? false} open onOpenChange={(o) => { if (!o) setM(null); }}
          onCreated={(line) => {
            setM(null);
            onCreated?.();
            toast({ text: line.split(":")[0], action: { label: "Báo nhóm", run: () => void openReplyById(chatId, m.message_id, line) } });
          }} />
      )}
    </>
  );
}

function Refs({ ids, lit, onJump }: { ids: string[]; lit: string | null; onJump: (id: string) => void }) {
  return ids.map((id) => (
    <Hint key={id} side="bottom" text="Cuộn tới tin gốc trong danh sách">
      <button type="button" onClick={() => onJump(id)} aria-label={`Xem tin gốc #${id}`}
        className={cn("ml-1 rounded-sm px-1 font-mono text-xs transition-colors duration-(--dur-micro)", lit === id ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2 hover:bg-hl-wash hover:text-hl-2")}>
        #{id}
      </button>
    </Hint>
  ));
}

/** "BE" on an item about the backend; "còn mở từ …" on an open item kept from an earlier digest. */
export function ItemFlags({ it, be = true }: { it: DigestItem; be?: boolean }) {
  return (
    <>
      {be && it.be && <span className="ml-1 rounded-sm bg-code-wash px-1 text-xs font-medium text-code">BE</span>}
      {it.carried && it.at && (
        <Hint side="bottom" text="Chưa ai trả lời / làm từ lần tóm tắt trước; tự mất khi tin mới giải quyết nó">
          <span tabIndex={0} className="ml-1 rounded-full bg-warn-wash px-1.5 text-xs leading-5 text-warn">còn mở từ {dayLabel(it.at).toLowerCase()}</span>
        </Hint>
      )}
    </>
  );
}

export function Result({ r, when, lit, onJump, onCopy, title, chatId }: { r: DigestResult; when: string | null; lit: string | null; onJump: (id: string) => void; onCopy: () => void; title?: string; chatId?: string }) {
  const [only, setOnly] = useState<"all" | "be">("all");
  const [done, toggle] = useDone();
  const answered = useQuery({ ...answeredQuery, enabled: !!chatId }).data;
  const closed = (key: string, it: DigestItem) => !!chatId && isClosedItem(chatId, key, it, done, answered);
  // "Với BE": what is still open with BE; items you ticked off in Briefing or replied to on Telegram drop out.
  const beOpen = (key: string, it: DigestItem) => !!it.be && !closed(key, it);
  const beCount = SECTIONS.reduce((n, [k]) => n + (r[k] ?? []).filter((it) => beOpen(k, it)).length, 0);
  const beDone = SECTIONS.reduce((n, [k]) => n + (r[k] ?? []).filter((it) => it.be && closed(k, it)).length, 0);
  const be = only === "be";
  const empty = !r.raw && !r.topics?.length && SECTIONS.every(([k]) => !r[k]?.length);
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <span>{when ? `Bản tóm tắt lúc ${timeLabel(when)}` : "Vừa tóm tắt"}</span>
        <span>{r.source_count} tin</span>
        <Button size="xs" variant="outline" className="ml-auto" onClick={onCopy}><Copy /> Copy markdown</Button>
      </div>
      {!empty && !r.raw && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented id="tg-digest-be" label="Lọc mục" value={only} onChange={setOnly}
            items={[{ value: "all", label: "Tất cả" }, { value: "be", label: `Với BE · ${beCount}`, title: "Hỏi / trả lời / chốt với BE (API, field, data) còn chưa xử lý" }]} />
          {be && beDone > 0 && <span className="text-xs text-ink-3">ẩn {beDone} mục đã xử lý</span>}
        </div>
      )}
      {be && !beCount && (
        <p className="text-sm text-ink-3">
          {beDone ? "Mọi mục với BE đã xử lý."
            : SECTIONS.some(([k]) => r[k]?.some((it) => it.topic)) ? "Không có trao đổi nào với BE trong bản tóm tắt này."
            : "Bản tóm tắt này làm trước khi có phân loại BE: chọn \"7 ngày\" ở trên rồi bấm Tóm tắt để AI đọc lại và gom theo chủ đề."}
        </p>
      )}
      {be && chatId && (
        <BeTopics chatId={chatId} title={title ?? "nhóm"} r={r} open={(k, it) => !closed(k, it)} lit={lit} onJump={onJump}
          onToggle={(k, it) => toggle(todoKey(chatId, k, it))} />
      )}
      {empty && <p className="text-sm text-ink-3">AI không tìm thấy nội dung đáng chú ý.</p>}
      {r.raw && (
        <div className="grid gap-1">
          <p className="text-xs text-warn">AI trả về không đúng định dạng; hiện nguyên văn:</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.raw}</p>
        </div>
      )}
      {!be && SECTIONS.map(([key, label]) => {
        const list = r[key] ?? [];
        if (!list.length) return null;
        // Impacts read best grouped by team.
        const groups = key === "impacts"
          ? byTeam(list)
          : [["", list] as [string, DigestItem[]]];
        return (
          <section key={key} className="grid gap-2">
            <h3 className={cn("text-sm font-semibold", key === "confirmations" ? "text-hl-2" : "text-ink")}>
              {label} <span className="font-mono font-normal">{list.length}</span>
            </h3>
            {groups.map(([team, its]) => (
              <div key={team} className="grid gap-1.5">
                {team && <span className="text-sm font-semibold">{team}</span>}
                <ul className="grid gap-1.5">
                  {its.map((it, i) => {
                    const extra = meta(key, it);
                    return (
                      <li key={i} className="text-sm leading-relaxed">
                        <span className={closed(key, it) ? "text-ink-3 line-through decoration-ink-3/60" : "text-ink"}>{it.text}</span>
                        {extra && <span className="text-ink-3"> — {extra}</span>}
                        <ItemFlags it={it} />
                        <Tickets ids={it.tickets} scope={key === "changes"}
                          record={key === "decisions" ? `Đã chốt trên Telegram${title ? ` (${title})` : ""}: ${it.text}${it.who ? ` — ${it.who}` : ""}` : undefined} />
                        <Refs ids={it.message_ids ?? []} lit={lit} onJump={onJump} />
                        {chatId && (key === "confirmations" || key === "actions") && <ItemActions chatId={chatId} ids={it.message_ids ?? []} text={it.text} />}
                        {chatId && (key === "decisions" || key === "changes") && <DeepItemAction chatId={chatId} ids={it.message_ids ?? []} />}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
      {!be && !!r.topics?.length && (
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold text-ink">Chủ đề <span className="font-mono font-normal">{r.topics.length}</span></h3>
          <ul className="grid gap-3">
            {r.topics.map((t, i) => {
              const [s, cls] = STATUS[t.status ?? "open"];
              return (
                <li key={i} className="grid gap-0.5 text-sm leading-relaxed">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{t.title}</span>
                    <span className={cn("rounded-full px-1.5 text-xs leading-5", cls)}>{s}</span>
                  </span>
                  <span className="text-ink-2">{t.summary}<Tickets ids={t.tickets} /><Refs ids={t.message_ids ?? []} lit={lit} onJump={onJump} /></span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
