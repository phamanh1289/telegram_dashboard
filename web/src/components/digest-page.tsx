"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bug, Check, Copy, MessageSquarePlus, Reply, RotateCw, ShieldCheck, ShieldOff, Sparkles, TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { IssueDialog } from "@/components/composer-dialogs";
import { BeTopics } from "@/components/be-topics";
import { AiFetching, digestLines, useAiWait } from "@/components/ai/fetching";
import { DateRangePicker, type DayRange, rangeLabel, rangeQuery } from "@/components/date-range";
import { DeepItemAction, DeepPick } from "@/components/deep-think";
import { TicketChip } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Hint } from "@/components/ui/hint";
import { api, ApiError, type BeReply, errorText, type DigestConsent, type DigestItem, type DigestResult, type HistoryPage, type Message, type SavedDigest, statusQuery } from "@/lib/api";
import { type Key, t as tr, useT } from "@/lib/i18n";
import { copyText, getMessage, openReplyById, smooth, toast } from "@/lib/inbox";
import { dayLabel, timeLabel } from "@/lib/time";
import { isString, put, readDigestTeams, readIntro, readList, useRole, usesCode } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { lastSp, yt } from "@/lib/yt";
import { Segmented } from "@/components/ui/segmented";

const PRESETS = [["24h", 24], ["3 ngày", 72], ["7 ngày", 168]] as const;

