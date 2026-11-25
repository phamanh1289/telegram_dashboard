import { useEffect } from "react";
import { readDone, setDone } from "@/features/telegram/lib/follow";
import { api, ApiError, type BeReply, type DigestItem, type DigestResult, errorText } from "@/shared/lib/api";
import { type Key, t as tr } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { isString, put, readList } from "@/shared/lib/prefs";
import { dayLabel } from "@/shared/lib/time";

// A group's digest as data: its sections, which items are still open (ticked / replied to), the queries behind that and
// the Markdown copy. Shared by a group's Tóm tắt, Briefing, Hôm nay and the Briefing batch (components/briefing/run).

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
export const SECTIONS = [
  ["confirmations", "Cần confirm"],
  ["decisions", "Đã chốt"],
  ["changes", "Thay đổi"],
  ["impacts", "Ảnh hưởng team"],
  ["actions", "Việc cần làm"],
] as const;
export const STATUS: Record<string, [Key, string]> = {
  decided: ["Đã chốt", "bg-ok-wash text-ok"],
  open: ["Đang bàn", "bg-warn-wash text-warn"],
  dropped: ["Bỏ ngỏ", "bg-paper-3 text-ink-3"],
};

// Handled marks (lib/follow: kept on the server), refs only (chat, kind, message ids; a hash when an item cites none):
// never the text. Shared by Briefing (where you tick them) and a group's Tóm tắt (whose "Với BE" view leaves them out).
const OPEN = ["confirmations", "actions"] as const;
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36);
export const todoKey = (chat: string, kind: string, it: Pick<DigestItem, "message_ids" | "text">) => `${chat}:${kind}:${it.message_ids?.length ? it.message_ids.join(",") : hash(it.text)}`;

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

/** Closes what code checks settled (`closedBy`), each once (`autoDone`): one toast for all of it, with Undo. */
export function useAutoDone(settled: { mark: string; keys: string[]; why: Key }[]) {
  const sig = settled.map((a) => a.mark).join("|");
  useEffect(() => {
    const ran = settled.filter((a) => autoDone(a.mark, a.keys));
    const keys = ran.flatMap((a) => a.keys);
    const why = [...new Set(ran.map((a) => tr(a.why)))].join(" / ");
    if (keys.length) toast({ text: tr("Đóng {n} mục: {why}", { n: keys.length, why }), action: { label: tr("Hoàn tác"), run: () => setDone(keys, false) } });
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- `settled` is new each render; `sig` names it
}

/** chat_id -> digest-cited message ids I have replied to on Telegram: those items tick themselves off. */
export const answeredQuery = {
  queryKey: ["briefing-answered"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<Record<string, string[]>>("/briefing/answered", { signal }),
  staleTime: 60_000,
};

/** chat_id -> replies from others to questions still open with BE, newer than the digest (Với BE: "vừa trả lời");
 *  `failed`: groups not read (offline, an error), shown as "không đọc được", not "Chờ trả lời". */
export const beRepliesQuery = {
  queryKey: ["briefing-be-replies"],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    api<{ replies?: Record<string, BeReply[]>; failed?: string[] }>("/briefing/be-replies", { signal }),
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

/** A chat's open items I have closed, and decisions / changes I ticked or put in the story (the server keeps those naming
 *  a ticket until then), as their joined message ids: the next digest drops them instead of carrying them on. */
export function closedIds(chat: string, r: DigestResult | undefined, answered?: Record<string, string[]>) {
  const done = readDone();
  return ([...OPEN, "decisions", "changes"] as const).flatMap((k) => (r?.[k] ?? []).filter((it) => it.message_ids?.length && isClosedItem(chat, k, it, done, answered)))
    .map((it) => it.message_ids!.join(","));
}

/** Impacts grouped by team, in first-seen order. */
export function byTeam(list: DigestItem[]): [string, DigestItem[]][] {
  const out = new Map<string, DigestItem[]>();
  for (const it of list) out.set(it.who || tr("Khác"), [...(out.get(it.who || tr("Khác")) ?? []), it]);
  return [...out];
}

export function meta(key: string, it: DigestItem) {
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
      const since = it.carried && it.at ? tr(key === "decisions" || key === "changes" ? "chưa vào story từ {day}" : "còn mở từ {day}", { day: dayLabel(it.at).toLowerCase() }) : "";
      const flags = `${it.be ? "[BE] " : ""}${since ? `[${since}] ` : ""}`;
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

/** A decision's comment on the ticket it names (RecordOn), the same from a group's digest and from Briefing. */
export const recordText = (it: DigestItem, title?: string) => `Đã chốt trên Telegram${title ? ` (${title})` : ""}: ${it.text}${it.who ? ` — ${it.who}` : ""}`;
