import type { components } from "./api.generated";
import { t, tMaybe } from "@/shared/lib/i18n";

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
export type DataStats = S["DataStats"];
export type PendingItem = S["PendingItem"];
export type Follow = S["Follow"];
export type FollowWait = S["FollowWait"];
export type FollowChange = S["FollowChange"];
export type WaitReplies = S["WaitReplies"];
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
export type AiResetResult = S["AiResetResult"];
export type AiRun = S["AiRun"];
export type DigestConsent = S["DigestConsent"];
export type DigestResult = S["DigestResult"];
export type DigestItem = S["DigestItem"];
export type BeReply = S["BeReply"];
export type DigestTopic = S["DigestTopic"];
export type HistoryPage = S["HistoryPage"];
export type BriefingItem = S["BriefingItem"];
export type QaItem = S["QaItem"];
export type QaList = S["QaList"];
export type QaPosted = S["QaPosted"];
export type SavedDigest = S["SavedDigest"];
export type GroupInfo = S["GroupInfo"];
export type Member = S["Member"];
export type LoopItem = S["LoopItem"];
export type LoopBack = S["LoopBack"];

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
    headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
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

/** A working step of an AI run that reads code: a tool call ("<name>  <input>") or its output; `at` in seconds. */
export type AiStep = { kind: "tool" | "tool_result"; text: string; error?: boolean; at?: number };

/** NDJSON lines of an AI answer as Claude writes it: `onPart` gets the text so far, `onStep` each working step, the
 *  result comes last. */
export async function readAnswer<T>(res: Response, onPart?: (text: string) => void, onStep?: (step: AiStep) => void, onCursor?: (cursor: number) => void): Promise<T> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "", text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw Object.assign(new ApiError(502, "ai_provider_error"), { cut: true }); // the server always ends with done / error: the connection was cut
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines.filter(Boolean)) {
      const m = JSON.parse(line);
      if (typeof m.cursor === "number") onCursor?.(m.cursor);
      if ("done" in m) return m.done as T;
      if ("error" in m) throw new ApiError(m.error.status, m.error.code, null, m.error.detail);
      if ("step" in m) { onStep?.(m.step); continue; }
      text = m.reset ? "" : text + m.delta;
      onPart?.(text);
    }
  }
}

/** POST to an AI route that streams its answer (see `readAnswer`); `json` undefined: GET it (a background run read
 *  again, /ai/job/{id}). `job`: run it in the background under that id (header X-Ai-Job), the page may leave. */
export async function apiStream<T>(path: string, json: unknown, signal?: AbortSignal, onPart?: (text: string) => void, job?: string): Promise<T> {
  return readAnswer<T>(await openStream(path, json, signal, job), onPart);
}

/** Starts a background AI run (its own job id) and returns once the server took it; the answer is read elsewhere
 *  (a saved session's log). */
export async function apiStart(path: string, json: unknown): Promise<void> {
  const ctl = new AbortController();
  await openStream(path, json, ctl.signal, crypto.randomUUID());
  ctl.abort(); // a job outlives its reader
}

async function openStream(path: string, json: unknown, signal?: AbortSignal, job?: string) {
  const res = await fetch(`/api${path}`, json === undefined
    ? { credentials: "same-origin", cache: "no-store", signal }
    : { method: "POST", credentials: "same-origin", cache: "no-store", signal, body: JSON.stringify(json),
        headers: { "Content-Type": "application/json", ...(job ? { "X-Ai-Job": job } : {}) } });
  if (!res.ok) {
    const e = (await res.json().catch(() => null))?.error;
    throw new ApiError(res.status, e?.code ?? (res.status === 422 ? "validation" : "http_error"), e?.retry_after ?? null, e?.detail ?? null);
  }
  return res;
}

