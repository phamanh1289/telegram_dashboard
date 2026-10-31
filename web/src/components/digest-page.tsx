"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, RotateCw, ShieldCheck, Sparkles } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { DateRangePicker, type DayRange, rangeLabel, rangeQuery } from "@/components/date-range";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type DigestConsent, type DigestItem, type DigestResult, type HistoryPage, type Message, type SavedDigest } from "@/lib/api";
import { timeLabel, toast } from "@/lib/inbox";
import { readDigestTeams } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const PRESETS = [["24h", 24], ["3 ngày", 72], ["7 ngày", 168]] as const;

const ERRORS: Record<string, string> = {
  digest_consent_required: "Cần cho phép AI đọc nhóm này trước.",
  digest_empty: "Không có tin nào để tóm tắt.",
  digest_too_large: "Quá nhiều tin cho một lần tóm tắt; hãy thu hẹp khoảng thời gian.",
  not_connected: "Telegram chưa kết nối.",
  ai_not_configured: "Chưa cấu hình AI (AI_BASE_URL/AI_MODEL/AI_API_KEY hoặc AI_AGENT_COMMAND).",
  ai_timeout: "AI phản hồi quá lâu; thử lại hoặc thu hẹp khoảng thời gian.",
  ai_provider_error: "AI gặp lỗi; thử lại.",
  ai_permission_changed: "Quyền đã đổi trong lúc xử lý; kết quả bị bỏ.",
  chat_not_found: "Không tìm thấy nhóm.",
};
const errorText = (e: unknown) =>
  e instanceof ApiError ? (e.detail && e.code !== "not_connected" ? e.detail : ERRORS[e.code] ?? "Có lỗi xảy ra.") : "Có lỗi xảy ra.";

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

/** Impacts grouped by team, in first-seen order. */
function byTeam(list: DigestItem[]): [string, DigestItem[]][] {
  const out = new Map<string, DigestItem[]>();
  for (const it of list) out.set(it.who || "Khác", [...(out.get(it.who || "Khác") ?? []), it]);
  return [...out];
}

function meta(key: string, it: DigestItem) {
  if (key === "decisions" && it.who) return `chốt bởi ${it.who}`;
  if (key === "confirmations" && it.who) return `hỏi ${it.who}`;
  if (key === "actions") return [it.who, it.due && `hạn ${it.due}`].filter(Boolean).join(" · ");
  return "";
}

