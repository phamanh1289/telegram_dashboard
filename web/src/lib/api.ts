import type { components } from "./api.generated";

type S = components["schemas"];
export type Message = S["MessageDTO"];
export type Chat = S["ChatDTO"];
export type ChatsResponse = S["ChatsResponse"];
export type MessagesPage = S["MessagesPage"];
export type ChangeItem = S["ChangeItem"];
export type ChangesPage = S["ChangesPage"];
export type Status = S["StatusDTO"];
export type Outbox = S["OutboxDTO"];
export type AiResult = S["AiResult"];
export type Project = S["ProjectDTO"];
export type Task = S["TaskDTO"];
export type PendingItem = S["PendingItem"];
export type Rule = S["RuleDTO"];
export type RuleAdded = S["RuleAdded"];
export type HandledAllResponse = S["HandledAllResponse"];
export type YouTrackIssue = S["YouTrackIssue"];
export type AiTicketDraft = S["AiTicketDraft"];
export type ClaudeAccount = S["ClaudeAccount"];
export type AiPrefs = S["AiPrefs"];
export type AiPicks = S["AiPicks"];
export type AiCatalogEntry = S["AiCatalogEntry"];
export type AiAccount = S["AiAccount"];
export type AiRun = S["AiRun"];
export type DigestConsent = S["DigestConsent"];
export type DigestResult = S["DigestResult"];
export type DigestItem = S["DigestItem"];
export type DigestTopic = S["DigestTopic"];
export type HistoryPage = S["HistoryPage"];
export type BriefingItem = S["BriefingItem"];
export type QaItem = S["QaItem"];
export type QaPosted = S["QaPosted"];
export type SavedDigest = S["SavedDigest"];
export type GroupInfo = S["GroupInfo"];
export type Member = S["Member"];

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter: number | null = null,
    public detail: string | null = null,
  ) {
    super(code);
    // No token cookie (auth.py): the shell shows the unlock screen (components/auth-gate).
    if (code === "auth_required" && typeof window !== "undefined") dispatchEvent(new Event("auth-required"));
  }
}

/** Same-origin JSON call to the local backend. Never caches private responses. */
export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal,
    headers: init.json === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(
      res.status,
      e?.code ?? (res.status === 422 ? "validation" : "http_error"),
      e?.retry_after ?? null,
      e?.detail ?? null,
    );
  }
  return body as T;
}

/** NDJSON lines of an AI answer as Claude writes it: `onPart` gets the text so far, the result comes last. */
export async function readAnswer<T>(res: Response, onPart?: (text: string) => void): Promise<T> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "", text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new ApiError(502, "ai_provider_error");
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines.filter(Boolean)) {
      const m = JSON.parse(line);
      if ("done" in m) return m.done as T;
      if ("error" in m) throw new ApiError(m.error.status, m.error.code, null, m.error.detail);
      text = m.reset ? "" : text + m.delta;
      onPart?.(text);
    }
  }
}

/** POST to an AI route that streams its answer (see `readAnswer`). */
export async function apiStream<T>(path: string, json: unknown, signal?: AbortSignal, onPart?: (text: string) => void): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(json),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null))?.error;
    throw new ApiError(res.status, e?.code ?? (res.status === 422 ? "validation" : "http_error"), e?.retry_after ?? null, e?.detail ?? null);
  }
  return readAnswer<T>(res, onPart);
}

/** Codes any call may answer, worded once; a caller's `map` wins over these. */
const COMMON: Record<string, (e: ApiError) => string> = {
  flood_wait: (e) => `Telegram yêu cầu chờ${e.retryAfter ? ` ${e.retryAfter} giây` : ""} rồi thử lại. `,
  claude_cli_timeout: () => "Lệnh claude không trả lời sau 15 giây (có thể đang chờ mở khóa Keychain), thử lại. ",
  claude_login_failed: () => "Lệnh đăng nhập claude dừng ngay. ",
  ai_login_failed: () => "Lệnh đăng nhập dừng ngay. ",
  auth_required: () => "Trình duyệt này chưa được mở khóa: mở lại app bằng Start Dashboard. ",
  delivery_unknown: () => "Chưa rõ đã gửi chưa (mất kết nối giữa chừng). Xem nhóm trước khi gửi lại. ",
  telegram_error: (e) => `Telegram báo lỗi${e.detail ? ` (${e.detail})` : ""}, thử lại sau. `,
  task_cancelled: () => "Phiên đã bị dừng khi đang khởi động. ",
  ai_scope_not_allowed: () => "Tin này không còn được theo dõi hoặc đã bị xóa. ",
};

/** The backend's status (Telegram, AI, YouTrack); one cache shared by the shell, Settings and the Digest actions. */
export const statusQuery = {
  queryKey: ["status"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<Status>("/status", { signal }),
};

/** Codes whose `detail` is the CLI's own words, worth showing after ours. */
const WITH_DETAIL = new Set(["ai_provider_error", "task_launch_failed", "claude_login_failed", "ai_login_failed"]);

/** The message for an error's code; an AI run's failure also gets the CLI's own reason (`detail`). */
export function errorText(e: unknown, map: Record<string, string>, fallback = "Có lỗi xảy ra.") {
  const text = (e instanceof ApiError && (map[e.code] || COMMON[e.code]?.(e))) || fallback;
  return e instanceof ApiError && WITH_DETAIL.has(e.code) && e.detail ? `${text.trimEnd()} (${e.detail}) ` : text;
}