/** Codes any call may answer, worded once (in the current UI language); a caller's `map` wins over these. */
const COMMON: Record<string, (e: ApiError) => string> = {
  flood_wait: (e) => (e.retryAfter ? t("Telegram yêu cầu chờ {n} giây rồi thử lại. ", { n: e.retryAfter }) : t("Telegram yêu cầu chờ rồi thử lại. ")),
  claude_cli_timeout: () => t("Lệnh claude không trả lời sau 15 giây (có thể đang chờ mở khóa Keychain), thử lại. "),
  claude_login_failed: () => t("Lệnh đăng nhập claude dừng ngay. "),
  ai_login_failed: () => t("Lệnh đăng nhập dừng ngay. "),
  auth_required: () => t("Trình duyệt này chưa được mở khóa: mở lại app bằng Start Dashboard. "),
  delivery_unknown: () => t("Chưa rõ đã gửi chưa (mất kết nối giữa chừng). Xem nhóm trước khi gửi lại. "),
  telegram_error: (e) => (e.detail ? t("Telegram báo lỗi ({detail}), thử lại sau. ", { detail: e.detail }) : t("Telegram báo lỗi, thử lại sau. ")),
  task_cancelled: () => t("Phiên đã bị dừng khi đang khởi động. "),
  project_forbidden: () => t("Không dùng được thư mục này làm dự án: đó là thư mục của chính app, thư mục chứa app, thư mục nhà hoặc dữ liệu của app. Chọn thư mục code của dự án. "),
  ai_scope_not_allowed: () => t("Tin này không còn được theo dõi hoặc đã bị xóa. "),
  not_connected: () => t("Telegram chưa kết nối. "),
  ai_not_configured: () => t("AI đang chọn chưa cài hoặc chưa đăng nhập, xem Cài đặt › AI."),
  ai_timeout: () => t("AI phản hồi quá lâu; thử lại. "),
  ai_provider_error: (e) => (aiOffline(e) ? t("AI không kết nối được máy chủ (mạng / VPN?), thử lại. ") : t("AI gặp lỗi; thử lại.")),
  ai_cli_missing: () => t("Chưa cài lệnh của AI này, xem Cài đặt › AI. "),
  ai_cli_unavailable: () => t("Lệnh của AI không trả lời, thử lại. "),
  claude_cli_unavailable: () => t("Lệnh claude không trả lời, thử lại. "),
  ai_logout_unsupported: () => t("AI này không đăng xuất được từ dashboard. "),
  terminal_failed: () => t("Không mở được Terminal. "),
  youtrack_unauthorized: () => t("Token YouTrack hết hạn hoặc thiếu quyền, xem Cài đặt › YouTrack."),
  youtrack_unreachable: () => t("Không kết nối được YouTrack (mạng chặn? bật VPN), thử lại sau. "),
  youtrack_unknown: () => t("Không rõ YouTrack đã ghi chưa — mở lại ticket để kiểm tra trước khi làm lại"),
  youtrack_error: () => t("YouTrack báo lỗi, thử lại sau. "),
  youtrack_not_configured: () => t("Chưa có token YouTrack — dán token trong Cài đặt"),
  unknown_chat: () => t("Không tìm thấy nhóm này (có thể đã bỏ theo dõi). "),
  chat_migrated: () => t("Nhóm đã chuyển thành supergroup: mở lại nhóm mới. "),
  photo_not_available: () => t("Không còn ảnh của tin này. "),
  picker_failed: () => t("Không mở được hộp chọn thư mục. "),
  reveal_failed: () => t("Không mở được Finder. "),
  data_clear_failed: () => t("Không xóa được dữ liệu, thử lại. "),
  task_not_found: () => t("Phiên này không còn (đã xóa). "),
  terminal_task_unsupported: () => t("Phiên Terminal cũ chỉ còn để xem. "),
  rule_value_empty: () => t("Nhập giá trị cho luật. "),
  request_not_found: () => t("Không tìm thấy lượt gửi này. "),
  guide_session_gone: () => t("AI đã đổi, hỏi lại từ đầu. "),
  mascot_gone: () => t("Lượt vẽ này không còn, vẽ lại. "),
};
// An AI CLI that could not reach its server (no network, VPN, proxy down), in its own words.
const AI_OFFLINE = /connection error|network|econn|etimedout|enotfound|eai_again|socket hang up|fetch failed|getaddrinfo/i;
const aiOffline = (e: ApiError) => AI_OFFLINE.test(e.detail ?? "");

/** The local dashboard did not answer at all (stopped, restarting): fetch's TypeError, not an abort. */
export const isOffline = (e: unknown) => e instanceof TypeError || (e instanceof Error && e.name === "TypeError");
export const OFFLINE_TEXT = () => t("Không liên lạc được dashboard local. Kiểm tra app còn chạy rồi thử lại.");

/** Newer versions on GitHub (the server checks hourly) and the running one; the shell's badge and Liên hệ share it. */
export const updateStateQuery = {
  queryKey: ["update-state"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<{ version: string; behind: number; pending?: string }>("/update/state", { signal }), // pending: installed, awaiting a restart
};

/** The backend's status (Telegram, AI, YouTrack); one cache shared by the shell, Settings and the Digest actions. */
export const statusQuery = {
  queryKey: ["status"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<Status>("/status", { signal }),
};

/** Codes whose `detail` is the CLI's own words (or YouTrack's: why it refused a new ticket, or that it may have been
 *  created), worth showing after ours. */
const WITH_DETAIL = new Set(["ai_provider_error", "task_launch_failed", "claude_login_failed", "ai_login_failed", "youtrack_error"]);

/** The message for an error's code; an AI run's failure also gets the CLI's own reason (`detail`). */
export function errorText(e: unknown, map: Record<string, string>, fallback = t("Có lỗi xảy ra.")) {
  const text = (e instanceof ApiError && (map[e.code] || COMMON[e.code]?.(e))) || (isOffline(e) ? OFFLINE_TEXT() : fallback);
  const out = e instanceof ApiError && WITH_DETAIL.has(e.code) && e.detail && !(e.code === "ai_provider_error" && aiOffline(e))
    ? `${text.trimEnd()} (${tMaybe(e.detail)}) ` : text;
  lastFailure = reportable(e) ? { text: out, at: Date.now(), failure: failureOf(e) } : null;
  return out;
}

/** What a bug report needs about one failed call (Liên hệ, from a toast's "Báo lỗi"). */
export type Failure = { code: string; status: number | null; detail: string | null };
// Errors the user can act on themselves (wait, reconnect, check the group, fix the input) are not bugs to report.
const EXPECTED = new Set(["flood_wait", "delivery_unknown", "not_connected", "auth_required", "validation", "task_cancelled"]);
const reportable = (e: unknown) =>
  e instanceof ApiError ? (e.status >= 500 || e.code === "http_error") && !EXPECTED.has(e.code)
    : !(e instanceof TypeError || (e instanceof Error && e.name === "AbortError")); // fetch's TypeError: the server is down, Liên hệ can't send either
const failureOf = (e: unknown): Failure =>
  e instanceof ApiError ? { code: e.code, status: e.status, detail: e.detail } : { code: e instanceof Error ? e.name : "error", status: null, detail: e instanceof Error ? e.message : String(e) };
let lastFailure: { text: string; at: number; failure: Failure } | null = null;
/** The failure behind a message errorText just wrote (toast() attaches it, so every error toast offers "Báo lỗi"
 *  without each caller passing the error along); null for other text or an error the user can fix themselves. */
export const failureFor = (text: string) => (lastFailure && lastFailure.text === text && Date.now() - lastFailure.at < 2000 ? lastFailure.failure : null);
