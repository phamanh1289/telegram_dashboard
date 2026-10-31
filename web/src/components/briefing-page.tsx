"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Loader2, RotateCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { errorText, Result, toMarkdown } from "@/components/digest-page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type BriefingItem, type DigestResult } from "@/lib/api";
import { timeLabel, toast } from "@/lib/inbox";
import { readDigestTeams } from "@/lib/prefs";
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

/** Every group at a glance: summarize all groups with news in one go, open questions first. */
export function BriefingPage({ onBack, onOpenDigest }: { onBack: () => void; onOpenDigest: (chatId: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["briefing"],
    queryFn: ({ signal }) => api<BriefingItem[]>("/briefing", { signal }),
  });
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [running, setRunning] = useState(false);

  const items = list.data ?? [];
  const allowed = items.filter((i) => i.consent);
  const blocked = items.filter((i) => !i.consent);
  const todo = allowed.filter(hasNews);
  const offline = allowed.length > 0 && allowed.every((i) => i.latest_id == null);
  // Open questions across every group, from each group's latest digest.
  const asks = allowed.flatMap((i) => (i.saved?.result.confirmations ?? []).map((c) => ({ ...c, chat: i })));

  // One group at a time: keeps the AI provider and Telegram calm, and each result lands as it comes.
  async function runAll() {
    setRunning(true);
    const until = new Date().toISOString();
    const teams = readDigestTeams();
    for (const it of todo) {
      setRuns((s) => ({ ...s, [it.chat_id]: { status: "running" } }));
      try {
        await api<DigestResult>("/digest", {
          method: "POST",
          json: {
            chat_id: it.chat_id,
            since: it.saved?.last_date ?? new Date(Date.now() - 24 * 3_600_000).toISOString(),
            until,
            message_ids: [],
            teams,
          },
        });
        setRuns((s) => ({ ...s, [it.chat_id]: { status: "done" } }));
      } catch (e) {
        setRuns((s) => ({ ...s, [it.chat_id]: { status: "error", error: errorText(e) } }));
      }
      await qc.invalidateQueries({ queryKey: ["briefing"] });
      void qc.invalidateQueries({ queryKey: ["digest-saved", it.chat_id] });
    }
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
    <button type="button" onClick={() => onOpenDigest(i.chat_id)} title="Mở tóm tắt của nhóm"
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
          <Button size="sm" aria-busy={running} disabled={running || !todo.length} onClick={() => void runAll()}>
            <Sparkles /> {running ? "Đang tóm tắt…" : todo.length ? `Tóm tắt ${todo.length} nhóm` : "Không có tin mới"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
        {list.isPending && (
          <div className="grid gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        )}
        {list.isError && (
          <p role="alert" className="flex items-center gap-2 text-sm text-error">
            {errorText(list.error)}
            <Button size="xs" variant="outline" onClick={() => void list.refetch()}><RotateCw /> Thử lại</Button>
          </p>
        )}
        {list.data && !allowed.length && (
          <p className="max-w-prose text-sm leading-relaxed text-ink-3">
            Chưa nhóm nào cho phép AI đọc. Mở một nhóm → <b className="font-semibold text-ink-2">Tóm tắt</b> → <b className="font-semibold text-ink-2">Cho phép</b>, rồi nhóm đó sẽ có mặt ở đây.
          </p>
        )}
        {offline && <p className="mb-4 text-sm text-warn">Không kiểm tra được tin mới; Telegram có thể chưa kết nối.</p>}

        {asks.length > 0 && (
          <section className="mb-6 grid gap-2 rounded-[var(--radius-card)] bg-hl-wash/40 p-3 md:p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-hl-2">
              Cần confirm <span className="font-mono font-normal">{asks.length}</span>
            </h3>
            <ul className="grid gap-1.5">
              {asks.map((a, n) => (
                <li key={n} className="text-sm leading-relaxed">
                  <span className="text-ink">{a.text}</span>
                  {a.who && <span className="text-ink-3"> — hỏi {a.who}</span>}
                  <span className="text-ink-3"> · </span>
                  <button type="button" className="text-xs text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => onOpenDigest(a.chat.chat_id)}>
                    {a.chat.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

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
                      <Result r={i.saved.result} when={i.saved.created_at} lit={null} onJump={() => onOpenDigest(i.chat_id)}
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
      </div>
    </section>
  );
}
