"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Loader2, Plus, RotateCw, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { digestError, Result, toMarkdown } from "@/components/digest-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type BriefingItem, type DigestResult, type GroupInfo } from "@/lib/api";
import { timeLabel, toast } from "@/lib/inbox";
import { readDigestTeams, useRole } from "@/lib/prefs";
import { yt } from "@/lib/yt";
import { cn } from "@/lib/utils";

type RunState = { status: "running" | "done" | "error"; error?: string };

/** Telegram has messages newer than the last digest (or there was none yet). */
const hasNews = (i: BriefingItem) =>
  i.latest_id !== null && i.latest_id !== undefined && (!i.saved || Number(i.latest_id) > Number(i.saved.last_message_id));

function counts(r: DigestResult) {
  return [
    [r.confirmations?.length ?? 0, "cần confirm"],
    [r.decisions?.length ?? 0, "đã chốt"],
    [r.changes?.length ?? 0, "thay đổi"],
    [r.actions?.length ?? 0, "việc cần làm"],
  ]
    .filter(([n]) => n)
    .map(([n, l]) => `${n} ${l}`)
    .join(" · ");
}

/** Any Telegram group, tagged or not: opening one goes to its Digest, where "Cho phép" adds it here. */
function AddGroup({ known, onPick }: { known: Set<string>; onPick: (chatId: string, title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: ({ signal }) => api<GroupInfo[]>("/groups", { signal }),
    enabled: open,
    staleTime: 60_000,
  });
  const needle = q.trim().toLowerCase();
  const list = (groups.data ?? []).filter((g) => !known.has(g.chat_id) && g.title.toLowerCase().includes(needle));
  return (
    <details className="mt-6 text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-ink-3"><Plus className="inline size-3.5" aria-hidden /> Tóm tắt nhóm chưa tag</summary>
      <div className="mt-2 grid max-w-md gap-2 pl-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhóm…" aria-label="Tìm nhóm" />
        {groups.isPending && <Skeleton className="h-16 w-full" />}
        {groups.isError && <p role="alert" className="text-error">{digestError(groups.error)}</p>}
        {groups.data && (
          <ul className="grid max-h-72 gap-0.5 overflow-y-auto">
            {list.map((g) => (
              <li key={g.chat_id}>
                <button type="button" onClick={() => onPick(g.chat_id, g.title)}
                  className="w-full truncate rounded-md px-2 py-1 text-left text-ink-2 hover:bg-paper-3 hover:text-ink">
                  {g.title}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2 text-ink-3">Không có nhóm nào khác.</li>}
          </ul>
        )}
      </div>
    </details>
  );
}

/** Every group at a glance: summarize all groups with news in one go, open questions first. */
export function BriefingPage({ onBack, onOpenDigest }: { onBack: () => void; onOpenDigest: (chatId: string, title: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["briefing"],
    queryFn: ({ signal }) => api<BriefingItem[]>("/briefing", { signal }),
  });
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [running, setRunning] = useState(false);
  // Aborting the request is the stop: the server sees the browser go and kills that claude run. Leaving the page stops too.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const items = list.data ?? [];
  const allowed = items.filter((i) => i.consent);
  const blocked = items.filter((i) => !i.consent);
  const todo = allowed.filter(hasNews);
  const offline = allowed.length > 0 && allowed.every((i) => i.latest_id == null);
  // Open questions across every group, from each group's latest digest.
  const asks = allowed.flatMap((i) => (i.saved?.result.confirmations ?? []).map((c) => ({ ...c, chat: i })));
  // Asked of me (my YouTrack name; a PO also answers to "PO" / "PM") first, the rest after.
  const role = useRole();
  const me = useQuery({ queryKey: ["yt", "me"], queryFn: yt.me, staleTime: Infinity, retry: false }).data?.name?.toLowerCase();
  const isMine = (who: string) => (!!me && who.toLowerCase().includes(me)) || (role === "po" && /\b(PO|PM|product owner)\b/i.test(who));
  const mine = asks.filter((a) => isMine(a.who ?? ""));
  const others = asks.filter((a) => !isMine(a.who ?? ""));

  // One group at a time: keeps the AI provider and Telegram calm, and each result lands as it comes.
  async function runAll() {
    const stop = (abort.current = new AbortController()).signal;
    setRunning(true);
    const until = new Date().toISOString();
    const teams = readDigestTeams();
    for (const it of todo) {
      if (stop.aborted) break;
      setRuns((s) => ({ ...s, [it.chat_id]: { status: "running" } }));
      try {
        await api<DigestResult>("/digest", {
          method: "POST",
          json: {
            chat_id: it.chat_id,
            since: it.saved?.last_date ?? new Date(Date.now() - 24 * 3_600_000).toISOString(),
            until,
            message_ids: [],
            after_id: it.saved ? Number(it.saved.last_message_id) : null,
            teams,
          },
          signal: stop,
        });
        setRuns((s) => ({ ...s, [it.chat_id]: { status: "done" } }));
      } catch (e) {
        setRuns((s) => ({ ...s, [it.chat_id]: { status: "error", error: stop.aborted ? "Đã dừng." : digestError(e) } }));
      }
      void qc.invalidateQueries({ queryKey: ["digest-saved", it.chat_id] });
    }
    void qc.invalidateQueries({ queryKey: ["briefing"] });
    setRunning(false);
  }

  async function copyAll() {
    const parts = allowed.filter((i) => i.saved).map((i) => toMarkdown(i.saved!.result, i.title).replace(/^# /, "## "));
    try {
      await navigator.clipboard.writeText([`# Briefing ${timeLabel(new Date().toISOString(), true)}`, ...parts].join("\n\n"));
      toast({ text: "Đã copy markdown" });
    } catch {
      toast({ text: "Không copy được" });
    }
  }

  const groupButton = (i: BriefingItem) => (
    <button type="button" onClick={() => onOpenDigest(i.chat_id, i.title)} title="Mở tóm tắt của nhóm"
      className="truncate font-semibold text-ink underline-offset-2 hover:underline">
      {i.title}
    </button>
  );

  return (
    <section aria-label="Briefing" className="flex min-h-0 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại">
          <ArrowLeft />
        </Button>
        <span className="text-sm text-ink-2">
          {list.data ? `${todo.length}/${allowed.length} nhóm có tin mới từ lần tóm tắt trước` : "Đang kiểm tra các nhóm…"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Kiểm tra lại" title="Kiểm tra lại tin mới" disabled={running || list.isFetching}
            onClick={() => void list.refetch()}>
            <RotateCw className={cn(list.isFetching && "animate-spin")} />
          </Button>
          <Button size="xs" variant="outline" disabled={!allowed.some((i) => i.saved)} onClick={() => void copyAll()}>
            <Copy /> Copy tất cả
          </Button>
          {running ? (
            <Button size="sm" variant="outline" className="hover:bg-error-wash hover:text-error" title="Dừng tóm tắt (nhóm đang chạy bị hủy)"
              onClick={() => abort.current?.abort()}>
              <Square className="fill-current" aria-hidden /> Dừng
            </Button>
          ) : (
            <Button size="sm" disabled={!todo.length} onClick={() => void runAll()}>
              <Sparkles /> {todo.length ? `Tóm tắt ${todo.length} nhóm` : "Không có tin mới"}
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
        {list.isPending && (
          <div className="grid gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        )}
        {list.isError && (
          <p role="alert" className="flex items-center gap-2 text-sm text-error">
            {digestError(list.error)}
            <Button size="xs" variant="outline" onClick={() => void list.refetch()}><RotateCw /> Thử lại</Button>
          </p>
        )}
        {list.data && !allowed.length && (
          <p className="max-w-prose text-sm leading-relaxed text-ink-3">
            Chưa nhóm nào cho phép AI đọc. Mở một nhóm → <b className="font-semibold text-ink-2">Tóm tắt</b> → <b className="font-semibold text-ink-2">Cho phép</b>, rồi nhóm đó sẽ có mặt ở đây.
          </p>
        )}
        {offline && <p className="mb-4 text-sm text-warn">Không kiểm tra được tin mới; Telegram có thể chưa kết nối.</p>}

        {([[mine, "Chờ bạn chốt", "bg-hl-wash/60"], [others, mine.length ? "Chờ người khác confirm" : "Cần confirm", "bg-hl-wash/30"]] as const).map(([list, label, bg]) => list.length > 0 && (
          <section key={label} className={cn("mb-6 grid gap-2 rounded-[var(--radius-card)] p-3 md:p-4", bg)}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-hl-2">
              {label} <span className="font-mono font-normal">{list.length}</span>
            </h3>
            <ul className="grid gap-1.5">
              {list.map((a, n) => (
                <li key={n} className="text-sm leading-relaxed">
                  <span className="text-ink">{a.text}</span>
                  {a.who && <span className="text-ink-3"> — hỏi {a.who}</span>}
                  <span className="text-ink-3"> · </span>
                  <button type="button" className="text-xs text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => onOpenDigest(a.chat.chat_id, a.chat.title)}>
                    {a.chat.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <ul className="grid gap-3">
          {[...allowed].sort((a, b) => Number(hasNews(b)) - Number(hasNews(a))).map((i) => {
            const run = runs[i.chat_id];
            return (
              <li key={i.chat_id} className="rounded-[var(--radius-card)] border border-rule p-3 md:p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {groupButton(i)}
                  {run?.status === "running" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-2"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Đang tóm tắt…</span>
                  ) : run?.status === "error" ? (
                    <span role="alert" className="text-xs text-error">{run.error}</span>
                  ) : hasNews(i) ? (
                    <span className="rounded-full bg-warn-wash px-1.5 text-xs leading-5 text-warn">Có tin mới</span>
                  ) : (
                    <span className="text-xs text-ink-3">Không có tin mới</span>
                  )}
                  {i.saved && <span className="ml-auto text-xs text-ink-3">tóm tắt lúc {timeLabel(i.saved.created_at)}</span>}
                </div>
                {i.saved ? (
                  <details className="group mt-1.5">
                    <summary className="cursor-pointer text-sm text-ink-2 marker:text-ink-3">
                      {counts(i.saved.result) || "Không có gì đáng chú ý"}
                    </summary>
                    <div className="mt-3 border-t border-rule pt-3">
                      <Result r={i.saved.result} title={i.title} when={i.saved.created_at} lit={null} onJump={() => onOpenDigest(i.chat_id, i.title)}
                        onCopy={() => void navigator.clipboard.writeText(toMarkdown(i.saved!.result, i.title)).then(() => toast({ text: "Đã copy markdown" }), () => toast({ text: "Không copy được" }))} />
                    </div>
                  </details>
                ) : (
                  <p className="mt-1.5 text-sm text-ink-3">Chưa tóm tắt lần nào; lần đầu sẽ lấy 24 giờ gần nhất.</p>
                )}
              </li>
            );
          })}
        </ul>

        {blocked.length > 0 && (
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-ink-3">Chưa cho phép AI ({blocked.length})</summary>
            <ul className="mt-2 grid gap-1.5 pl-4">
              {blocked.map((i) => (
                <li key={i.chat_id} className="flex items-center gap-2">
                  {groupButton(i)}
                  <span className="text-xs text-ink-3">mở để cho phép</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {list.data && <AddGroup known={new Set(items.map((i) => i.chat_id))} onPick={onOpenDigest} />}
      </div>
    </section>
  );
}