const ERRORS: Record<string, Key> = {
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
  e instanceof ApiError && e.detail && e.code !== "not_connected" ? e.detail : errorText(e, Object.fromEntries(Object.entries(ERRORS).map(([k, v]) => [k, tr(v)])));

// Reading order: what needs me first, the record after.
const SECTIONS = [
  ["confirmations", "Cần confirm"],
  ["decisions", "Đã chốt"],
  ["changes", "Thay đổi"],
  ["impacts", "Ảnh hưởng team"],
  ["actions", "Việc cần làm"],
] as const;
const STATUS: Record<string, [Key, string]> = {
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

// One store for the page, the sidebar's counts and a group's Tóm tắt: a tick shows everywhere at once.
let doneSet: Set<string> | null = null;
const doneSubs = new Set<() => void>();
const NONE = new Set<string>();
const readDone = () => (doneSet ??= new Set(readList(DONE, [], isString)));
const subDone = (f: () => void) => { doneSubs.add(f); return () => { doneSubs.delete(f); }; };

/** Ticks `keys` on or off. */
export function setDone(keys: string[], on: boolean) {
  const next = new Set(readDone());
  for (const k of keys) if (on) next.add(k); else next.delete(k);
  put(DONE, JSON.stringify([...next].slice(-500))); // ponytail: oldest marks drop off past 500
  doneSet = next;
  doneSubs.forEach((f) => f());
}

export function useDone() {
  const done = useSyncExternalStore(subDone, readDone, () => NONE);
  const toggle = (key: string) => setDone([key], !readDone().has(key));
  return [done, toggle] as const;
}

// A code check that found a topic adapted (✅) ticks its items off once per check and topic: an untick sticks.
const AUTO = "briefAutoDone";
/** Ticks `keys` off for `mark` (check id + topic) unless that mark already ran; true when it did now. */
export function autoDone(mark: string, keys: string[]) {
  const seen = readList(AUTO, [], isString);
  if (seen.includes(mark)) return false;
  put(AUTO, JSON.stringify([...seen, mark].slice(-300)));
  setDone(keys, true);
  return true;
}

/** chat_id -> digest-cited message ids I have replied to on Telegram: those items tick themselves off. */
export const answeredQuery = {
  queryKey: ["briefing-answered"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<Record<string, string[]>>("/briefing/answered", { signal }),
  staleTime: 60_000,
};

/** chat_id -> replies from others to questions still open with BE, newer than the digest (Với BE: "vừa trả lời"). */
export const beRepliesQuery = {
  queryKey: ["briefing-be-replies"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<Record<string, BeReply[]>>("/briefing/be-replies", { signal }),
  staleTime: 60_000,
};
/** The replies to an item's question (any of its cited messages), and the guesses (`direct` false) when nobody replied. */
export const repliesTo = (it: DigestItem, hits?: BeReply[]) => hits?.filter((h) => it.message_ids?.includes(h.reply_to)) ?? [];
/** BE replied to the question itself: it no longer waits (a guess does not count). */
export const isAnswered = (it: DigestItem, hits?: BeReply[]) => repliesTo(it, hits).some((h) => h.direct);

/** Ticked off (here) or replied to (on Telegram). */
export const isClosedItem = (chat: string, kind: string, it: DigestItem, done: Set<string>, answered?: Record<string, string[]>) =>
  done.has(todoKey(chat, kind, it)) || ((OPEN as readonly string[]).includes(kind) && !!it.message_ids?.some((id) => answered?.[chat]?.includes(id)));

/** What still waits in a group's latest digest: open questions / to-dos not ticked off or replied to. */
export const openCount = (chat: string, r: DigestResult | undefined, done: Set<string>, answered?: Record<string, string[]>) =>
  OPEN.reduce((n, k) => n + (r?.[k] ?? []).filter((it) => !isClosedItem(chat, k, it, done, answered)).length, 0);

/** A chat's open items I have closed, as their joined message ids: the next digest drops them instead of carrying them on. */
export function closedIds(chat: string, r: DigestResult | undefined, answered?: Record<string, string[]>) {
  const done = readDone();
  return OPEN.flatMap((k) => (r?.[k] ?? []).filter((it) => it.message_ids?.length && isClosedItem(chat, k, it, done, answered)))
    .map((it) => it.message_ids!.join(","));
}

/** Impacts grouped by team, in first-seen order. */
function byTeam(list: DigestItem[]): [string, DigestItem[]][] {
  const out = new Map<string, DigestItem[]>();
  for (const it of list) out.set(it.who || tr("Khác"), [...(out.get(it.who || tr("Khác")) ?? []), it]);
  return [...out];
}

function meta(key: string, it: DigestItem) {
  if (key === "decisions" && it.who) return tr("chốt bởi {who}", { who: it.who });
  if (key === "confirmations" && it.who) return tr("hỏi {who}", { who: it.who });
  if (key === "actions") return [it.who, it.due && tr("hạn {due}", { due: it.due })].filter(Boolean).join(", ");
  return "";
}

export function toMarkdown(r: DigestResult, title: string) {
  const refs = (ids: string[], tix: string[] = []) => (ids.length || tix.length ? ` (${[...tix, ...ids.map((i) => `#${i}`)].join(", ")})` : "");
  const out = [`# ${tr("Tóm tắt: {title}", { title })}`];
  for (const [key, label] of SECTIONS) {
    const items = r[key] ?? [];
    if (!items.length) continue;
    out.push("", `## ${tr(label)}`);
    for (const it of items) {
      const m = key === "impacts" ? `**${it.who || tr("Khác")}**: ` : "";
      const extra = meta(key, it);
      const flags = `${it.be ? "[BE] " : ""}${it.carried && it.at ? `[${tr("còn mở từ {day}", { day: dayLabel(it.at).toLowerCase() })}] ` : ""}`;
      out.push(`- ${m}${flags}${it.text}${extra ? ` — ${extra}` : ""}${refs(it.message_ids ?? [], it.tickets)}`);
    }
  }
  if (r.topics?.length) {
    out.push("", `## ${tr("Chủ đề")}`);
    for (const tp of r.topics) out.push(`- **${tp.title}** [${tr(STATUS[tp.status ?? "open"][0])}]: ${tp.summary}${refs(tp.message_ids ?? [], tp.tickets)}`);
  }
  if (r.raw) out.push("", r.raw);
  return out.join("\n");
}

/** Structured AI summary of a group conversation, read live from Telegram. Independent of tags. */
export function DigestPage({ chatId, title, onBack }: { chatId: string; title: string; onBack: () => void }) {
  const t = useT();
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
  const [revoking, setRevoking] = useState(false); // "Thu hồi" asks first: it deletes the saved summary, as Briefing's "Bỏ nhóm"
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
  // Only a run that carries on from the last one (or the first ever) feeds Briefing; picked messages and other
  // ranges are a one-off view that leaves Briefing's running summary and cursor alone.
  const keep = !picked.size && (preset === "last" || !last);
  const run = useMutation({
    mutationFn: (save: boolean) =>
      api<DigestResult>("/digest", {
        method: "POST",
        json: {
          chat_id: chatId,
          since: win.since,
          until: win.until,
          message_ids: [...picked],
          after_id: preset === "last" && last ? Number(last.last_message_id) : null,
          save,
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
    await copyText(toMarkdown(shown, title), tr("Đã copy markdown"));
  }

  const enabled = consent.data?.enabled ?? false;
  const tooMany = !!history.data?.truncated && !picked.size; // the server would refuse the whole range
  const label = preset === "last" ? t("từ lần tóm tắt trước") : preset ? t("{x} qua", { x: t(PRESETS.find(([, h]) => h === preset)?.[0] ?? "24h") }) : rangeLabel(days);
  // A fresh run wins; otherwise the saved one (also after the range changes).
  const shown = run.data ?? (run.isIdle ? last?.result : undefined);
  const cut = last ? Number(last.last_message_id) : 0; // messages up to here were already summarized
  const isOld = (m: Message) => Number(m.message_id) <= cut;

  return (
    <section aria-label={t("Tóm tắt nhóm")} className="flex min-h-0 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 md:px-5">
        <Hint side="bottom" text={t("Quay lại danh sách tin của nhóm")}>
          <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label={t("Quay lại nhóm")}>
            <ArrowLeft />
          </Button>
        </Hint>
        <span className="text-sm font-bold">{t("Tóm tắt")}</span>
        <Segmented id="tg-digest" label={t("Khoảng thời gian")} value={preset} onChange={onPreset} items={[
          ...(last ? [{ value: "last" as const, label: t("Từ lần trước"), title: t("Tin mới từ lần tóm tắt trước ({time})", { time: timeLabel(last.last_date) }) }] : []),
          ...PRESETS.map(([l, h]) => ({ value: h, label: t(l) })),
        ]} />
        <DateRangePicker value={days} onChange={onDays} emptyLabel={t("Tuỳ chọn ngày")} />
        <Button size="sm" className="ml-auto" aria-busy={run.isPending}
          disabled={!enabled || !items.length || run.isPending || history.isFetching || tooMany}
          onClick={() => run.mutate(keep)}>
          <Sparkles /> {run.isPending ? t("Đang tóm tắt…") : picked.size ? t("Tóm tắt {n} tin đã chọn", { n: picked.size }) : tooMany ? t("Quá nhiều tin") : t("Tóm tắt {n} tin", { n: items.length })}
        </Button>
      </div>

      {consent.data && !enabled && (
        <div role="note" className="flex flex-wrap items-center gap-3 border-b bg-hl-wash/50 px-3 py-2.5 text-sm md:px-5">
          <ShieldCheck className="size-4 shrink-0 text-hl-2" aria-hidden />
          <span className="min-w-0 flex-1">{t("Cho phép AI đọc tin của nhóm này để tóm tắt. Nội dung đã gửi cho AI provider không thu hồi được.")}</span>
          <Dropdown label={t("Thời hạn cho phép")} value={String(consentDays)} onChange={(v) => setConsentDays(Number(v))} className="h-[30px] w-auto"
            options={CONSENT_DAYS.map((d) => ({ value: String(d), label: t("{n} ngày", { n: d }) }))} />
          <Button size="xs" aria-busy={setConsent.isPending} disabled={setConsent.isPending} onClick={() => setConsent.mutate(true)}>{t("Cho phép")}</Button>
        </div>
      )}
      {consent.isError && (
        <p role="alert" className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-error md:px-5">
          {t("Không tải được quyền AI của nhóm này.")}
          <button type="button" className="underline underline-offset-2" onClick={() => void consent.refetch()}>{t("Thử lại")}</button>
        </p>
      )}
      {setConsent.isError && (
        <p role="alert" className="border-b px-3 py-1.5 text-xs text-error md:px-5">{t("Không đổi được quyền AI: {e}", { e: digestError(setConsent.error) })}</p>
      )}
      {enabled && consent.data?.expires_at && (
        <p className="flex items-center gap-2 border-b px-3 py-1 text-xs text-ink-3 md:px-5">
          <ShieldCheck className="size-3.5" aria-hidden /> {t("AI được đọc nhóm này đến {time}", { time: timeLabel(consent.data.expires_at, true) })}
          <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => { setConsent.reset(); setRevoking(true); }}>{t("Thu hồi")}</button>
        </p>
      )}

      <ConfirmDialog open={revoking} onOpenChange={setRevoking} icon={ShieldOff}
        title={t("Thu hồi quyền AI đọc nhóm này?")} confirmLabel={t("Thu hồi")}
        description={t("AI thôi đọc nhóm này và bản tóm tắt đã lưu bị xóa. Cho phép lại lúc nào cũng được.")}
        busy={setConsent.isPending} error={setConsent.isError && t("Không đổi được quyền AI: {e}", { e: digestError(setConsent.error) })}
        onConfirm={() => setConsent.mutate(false, { onSuccess: () => setRevoking(false) })} />

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-y-auto lg:grid-cols-2 lg:grid-rows-1 lg:overflow-hidden">
        {/* Result: first on phones, right column on desktop. */}
        <div className="border-b p-3 md:p-5 lg:order-2 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-l" aria-live="polite">
          {run.isPending ? (
            <AiFetching kind="digest" lines={digestLines(title)} className="min-h-0 py-2" />
          ) : run.isError ? (
            <p role="alert" className="text-sm text-error">{digestError(run.error)}</p>
          ) : shown ? (<>
            {run.variables === false && run.data && <p className="mb-2 text-xs text-ink-3">{t("Bản tóm tắt riêng cho khoảng / tin đã chọn, không đưa vào Briefing.")}</p>}
            <Result r={shown} title={title} chatId={chatId} when={run.data ? null : last?.created_at ?? null} lit={lit} onJump={jump} onCopy={() => void copy()} />
          </>
          ) : (
            <p className="text-sm leading-relaxed text-ink-3">
              {t("Tóm tắt {label}: đã chốt gì, thay đổi gì, ảnh hưởng team nào, cần PO/PM confirm gì. Chọn tin bên dưới (Shift+click để chọn cả đoạn) nếu chỉ muốn tóm tắt một phần.", { label })}
            </p>
          )}
        </div>

        <ol aria-label={t("Hội thoại")} className="zebra grid content-start divide-y divide-rule lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          {wait && <li><AiFetching kind="history" /></li>}
          {history.isError && (
            <li role="alert" className="flex items-center gap-2 px-3 py-3 text-sm text-error md:px-5">
              {digestError(history.error)}
              <Button size="xs" variant="outline" className="ml-auto" onClick={() => void history.refetch()}><RotateCw /> {t("Thử lại")}</Button>
            </li>
          )}
          {!wait && history.data?.truncated && (
            <li className="px-3 py-2 text-xs text-warn md:px-5">{t("Chỉ hiện {n} tin mới nhất; thu hẹp khoảng thời gian để tóm tắt đủ.", { n: items.length })}</li>
          )}
          {!wait && history.data && !items.length && <li className="px-3 py-6 text-sm text-ink-3 md:px-5">{t("Không có tin nào trong {label}.", { label: label.toLowerCase() })}</li>}
          {!wait && items.map((m, i) => (
            <Fragment key={m.message_id}>
              <Row m={m} checked={picked.has(m.message_id)} lit={lit === m.message_id} old={isOld(m)}
                onToggle={(shift) => toggle(i, shift)} />
              {isOld(m) && items[i + 1] && !isOld(items[i + 1]) && (
                <li role="separator" className="flex items-center gap-2 px-3 py-1 text-xs font-medium text-hl-2 md:px-5">
                  <span className="h-px flex-1 bg-hl/40" />{t("Đã tóm tắt đến đây, lúc {time}", { time: timeLabel(last!.created_at) })}<span className="h-px flex-1 bg-hl/40" />
                </li>
              )}
            </Fragment>
          ))}
        </ol>
      </div>
      {picked.size > 0 && (
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-xs text-ink-2 md:px-5">
          {t("Đã chọn {n}/{m} tin", { n: picked.size, m: items.length })}
          <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setPicked(new Set())}>{t("Bỏ chọn")}</button>
        </div>
      )}
    </section>
  );
}

function Row({ m, checked, lit, old, onToggle }: { m: Message; checked: boolean; lit: boolean; old: boolean; onToggle: (shift: boolean) => void }) {
  const t = useT();
  const text = m.text || (m.media_kind ? `[${m.media_kind === "photo" ? t("ảnh") : "file"}]` : "");
  return (
    <li data-digest-id={m.message_id}
      className={cn("group/row flex cursor-pointer gap-3 px-3 py-2.5 transition-colors duration-(--dur-micro) hover:bg-paper-2 md:px-5", old && !checked && !lit && "opacity-60", checked && "bg-hl-wash/60", lit && "bg-hl-wash")}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,input") || getSelection()?.toString()) return;
        onToggle(e.shiftKey);
      }}>
      <input type="checkbox" checked={checked} aria-label={t("Chọn tin #{id}", { id: m.message_id })} className="mt-1 size-4 shrink-0 accent-hl"
        onChange={() => {}} onClick={(e) => onToggle(e.shiftKey)} />
      <div className="grid min-w-0 gap-0.5">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="truncate font-bold text-ink">{m.outgoing ? t("Bạn") : m.sender_name ?? "?"}</span>
          <span className="shrink-0 font-mono tabular-nums text-ink-3">{timeLabel(m.date)}</span>
          <span className="shrink-0 font-mono text-ink-3">#{m.message_id}</span>
          {old && <span className="sr-only">{t("đã nằm trong lần tóm tắt trước")}</span>}
          <DeepPick m={m} className="-my-1 ml-auto opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" />
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{text}</p>
      </div>
    </li>
  );
}

/** A change to a ticket already in a sprint is scope creep: flag it (the ticket is fetched only for change items). */
function ScopeFlag({ id }: { id: string }) {
  const t = useT();
  const d = useQuery({ queryKey: ["yt", "detail", id], queryFn: () => yt.detail(id), staleTime: 60_000, retry: false });
  const sp = d.data && !d.data.resolved && lastSp(d.data);
  return sp ? (
    <Hint side="bottom" text={t("{id} đang trong sprint {sp}: thay đổi này làm đổi scope sprint", { id, sp })}>
      <span tabIndex={0} className="ml-1 inline-flex items-center gap-1 rounded-full bg-warn-wash px-1.5 text-xs leading-5 text-warn">
        <TriangleAlert className="size-3" aria-hidden /> {t("đổi scope sprint {sp}", { sp })}
      </span>
    </Hint>
  ) : null;
}

/** A decision about a ticket goes on record there: one click adds it as a comment. */
function RecordOn({ id, text }: { id: string; text: string }) {
  const t = useT();
  const save = useMutation({ mutationFn: () => yt.comment(id, text), onSuccess: () => toast({ text: tr("Đã ghi quyết định vào {id}", { id }) }) });
  return (
    <Hint side="bottom" text={save.isError ? t("Không ghi được: {e}", { e: save.error.message }) : t("Thêm quyết định này làm bình luận trên {id}", { id })}>
      <button type="button" disabled={save.isPending || save.isSuccess} onClick={() => save.mutate()}
        className={cn("ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-xs transition-colors duration-(--dur-micro)", save.isError ? "text-error" : "text-ink-3 hover:bg-hl-wash hover:text-hl-2")}>
        {save.isSuccess ? <Check className="size-3" aria-hidden /> : <MessageSquarePlus className="size-3" aria-hidden />}
        {save.isSuccess ? t("đã ghi") : save.isError ? t("ghi lại vào {id}", { id }) : t("ghi vào {id}", { id })}
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
  const t = useT();
  const status = useQuery({ ...statusQuery, staleTime: Infinity }).data; // the shell keeps it fresh
  const [m, setM] = useState<Message | null>(null);
  const load = useMutation({
    mutationFn: () => getMessage(chatId, ids[0]), // the ticket form reads it
    onSuccess: setM,
    onError: (e) => toast({ text: errorText(e, {}, tr("Không mở được tin gốc, thử lại sau")) }),
  });
  if (!ids.length) return null;
  const cls = "ml-1 h-5 px-1 text-ink-3 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3";
  return (
    <>
      <Button type="button" size="xs" variant="ghost" className={cls} onClick={() => void openReplyById(chatId, ids[0])}><Reply aria-hidden /> {t("Trả lời")}</Button>
      {status?.youtrack_configured && (
        <Button type="button" size="xs" variant="ghost" disabled={load.isPending} onClick={() => load.mutate()}
          className={cn(cls, suggest && "bg-hl-wash font-medium text-hl-2")}><Bug aria-hidden /> {suggest ? t("Chưa có ticket · Tạo") : t("Tạo ticket")}</Button>
      )}
      {m && (
        <IssueDialog m={m} note={text} ai={status?.ai_configured ?? false} open onOpenChange={(o) => { if (!o) setM(null); }}
          onCreated={(line) => {
            setM(null);
            onCreated?.();
            toast({ text: line.split(":")[0], action: { label: tr("Báo nhóm"), run: () => void openReplyById(chatId, m.message_id, line) } });
          }} />
      )}
    </>
  );
}

function Refs({ ids, lit, onJump }: { ids: string[]; lit: string | null; onJump: (id: string) => void }) {
  const t = useT();
  return ids.map((id) => (
    <Hint key={id} side="bottom" text={t("Cuộn tới tin gốc trong danh sách")}>
      <button type="button" onClick={() => onJump(id)} aria-label={t("Xem tin gốc #{id}", { id })}
        className={cn("ml-1 rounded-sm px-1 font-mono text-xs transition-colors duration-(--dur-micro)", lit === id ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2 hover:bg-hl-wash hover:text-hl-2")}>
        #{id}
      </button>
    </Hint>
  ));
}

/** "BE" on an item about the backend; "còn mở từ …" on an open item kept from an earlier digest. */
// Words that name a role, not a person: "BE Hỗ trợ" and "BE Thông báo" are not the same sender (as GENERIC in digest.py).
const ROLE_WORDS = new Set(["be", "backend", "dev", "team", "fe", "po", "pm", "qa", "qc", "ba", "bạn", "me", "mọi", "người"]);
const nameWords = (x?: string | null) => (x ?? "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.filter((w) => !ROLE_WORDS.has(w)) ?? [];

/** The messages an item cites plus the ones they reply to, read live from Telegram (Briefing items, Với BE lines).
 *  `asker` (Với BE): that person's messages stand out; "" or no name match: the first cited message (who raised it). */
export function Evidence({ chatId, ids, extra, asker }: { chatId: string; ids: string[]; extra?: ReactNode; asker?: string }) {
  const t = useT();
  const cut = ids.slice(0, 40); // the endpoint's cap
  const ev = useQuery({
    queryKey: ["evidence", chatId, cut],
    queryFn: ({ signal }) => api<Message[]>(`/chats/${chatId}/evidence?${cut.map((i) => `ids=${i}`).join("&")}`, { signal }),
    enabled: cut.length > 0, staleTime: 10 * 60_000,
  });
  const cited = new Set(cut);
  const mark = new Set<string>();
  if (asker !== undefined && ev.data) {
    const want = nameWords(asker);
    for (const m of ev.data) {
      const have = nameWords(m.sender_name);
      if (asker === "me" ? m.outgoing : want.some((w) => have.includes(w))) mark.add(m.message_id);
    }
    const first = ev.data.find((m) => cited.has(m.message_id));
    if (!mark.size && first) mark.add(first.message_id);
  }
  return (
    <div className="grid gap-1.5 text-xs">
      <p className="flex items-center gap-2 font-medium text-ink-3">
        {t("Tin nhắn liên quan")} {ev.data && <span className="font-mono tabular-nums">{ev.data.length}</span>}
        {extra}
      </p>
      {!cut.length ? <p className="text-ink-3">{t("AI không trích tin nào cho mục này.")}</p>
        : ev.isPending ? <Skeleton className="h-16" />
        : ev.isError ? <p role="alert" className="text-error">{digestError(ev.error)}</p>
        : !ev.data.length ? <p className="text-ink-3">{t("Tin gốc đã bị xóa hoặc không đọc được.")}</p>
        : (
          <ol className="grid gap-1.5">
            {ev.data.map((m) => (
              <li key={m.message_id} className={cn("grid gap-0.5 border-l-2 py-0.5 pl-2.5",
                mark.has(m.message_id) ? "rounded-r-md border-info bg-info-wash/60 py-1.5 pr-2" : cited.has(m.message_id) ? "border-hl" : "border-rule opacity-75")}>
                <span className="flex flex-wrap items-baseline gap-x-2 text-ink-3">
                  <b className="font-bold text-ink-2">{m.outgoing ? t("Bạn") : m.sender_name || "?"}</b>
                  {timeLabel(m.date)}
                  <span className="font-mono tabular-nums">#{m.message_id}</span>
                  {mark.has(m.message_id) ? <span className="font-medium text-info">{t("· người hỏi")}</span>
                    : !cited.has(m.message_id) && <span>{t("· tin được trả lời")}</span>}
                </span>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
                  {m.media_kind && <span className="text-ink-3">{m.media_kind === "photo" ? `[${t("ảnh")}] ` : "[file] "}</span>}
                  {m.text}
                </p>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}

export function ItemFlags({ it, be = true }: { it: DigestItem; be?: boolean }) {
  const t = useT();
  return (
    <>
      {be && it.be && <span className="ml-1 rounded-sm bg-code-wash px-1 text-xs font-medium text-code">BE</span>}
      {it.carried && it.at && (
        <Hint side="bottom" text={t("Chưa ai trả lời / làm từ lần tóm tắt trước; tự mất khi tin mới giải quyết nó")}>
          <span tabIndex={0} className="ml-1 rounded-full bg-warn-wash px-1.5 text-xs leading-5 text-warn">{t("còn mở từ {day}", { day: dayLabel(it.at).toLowerCase() })}</span>
        </Hint>
      )}
    </>
  );
}

export function Result({ r, when, lit, onJump, onCopy, title, chatId }: { r: DigestResult; when: string | null; lit: string | null; onJump: (id: string) => void; onCopy: () => void; title?: string; chatId?: string }) {
  const t = useT();
  const [only, setOnly] = useState<"all" | "be">("all");
  const [done, toggle] = useDone();
  const answered = useQuery({ ...answeredQuery, enabled: !!chatId }).data;
  const closed = (key: string, it: DigestItem) => !!chatId && isClosedItem(chatId, key, it, done, answered);
  // "Với BE": what is still open with BE; items you ticked off in Briefing or replied to on Telegram drop out.
  const beOpen = (key: string, it: DigestItem) => !!it.be && !closed(key, it);
  const beCount = SECTIONS.reduce((n, [k]) => n + (r[k] ?? []).filter((it) => beOpen(k, it)).length, 0);
  const beDone = SECTIONS.reduce((n, [k]) => n + (r[k] ?? []).filter((it) => it.be && closed(k, it)).length, 0);
  const code = usesCode(useRole()); // QA / PO: no "Với BE" filter (BE topics are checked against the code)
  const be = code && only === "be";
  const empty = !r.raw && !r.topics?.length && SECTIONS.every(([k]) => !r[k]?.length);
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <span>{when ? t("Bản tóm tắt lúc {time}", { time: timeLabel(when) }) : t("Vừa tóm tắt")}</span>
        <span>{t("{n} tin", { n: r.source_count })}</span>
        <Button size="xs" variant="outline" className="ml-auto" onClick={onCopy}><Copy /> Copy markdown</Button>
      </div>
      {code && !empty && !r.raw && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented id="tg-digest-be" label={t("Lọc mục")} value={only} onChange={setOnly}
            items={[{ value: "all", label: t("Tất cả") }, { value: "be", label: t("Với BE · {n}", { n: beCount }), title: t("Hỏi / trả lời / chốt với BE (API, field, data) còn chưa xử lý") }]} />
          {be && beDone > 0 && <span className="text-xs text-ink-3">{t("ẩn {n} mục đã xử lý", { n: beDone })}</span>}
        </div>
      )}
      {be && !beCount && (
        <p className="text-sm text-ink-3">
          {beDone ? t("Mọi mục với BE đã xử lý.")
            : SECTIONS.some(([k]) => r[k]?.some((it) => it.topic)) ? t("Không có trao đổi nào với BE trong bản tóm tắt này.")
            : t("Bản tóm tắt này làm trước khi có phân loại BE: chọn \"7 ngày\" ở trên rồi bấm Tóm tắt để AI đọc lại và gom theo chủ đề.")}
        </p>
      )}
      {be && chatId && (
        <BeTopics chatId={chatId} title={title ?? "nhóm"} r={r} open={(k, it) => !closed(k, it)} lit={lit} onJump={onJump}
          onToggle={(k, it) => toggle(todoKey(chatId, k, it))} />
      )}
      {empty && <p className="text-sm text-ink-3">{t("AI không tìm thấy nội dung đáng chú ý.")}</p>}
      {r.raw && (
        <div className="grid gap-1">
          <p className="text-xs text-warn">{t("AI trả về không đúng định dạng; hiện nguyên văn:")}</p>
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
            <h3 className={cn("text-sm font-bold", key === "confirmations" ? "text-hl-2" : "text-ink")}>
              {t(label)} <span className="font-mono font-normal">{list.length}</span>
            </h3>
            {groups.map(([team, its]) => (
              <div key={team} className="grid gap-1.5">
                {team && <span className="text-sm font-bold">{team}</span>}
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
          <h3 className="text-sm font-bold text-ink">{t("Chủ đề")} <span className="font-mono font-normal">{r.topics.length}</span></h3>
          <ul className="grid gap-3">
            {r.topics.map((tp, i) => {
              const [s, cls] = STATUS[tp.status ?? "open"];
              return (
                <li key={i} className="grid gap-0.5 text-sm leading-relaxed">
                  <span className="flex items-center gap-2">
                    <span className="font-bold">{tp.title}</span>
                    <span className={cn("rounded-full px-1.5 text-xs leading-5", cls)}>{t(s)}</span>
                  </span>
                  <span className="text-ink-2">{tp.summary}<Tickets ids={tp.tickets} /><Refs ids={tp.message_ids ?? []} lit={lit} onJump={onJump} /></span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