function toMarkdown(r: DigestResult, title: string) {
  const refs = (ids: string[]) => (ids.length ? ` (${ids.map((i) => `#${i}`).join(", ")})` : "");
  const out = [`# Tóm tắt: ${title}`];
  for (const [key, label] of SECTIONS) {
    const items = r[key] ?? [];
    if (!items.length) continue;
    out.push("", `## ${label}`);
    for (const it of items) {
      const m = key === "impacts" ? `**${it.who || "Khác"}**: ` : "";
      const extra = meta(key, it);
      out.push(`- ${m}${it.text}${extra ? ` — ${extra}` : ""}${refs(it.message_ids ?? [])}`);
    }
  }
  if (r.topics?.length) {
    out.push("", "## Chủ đề");
    for (const t of r.topics) out.push(`- **${t.title}** [${STATUS[t.status ?? "open"][0]}]: ${t.summary}${refs(t.message_ids ?? [])}`);
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
  const run = useMutation({
    mutationFn: () =>
      api<DigestResult>("/digest", {
        method: "POST",
        json: { chat_id: chatId, since: win.since, until: win.until, message_ids: [...picked], teams: readDigestTeams() },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["digest-saved", chatId] }),
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
    document.querySelector(`[data-digest-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(toMarkdown(shown, title));
      toast({ text: "Đã copy markdown" });
    } catch {
      toast({ text: "Không copy được" });
    }
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
        <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="Quay lại nhóm" title="Quay lại nhóm">
          <ArrowLeft />
        </Button>
        <span className="text-sm font-semibold">Tóm tắt</span>
        <div role="tablist" aria-label="Khoảng thời gian" className="flex rounded-md bg-paper-2 p-0.5 text-xs shadow-groove">
          {last && (
            <button type="button" role="tab" aria-selected={preset === "last"} onClick={() => onPreset("last")}
              title={`Tin mới từ lần tóm tắt trước (${timeLabel(last.last_date)})`}
              className={cn("h-[26px] rounded-[5px] px-3 transition-colors duration-(--dur-micro)", preset === "last" ? "bg-hl font-medium text-hl-ink" : "text-ink-3 hover:text-ink")}>
              Từ lần trước
            </button>
          )}
          {PRESETS.map(([l, h]) => (
            <button key={h} type="button" role="tab" aria-selected={preset === h} onClick={() => onPreset(h)}
              className={cn("h-[26px] rounded-[5px] px-3 transition-colors duration-(--dur-micro)", preset === h ? "bg-hl font-medium text-hl-ink" : "text-ink-3 hover:text-ink")}>
              {l}
            </button>
          ))}
        </div>
        <DateRangePicker value={days} onChange={onDays} emptyLabel="Tuỳ chọn ngày" />
        <Button size="sm" className="ml-auto" aria-busy={run.isPending}
          disabled={!enabled || !items.length || run.isPending || history.isFetching || tooMany}
          title={tooMany ? "Khoảng này quá nhiều tin: thu hẹp khoảng thời gian hoặc chọn tin cần tóm tắt" : undefined}
          onClick={() => run.mutate()}>
          <Sparkles /> {run.isPending ? "Đang tóm tắt…" : picked.size ? `Tóm tắt ${picked.size} tin đã chọn` : tooMany ? "Quá nhiều tin" : `Tóm tắt ${items.length} tin`}
        </Button>
      </div>

      {consent.data && !enabled && (
        <div role="note" className="flex flex-wrap items-center gap-3 border-b bg-hl-wash/50 px-3 py-2.5 text-sm md:px-5">
          <ShieldCheck className="size-4 shrink-0 text-hl-2" aria-hidden />
          <span className="min-w-0 flex-1">Cho phép AI đọc tin của nhóm này để tóm tắt. Nội dung đã gửi cho AI provider không thu hồi được.</span>
          <select aria-label="Thời hạn cho phép" value={consentDays} onChange={(e) => setConsentDays(Number(e.target.value))}
            className="h-[30px] rounded-[var(--radius-input)] border border-rule-2 bg-cotton px-2 text-xs text-ink">
            {CONSENT_DAYS.map((d) => <option key={d} value={d}>{d} ngày</option>)}
          </select>
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
        <p role="alert" className="border-b px-3 py-1.5 text-xs text-error md:px-5">Không đổi được quyền AI: {errorText(setConsent.error)}</p>
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
            <div aria-busy className="grid gap-3" aria-label="Đang tóm tắt…">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4" style={{ width: `${90 - i * 15}%` }} />)}
            </div>
          ) : run.isError ? (
            <p role="alert" className="text-sm text-error">{errorText(run.error)}</p>
          ) : shown ? (
            <Result r={shown} when={run.data ? null : last?.created_at ?? null} lit={lit} onJump={jump} onCopy={() => void copy()} />
          ) : (
            <p className="text-sm leading-relaxed text-ink-3">
              Tóm tắt {label}: đã chốt gì, thay đổi gì, ảnh hưởng team nào, cần PO/PM confirm gì. Chọn tin bên dưới (Shift+click để chọn cả đoạn) nếu chỉ muốn tóm tắt một phần.
            </p>
          )}
        </div>

        <ol aria-label="Hội thoại" className="grid content-start divide-y divide-rule lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          {history.isPending && [0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="grid gap-2 px-3 py-3 md:px-5"><Skeleton className="h-3 w-32" /><Skeleton className="h-3.5 w-4/5" /></li>
          ))}
          {history.isError && (
            <li role="alert" className="flex items-center gap-2 px-3 py-3 text-sm text-error md:px-5">
              {errorText(history.error)}
              <Button size="xs" variant="outline" className="ml-auto" onClick={() => void history.refetch()}><RotateCw /> Thử lại</Button>
            </li>
          )}
          {history.data?.truncated && (
            <li className="px-3 py-2 text-xs text-warn md:px-5">Chỉ hiện {items.length} tin mới nhất; thu hẹp khoảng thời gian để tóm tắt đủ.</li>
          )}
          {history.data && !items.length && <li className="px-3 py-6 text-sm text-ink-3 md:px-5">Không có tin nào trong {label.toLowerCase()}.</li>}
          {items.map((m, i) => (
            <Fragment key={m.message_id}>
              <Row m={m} checked={picked.has(m.message_id)} lit={lit === m.message_id} old={isOld(m)}
                onToggle={(shift) => toggle(i, shift)} />
              {isOld(m) && items[i + 1] && !isOld(items[i + 1]) && (
                <li role="separator" className="flex items-center gap-2 px-3 py-1 text-xs font-medium text-hl-2 md:px-5">
                  <span className="h-px flex-1 bg-hl/40" />Đã tóm tắt đến đây · {timeLabel(last!.created_at)}<span className="h-px flex-1 bg-hl/40" />
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
      title={old ? "Đã nằm trong lần tóm tắt trước" : undefined}
      className={cn("flex cursor-pointer gap-3 px-3 py-2.5 transition-colors duration-(--dur-micro) hover:bg-paper-2 md:px-5", old && !checked && !lit && "opacity-60", checked && "bg-hl-wash/60", lit && "bg-hl-wash")}
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
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{text}</p>
      </div>
    </li>
  );
}

function Refs({ ids, lit, onJump }: { ids: string[]; lit: string | null; onJump: (id: string) => void }) {
  return ids.map((id) => (
    <button key={id} type="button" onClick={() => onJump(id)} title="Xem tin gốc"
      className={cn("ml-1 rounded-sm px-1 font-mono text-xs transition-colors duration-(--dur-micro)", lit === id ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2 hover:bg-hl-wash hover:text-hl-2")}>
      #{id}
    </button>
  ));
}

function Result({ r, when, lit, onJump, onCopy }: { r: DigestResult; when: string | null; lit: string | null; onJump: (id: string) => void; onCopy: () => void }) {
  const empty = !r.raw && !r.topics?.length && SECTIONS.every(([k]) => !r[k]?.length);
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2 text-xs text-ink-3">
        {when ? <>Bản tóm tắt lúc {timeLabel(when)} · {r.source_count} tin</> : <>Vừa tóm tắt · {r.source_count} tin</>}
        <Button size="xs" variant="outline" className="ml-auto" onClick={onCopy}><Copy /> Copy markdown</Button>
      </div>
      {empty && <p className="text-sm text-ink-3">AI không tìm thấy nội dung đáng chú ý.</p>}
      {r.raw && (
        <div className="grid gap-1">
          <p className="text-xs text-warn">AI trả về không đúng định dạng; hiện nguyên văn:</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.raw}</p>
        </div>
      )}
      {SECTIONS.map(([key, label]) => {
        const list = r[key] ?? [];
        if (!list.length) return null;
        // Impacts read best grouped by team.
        const groups = key === "impacts"
          ? byTeam(list)
          : [["", list] as [string, DigestItem[]]];
        return (
          <section key={key} className="grid gap-2">
            <h3 className={cn("text-xs font-semibold uppercase tracking-wide", key === "confirmations" ? "text-hl-2" : "text-ink-3")}>
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
                        <span className="text-ink">{it.text}</span>
                        {extra && <span className="text-ink-3"> — {extra}</span>}
                        <Refs ids={it.message_ids ?? []} lit={lit} onJump={onJump} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
      {!!r.topics?.length && (
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Chủ đề <span className="font-mono font-normal">{r.topics.length}</span></h3>
          <ul className="grid gap-3">
            {r.topics.map((t, i) => {
              const [s, cls] = STATUS[t.status ?? "open"];
              return (
                <li key={i} className="grid gap-0.5 text-sm leading-relaxed">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{t.title}</span>
                    <span className={cn("rounded-full px-1.5 text-xs leading-5", cls)}>{s}</span>
                  </span>
                  <span className="text-ink-2">{t.summary}<Refs ids={t.message_ids ?? []} lit={lit} onJump={onJump} /></span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
