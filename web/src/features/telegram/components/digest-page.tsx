"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, MessageSquarePlus, RotateCw, ShieldCheck, ShieldOff, Sparkles, TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { BeTopics } from "@/features/telegram/components/be-topics";
import { AiStop } from "@/shared/components/ai/chat";
import { AiFetching, digestLines, useAiWait } from "@/shared/components/ai/fetching";
import { DateRangePicker, type DayRange, rangeLabel, rangeQuery } from "@/shared/components/date-range";
import { DeepPick } from "@/features/telegram/components/deep-think";
import { NextSteps } from "@/features/telegram/components/next-steps";
import { useBriefRun } from "@/features/telegram/components/briefing/run";
import { answeredQuery, byTeam, closedIds, digestError, isClosedItem, meta, recordText, SECTIONS, STATUS, todoKey, toMarkdown } from "@/features/telegram/lib/digest";
import { useDone } from "@/features/telegram/lib/follow";
import { TicketChip } from "@/features/telegram/components/message/rich-text";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/dialog";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Hint } from "@/shared/components/ui/hint";
import { api, type DigestConsent, type DigestItem, type DigestResult, type HistoryPage, type Message, type SavedDigest } from "@/shared/lib/api";
import { t as tr, useT } from "@/shared/lib/i18n";
import { copyText, toast } from "@/shared/lib/notifications";
import { smooth } from "@/shared/lib/utils";
import { dayLabel, timeLabel } from "@/shared/lib/time";
import { aboutMe, readDigestTeams, useRole, usesCode } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { lastSp, yt, ytFail } from "@/features/youtrack/lib/yt";
import { Segmented } from "@/shared/components/ui/segmented";

const PRESETS = [["24h", 24], ["3 ngày", 72], ["7 ngày", 168]] as const;

// `until` is always set when a range is chosen, so the list and the digest cover the same messages.
type Span = { since: string; until: string };
const span = (since: string, until?: string | null): Span => ({ since, until: until ?? new Date().toISOString() });
const hoursAgo = (h: number) => span(new Date(Date.now() - h * 3_600_000).toISOString());
const CONSENT_DAYS = [7, 30, 90] as const;

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
  // Briefing's batch is summarizing this group right now: a run here would save over it (or be saved over)
  const inBatch = useBriefRun().runs[chatId]?.status === "running";
  // Aborting is the stop: the server sees the request go and kills that AI run (as Briefing's batch does).
  const stop = useRef<AbortController | null>(null);
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
          ...aboutMe(),
        },
        signal: (stop.current = new AbortController()).signal,
      }),
    // the range stays as summarized: a first digest's new cursor must not swap the list under its result for "since last time"
    onMutate: () => { touched.current = true; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["digest-saved", chatId] }); void qc.invalidateQueries({ queryKey: ["briefing"] }); },
  });

  /** Stop the run in flight (the Stop button, or another range picked: its result would be for the old one). */
  function stopRun() {
    stop.current?.abort();
    run.reset();
  }
  function choose(next: Span) {
    touched.current = true;
    setWin(next);
    setPicked(new Set());
    anchor.current = null;
    stopRun();
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
        <span className="ml-auto flex items-center gap-2">
          {run.isPending && <AiStop onClick={stopRun} label={t("Dừng tóm tắt")} hint={t("Dừng tóm tắt")} />}
          <Button size="sm" aria-busy={run.isPending}
            disabled={!enabled || !items.length || run.isPending || history.isFetching || tooMany || inBatch}
            onClick={() => run.mutate(keep)}>
            <Sparkles /> {run.isPending ? t("Đang tóm tắt…") : inBatch ? t("Briefing đang tóm tắt nhóm này…") : picked.size ? t("Tóm tắt {n} tin đã chọn", { n: picked.size }) : tooMany ? t("Quá nhiều tin") : t("Tóm tắt {n} tin", { n: items.length })}
          </Button>
        </span>
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
  const save = useMutation({ mutationFn: () => yt.comment(id, text), onSuccess: () => toast({ text: tr("Đã ghi quyết định vào {id}", { id }) }),
    onError: (e) => { const f = ytFail(e); toast({ text: tr("Không ghi được: {e}", { e: f.msg }), failure: f.failure }); } });
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
  const po = useRole() === "po"; // a PO records a decision with "Cập nhật story" (description + comment): no second way here
  const projects = useQuery({ queryKey: ["yt", "projects"], queryFn: yt.projects, staleTime: Infinity, retry: false });
  return (ids ?? []).filter((id) => projects.data?.some((p) => p.shortName === id.split("-")[0])).map((id) => (
    <Fragment key={id}>
      {" "}<TicketChip id={id} />
      {scope && <ScopeFlag id={id} />}
      {record && !po && <RecordOn id={id} text={record} />}
    </Fragment>
  ));
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

/** `kind`: a decision / change kept from an earlier digest waits on the story (not on a reply), and says so. */
export function ItemFlags({ it, be = true, kind }: { it: DigestItem; be?: boolean; kind?: string }) {
  const t = useT();
  const story = kind === "decisions" || kind === "changes";
  return (
    <>
      {be && it.be && <span className="ml-1 rounded-sm bg-code-wash px-1 text-xs font-medium text-code">BE</span>}
      {it.carried && it.at && (
        <Hint side="bottom" text={story ? t("Đã chốt từ lần tóm tắt trước, chưa đưa vào story ticket: giữ lại tới khi Cập nhật story hoặc đánh dấu đã xử lý")
          : t("Chưa ai trả lời / làm từ lần tóm tắt trước; tự mất khi tin mới giải quyết nó")}>
          <span tabIndex={0} className="ml-1 rounded-full bg-warn-wash px-1.5 text-xs leading-5 text-warn">
            {story ? t("chưa vào story từ {day}", { day: dayLabel(it.at).toLowerCase() }) : t("còn mở từ {day}", { day: dayLabel(it.at).toLowerCase() })}
          </span>
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
                        <ItemFlags it={it} kind={key} />
                        <Tickets ids={it.tickets} scope={key === "changes"}
                          record={key === "decisions" ? recordText(it, title) : undefined} />
                        <Refs ids={it.message_ids ?? []} lit={lit} onJump={onJump} />
                        {chatId && key !== "impacts" && <NextSteps chatId={chatId} it={it} kind={key} />}
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
