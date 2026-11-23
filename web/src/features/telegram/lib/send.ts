import { ApiError } from "@/shared/lib/api";
import { type Key, t as tNow } from "@/shared/lib/i18n";

// What a send to a group can come back with, and how every sender (reply panel, Cập nhật story, AI Agent asks, Q&A)
// tells "not sent" from "maybe sent". Kept out of composer.tsx: its importers only need this.

const SEND_ERROR_KEYS: Record<string, Key> = {
  not_tracking: "Nhóm không còn được theo dõi.",
  reply_not_found: "Tin đích không còn hoặc không thuộc nhóm này.",
  not_connected: "Chưa kết nối Telegram. Bản nháp vẫn được giữ.",
  forbidden: "Không có quyền gửi trong nhóm này.",
  request_payload_mismatch: "Nội dung đã đổi so với yêu cầu đang chờ.",
  retry_after: "Telegram yêu cầu chờ trước khi gửi tiếp.",
};
/** Send error texts, in the language at lookup time (for `errorText`). */
export const SEND_ERRORS: Record<string, string> = new Proxy(SEND_ERROR_KEYS, {
  get: (o, k) => (typeof k === "string" && k in o ? tNow(o[k]) : undefined),
});

/** The send's outcome is not known, so the message may be in the group: no answer from the local server (or one it
 *  could not word: a crash mid-send), or it lost Telegram midway. Never "failed", never sent again on its own. Any
 *  other coded answer is a rejection: certainly not sent. `retryUnknown`: this was a retry of such a send; "not
 *  connected" then sent nothing new, but the first attempt is still unknown. */
export const sendLost = (e: unknown, retryUnknown = false) =>
  !(e instanceof ApiError) || e.code === "delivery_unknown" || e.code === "http_error" || (retryUnknown && e.code === "not_connected");

export const sendLostText = () => tNow("Chưa rõ Telegram đã nhận tin hay chưa: xem nhóm trước khi gửi lại.");

/** Telegram's limit for one message, in UTF-16 code units (== a JS string's length). */
export const SEND_MAX = 4096;
/** Something to send that fits one message. */
export const fitsSend = (body: string) => body.trim().length > 0 && body.length <= SEND_MAX;
