"use client";

import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type AiPermissionResponse, type AiResult, type Message } from "@/lib/api";

const ERRORS: Record<string, string> = {
  ai_not_configured: "AI chưa được cấu hình (AI_BASE_URL/AI_MODEL/AI_API_KEY ở backend).",
  ai_scope_not_allowed: "Có tin chưa được cấp quyền dùng AI. Cấp quyền cho các tin đã chọn ở form bên dưới rồi thử lại (tin media hoặc đã xóa không dùng được).",
  ai_context_too_large: "Ngữ cảnh quá lớn. Chọn ít tin hơn (tối đa 30 tin, 16.000 ký tự).",
  ai_permission_changed: "Quyền đã đổi trong lúc xử lý nên kết quả bị bỏ. Dữ liệu đã gửi provider không thu hồi được.",
  ai_timeout: "Provider quá thời gian. Bạn vẫn có thể trả lời thủ công.",
  ai_provider_error: "Provider lỗi. Bạn vẫn có thể trả lời thủ công.",
};

const errText = (e: unknown) =>
  e instanceof ApiError ? (ERRORS[e.code] ?? `Lỗi: ${e.code}`) : "Không liên lạc được máy chủ local.";

export function AiPanel({
  chatId,
  selected,
  aiConfigured,
  requireConsent,
  onUseDraft,
  onClear,
  onClose,
}: {
  chatId: string;
  selected: Message[];
  aiConfigured: boolean;
  requireConsent: boolean;
  onUseDraft: (r: AiResult) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<{ kind: "draft" | "summary"; r: AiResult } | null>(null);
  const [showGrant, setShowGrant] = useState(false);
  const ids = selected.map((m) => m.message_id);

  const run = useMutation({
    mutationFn: (kind: "draft" | "summary") =>
      api<AiResult>(`/ai/${kind}`, {
        method: "POST",
        json: kind === "draft" ? { chat_id: chatId, message_ids: ids, instruction } : { chat_id: chatId, message_ids: ids },
      }).then((r) => ({ kind, r })),
    retry: false,
    networkMode: "always",
    onMutate: () => setResult(null),
    onSuccess: setResult,
    onError: (e) => {
      if (requireConsent && e instanceof ApiError && e.code === "ai_scope_not_allowed") setShowGrant(true);
    },
  });

  return (
    <aside aria-label="Trợ lý AI" className="no-scrollbar flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Trợ lý AI</h2>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Đóng"><X /></Button>
      </div>
      {!aiConfigured && <p className="text-xs text-muted-foreground">{ERRORS.ai_not_configured}</p>}
      <p className="text-xs text-muted-foreground">
        Tick các tin trong khung chat (tối đa 30) rồi nhờ AI soạn nháp hoặc tóm tắt. AI chỉ trả văn bản, không tự gửi.
      </p>
      <p className="text-xs font-medium">
        Đã chọn {selected.length}/30 tin.{" "}
        {selected.length > 0 && (
          <Button size="xs" variant="link" onClick={onClear}>Bỏ chọn</Button>
        )}
      </p>
      <Textarea
        aria-label="Yêu cầu cho bản nháp"
        placeholder="Ví dụ: trả lời ngắn gọn, lịch sự"
        maxLength={2000}
        rows={2}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!aiConfigured || !ids.length || run.isPending} onClick={() => run.mutate("draft")}>
          Soạn nháp
        </Button>
        <Button size="sm" variant="outline" disabled={!aiConfigured || !ids.length || run.isPending}
          onClick={() => run.mutate("summary")}>
          Tóm tắt
        </Button>
        {requireConsent && (
          <Button size="sm" variant="ghost" disabled={!ids.length} onClick={() => setShowGrant((s) => !s)}
            aria-expanded={showGrant}>
            Quyền dữ liệu
          </Button>
        )}
      </div>
      {run.isPending && <p className="animate-pulse text-xs text-muted-foreground">Đang xử lý…</p>}
      {run.isError && (
        <p role="alert" className="text-xs text-destructive">
          {!requireConsent && run.error instanceof ApiError && run.error.code === "ai_scope_not_allowed"
            ? "Có tin là media hoặc đã bị xóa, AI chỉ đọc được tin chữ. Bỏ chọn các tin đó rồi thử lại."
            : errText(run.error)}
        </p>
      )}
      <AnimatePresence initial={false}>
        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="grid gap-2 rounded-md border p-2"
          >
            <p className="whitespace-pre-wrap text-sm">{result.r.text}</p>
            {result.kind === "draft" && (
              <Button size="sm" onClick={() => onUseDraft(result.r)}>Đưa vào khung soạn</Button>
            )}
          </motion.div>
        )}
        {requireConsent && showGrant && (
          <motion.div
            key="grant"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <GrantForm chatId={chatId} selected={selected} />
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

function GrantForm({ chatId, selected }: { chatId: string; selected: Message[] }) {
  const senders = [...new Set(selected.map((m) => m.sender_id).filter((s): s is string => !!s))];
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [days, setDays] = useState(7);
  const [scope, setScope] = useState({ draft: true, summary: true });

  const save = useMutation({
    mutationFn: (revoke: boolean) =>
      api<AiPermissionResponse>(`/chats/${encodeURIComponent(chatId)}/ai-permission`, {
        method: "PUT",
        json: revoke
          ? { revoke_message_ids: selected.map((m) => m.message_id) }
          : {
              grants: selected.map((m) => ({
                message_id: m.message_id,
                scope: Object.entries(scope).filter(([, v]) => v).map(([k]) => k).join(","),
                expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
                participants: Object.fromEntries(
                  senders.filter((s) => evidence[s]?.trim()).map((s) => [s, evidence[s].trim()]),
                ),
              })),
            },
      }),
    retry: false,
    networkMode: "always",
  });

  return (
    <form
      className="grid gap-2 rounded-md border p-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(false);
      }}
    >
      <p>
        Nhập tham chiếu bằng chứng đồng ý cho từng người gửi. Thiếu người nào thì tin của họ bị từ chối.
        Tin media không được cấp quyền ở bản này.
      </p>
      {senders.map((s) => (
        <label key={s} className="grid gap-1">
          <span>
            Người gửi {selected.find((m) => m.sender_id === s)?.sender_name ?? ""} ({s})
          </span>
          <Input value={evidence[s] ?? ""} onChange={(e) => setEvidence({ ...evidence, [s]: e.target.value })}
            placeholder="Tham chiếu bằng chứng" />
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {(["draft", "summary"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input type="checkbox" checked={scope[k]} onChange={(e) => setScope({ ...scope, [k]: e.target.checked })} />
            {k === "draft" ? "Soạn nháp" : "Tóm tắt"}
          </label>
        ))}
        <label className="flex items-center gap-1">
          Hiệu lực
          <Input type="number" min={1} max={90} value={days} className="h-7 w-16"
            onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} />
          ngày
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="xs" disabled={save.isPending || (!scope.draft && !scope.summary)}>Cấp quyền</Button>
        <Button type="button" size="xs" variant="outline" disabled={save.isPending} onClick={() => save.mutate(true)}>
          Thu hồi
        </Button>
      </div>
      {save.data && (
        <p role="status">
          Cấp: {save.data.granted.length}, thu hồi: {save.data.revoked.length}
          {Object.keys(save.data.rejected).length > 0 &&
            `, từ chối: ${Object.entries(save.data.rejected).map(([id, why]) => `#${id} (${why})`).join(", ")}`}
        </p>
      )}
      {save.isError && <p role="alert" className="text-destructive">{errText(save.error)}</p>}
    </form>
  );
}
