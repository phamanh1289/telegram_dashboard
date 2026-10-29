"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AiPanel } from "@/components/ai-panel";
import { ChatList } from "@/components/chat-list";
import { Composer, type DraftInjection } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Unlock } from "@/components/unlock";
import { type StreamState, useSync } from "@/hooks/use-events";
import { api, isAuthError, type Message, type Status } from "@/lib/api";

const STATE_LABEL: Record<Status["state"], string> = {
  setup_required: "Chưa cấu hình Telegram (TELEGRAM_API_ID/HASH)",
  login_required: "Cần đăng nhập: uv run python -m telegram_dashboard login",
  connecting: "Đang kết nối Telegram…",
  connected: "Đã kết nối Telegram",
  degraded: "Mất kết nối, đang thử lại",
  stopped: "Đã dừng",
};

const STREAM_LABEL: Record<StreamState, string> = {
  open: "Cập nhật trực tiếp",
  connecting: "Đang nối lại luồng cập nhật…",
  closed: "Luồng cập nhật tạm dừng",
};

export function App() {
  const status = useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api<Status>("/status", { signal }),
    retry: (n, e) => n < 1 && !isAuthError(e),
  });
  const qc = useQueryClient();

  if (status.isPending) {
    return (
      <main className="grid min-h-dvh place-items-center p-4">
        <Skeleton className="h-10 w-64" />
      </main>
    );
  }
  if (isAuthError(status.error)) {
    return <Unlock onUnlocked={() => void qc.resetQueries()} />;
  }
  if (!status.data) {
    return (
      <main className="grid min-h-dvh place-items-center gap-2 p-4 text-sm">
        <p>Không liên lạc được backend local (127.0.0.1:8765).</p>
        <Button size="sm" onClick={() => void status.refetch()}>Thử lại</Button>
      </main>
    );
  }
  return <Inbox status={status.data} />;
}

function Inbox({ status }: { status: Status }) {
  const qc = useQueryClient();
  const stream = useSync(status.cursor);
  const [chatId, setChatId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Map<string, Message>>(new Map());
  const [draft, setDraft] = useState<DraftInjection | null>(null);
  const [showAi, setShowAi] = useState(false);

  // Selected chat lives in the query string (static export: no dynamic routes).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read URL once after mount
    setChatId(new URLSearchParams(location.search).get("chat"));
  }, []);

  function selectChat(id: string | null) {
    setChatId(id);
    setReplyTo(null);
    setSelected(new Map());
    setDraft(null);
    const url = new URL(location.href);
    if (id) url.searchParams.set("chat", id);
    else url.searchParams.delete("chat");
    history.replaceState(null, "", url);
  }

  async function logout() {
    await api("/logout", { method: "POST" }).catch(() => undefined);
    qc.clear();
    await qc.resetQueries({ queryKey: ["status"] });
  }

  const connected = status.state === "connected";

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr]">
      <header className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-xs">
        <h1 className="text-sm font-semibold">Telegram Dashboard</h1>
        <span data-testid="tg-state" className={connected ? "text-emerald-600" : "text-amber-600"}>
          {STATE_LABEL[status.state]}
        </span>
        <span data-testid="stream-state" className="text-muted-foreground">{STREAM_LABEL[stream]}</span>
        <div className="ml-auto flex gap-2">
          <Button size="xs" variant="outline" onClick={() => setShowAi((s) => !s)} aria-expanded={showAi}>
            AI
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void logout()}>Khóa</Button>
        </div>
      </header>
      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[16rem_1fr] lg:grid-cols-[16rem_1fr_auto]">
        <div className="min-h-0 border-r">
          <ChatList selected={chatId} onSelect={selectChat} connected={connected} />
        </div>
        {chatId ? (
          <div key={chatId} className="grid min-h-0 grid-rows-[1fr_auto]">
            <MessageList
              chatId={chatId}
              replyTo={replyTo?.message_id ?? null}
              onReply={setReplyTo}
              selected={selected}
              onToggle={(m) =>
                setSelected((prev) => {
                  const next = new Map(prev);
                  if (next.has(m.message_id)) next.delete(m.message_id);
                  else next.set(m.message_id, m);
                  return next;
                })
              }
            />
            <Composer chatId={chatId} replyTo={replyTo} onClearReply={() => setReplyTo(null)} draft={draft} />
          </div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Chọn một nhóm để xem tin nhắn.</p>
        )}
        {showAi && chatId && (
          <div className="min-h-0 border-l lg:w-80">
            <AiPanel
              chatId={chatId}
              selected={[...selected.values()]}
              aiConfigured={status.ai_configured}
              onClear={() => setSelected(new Map())}
              onUseDraft={(r) => setDraft({ result: r, chatId, nonce: Date.now() })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
