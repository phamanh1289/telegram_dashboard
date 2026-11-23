import { keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import type { components } from "@/shared/lib/api.generated";
import { api, apiStream } from "@/shared/lib/api";
import { t } from "@/shared/lib/i18n";
import { getPref, isString, onPrefs, readList, setPref } from "@/shared/lib/prefs";
import { fold } from "@/shared/lib/utils";

// The document library's client (/api/docs): calls, query options, the sync hook, error texts.

type S = components["schemas"];
export type Doc = S["DocDTO"];
export type DocDetail = S["DocDetail"];
export type DocPart = S["DocPart"];
export type DocHit = S["DocHit"];
export type DocMsgHit = S["DocMsgHit"];
export type DocSearch = S["DocSearch"];
export type DocSources = S["DocSources"];
export type DocSourceError = S["DocSourceError"];
export type DocAnswer = S["DocAnswer"];
export type DocCite = S["DocCite"];
export type KbNode = S["KbNode"];
export type DocAiSession = S["DocAiSession"];
export type DocAiTurn = S["DocAiTurn"];
export type DocZeplinScreen = S["DocZeplinScreen"];
/** `kb_cache`: Knowledge Base articles of projects not in the sources (the AI Agent's cache, hidden elsewhere). */
export type DocSource = "youtrack" | "telegram" | "file" | "kb_cache";
/** What the screen shows: `source` "all" omits the param; `doc`: the open document. */
export type DocFilter = { source: "all" | DocSource; ticket: string | null; doc: number | null };

type Params = Record<string, string | number | boolean | null | undefined>;
const qs = (o: Params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const src = (f: DocFilter) => (f.source === "all" ? null : f.source);

export const docs = {
  list: (source?: DocSource | null, ticket?: string | null, signal?: AbortSignal) => api<Doc[]>(`/docs${qs({ source, ticket })}`, { signal }),
  search: (q: string, f: DocFilter, signal?: AbortSignal) =>
    api<DocSearch>(`/docs/search${qs({ q, source: src(f), ticket: f.ticket, doc: f.doc })}`, { signal }),
  detail: (id: number, signal?: AbortSignal) => api<DocDetail>(`/docs/${id}`, { signal }),
  sources: (signal?: AbortSignal) => api<DocSources>("/docs/sources", { signal }),
  setSources: (body: S["DocSourcesBody"]) => api<DocSources>("/docs/sources", { method: "POST", json: body }),
  /** The OS folder picker; undefined = cancelled (204). */
  pickFolder: () => api<DocSources | undefined>("/docs/sources/pick", { method: "POST" }),
  /** One project's Knowledge Base articles with their parents (to pick branches in Nguồn). */
  kbTree: (project: string, signal?: AbortSignal) => api<KbNode[]>(`/docs/kb-tree${qs({ project })}`, { signal }),
  /** Skipped by the server while the last sync is fresh, unless `force`. */
  sync: (force = false) => api<DocSources>(`/docs/sync${qs({ force })}`, { method: "POST" }),
  reveal: (id: number) => api<void>(`/docs/${id}/reveal`, { method: "POST" }),
  /** Drops the Agent's cache (kb_cache); the chosen projects' articles stay. */
  dropCache: () => api<DocSources>("/docs/cache", { method: "DELETE" }),
  /** Hỏi AI over what the search `body.q` shows (or, without it, the parts matching the question's words). Kept in
   *  `body.session`'s history; on an open document a question already answered there comes back saved (`saved_at`). */
  ask: (body: S["DocAskBody"], signal: AbortSignal, onPart: (text: string) => void) => apiStream<DocAnswer>("/docs/ask", body, signal, onPart),
  /** A stored summary still matching the doc comes back at once (`cached`), without an AI run; a new one joins `session`. */
  summary: (id: number, session: string, signal: AbortSignal, onPart: (text: string) => void) =>
    apiStream<S["DocSummary"]>(`/docs/${id}/summary${qs({ session })}`, {}, signal, onPart),
  /** The AI popup's conversations, newest first (`doc`: those on that document). */
  aiSessions: (doc: number | null, signal?: AbortSignal) => api<DocAiSession[]>(`/docs/ai${qs({ doc })}`, { signal }),
  aiTurns: (session: string, signal?: AbortSignal) => api<DocAiTurn[]>(`/docs/ai/${encodeURIComponent(session)}`, { signal }),
  /** The Zeplin screens named `name` (a screen name in a document), read with the zeplin MCP's token. */
  zeplin: (name: string, signal?: AbortSignal) => api<DocZeplinScreen[]>(`/docs/zeplin${qs({ name })}`, { signal }),
  /** Download the article again now; what changed is recorded. */
  kbRefresh: (ref: string) => api<Doc>(`/docs/kb/${encodeURIComponent(ref)}/refresh`, { method: "POST" }),
  /** A kept message's file into the library: added, or the one of the same name updated. */
  addTelegram: (chat_id: string, message_id: string) =>
    api<Doc>("/docs/telegram", { method: "POST", json: { chat_id, message_id: Number(message_id) } }),
  /** Drops a file kept from Telegram (the other sources leave with their folder / project). */
  remove: (id: number) => api<void>(`/docs/${id}`, { method: "DELETE" }),
  aiDelete: (sessions: string[]) =>
    api<void>(`/docs/ai?${sessions.map((s) => `session=${encodeURIComponent(s)}`).join("&")}`, { method: "DELETE" }),
};

/** How a document is named in an AI session's box and read by it (links.py): a KB article by its ID ("VA-A-176", read
 *  fresh from YouTrack), a file on this machine as "#DOC<id>". Dùng tài liệu and "#" both write it. */
export const docRef = (d: Pick<Doc, "id" | "source" | "ref">) => (d.source === "youtrack" ? d.ref : `#DOC${d.id}`);
export const docName = (d: Pick<Doc, "title" | "ref">) => d.title || d.ref;

export const docListQuery = (f: DocFilter) => ({
  queryKey: ["docs", "list", f.source, f.ticket],
  queryFn: ({ signal }: { signal: AbortSignal }) => docs.list(src(f), f.ticket, signal),
});
/** Typing keeps the last results up until the new ones come. */
export const docSearchQuery = (q: string, f: DocFilter) => ({
  queryKey: ["docs", "search", q, f.source, f.ticket, f.doc],
  queryFn: ({ signal }: { signal: AbortSignal }) => docs.search(q, f, signal),
  placeholderData: keepPreviousData,
});
export const docDetailQuery = (id: number) => ({
  queryKey: ["docs", "doc", id],
  queryFn: ({ signal }: { signal: AbortSignal }) => docs.detail(id, signal),
});
/** The AI history: every query under ["docs", "ai"], refreshed after each turn. */
export const docAiQuery = (doc: number | null) => ({
  queryKey: ["docs", "ai", doc],
  queryFn: ({ signal }: { signal: AbortSignal }) => docs.aiSessions(doc, signal),
});
/** Every listed document (no filter): Telegram's chips check KB articles and files against it, one shared query. */
export const allDocsQuery = docListQuery({ source: "all", ticket: null, doc: null });
/** Extensions the library reads (backend docs/extract.py EXTS: change both together). */
export const READABLE = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".docx", ".pdf"]);
export const extOf = (name: string) => (/\.[^.]+$/.exec(name)?.[0] ?? "").toLowerCase();

export const kbTreeQuery = (project: string) => ({
  queryKey: ["docs", "kb-tree", project],
  queryFn: ({ signal }: { signal: AbortSignal }) => docs.kbTree(project, signal),
  staleTime: 60_000,
});
export const docSourcesQuery = {
  queryKey: ["docs", "sources"],
  queryFn: ({ signal }: { signal: AbortSignal }) => docs.sources(signal),
};

/** Sync (force: even when fresh), then refresh everything read from the store. The server never syncs by itself after a
 *  sources change, so saving sources calls this too. A failure stays on the mutation: the screen's banner shows it. */
export function useDocSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) => docs.sync(force),
    onSuccess: (s) => {
      qc.setQueryData(docSourcesQuery.queryKey, s);
      void qc.invalidateQueries({ queryKey: ["docs"] });
    },
  });
}

/** Messages for the API's doc_* codes (errorText map). */
export const docErrors = () => ({
  doc_folder_not_a_directory: t("Thư mục không còn tồn tại."),
  doc_folder_is_root: t("Không chọn được cả ổ đĩa: hãy chọn một thư mục bên trong."),
  doc_bad_project: t("Mã project không hợp lệ."),
  doc_bad_article: t("Mã bài Knowledge Base không hợp lệ."),
  doc_kb_yt_unreachable: t("Không kết nối được YouTrack để tải cây bài."),
  doc_kb_yt_401: t("YouTrack từ chối token: không tải được cây bài."),
  doc_kb_yt_403: t("YouTrack từ chối token: không tải được cây bài."),
  doc_kb_yt_404: t("Không thấy project này trên YouTrack."),
  doc_article_yt_unreachable: t("Không kết nối được YouTrack để tải lại bài."),
  doc_article_yt_401: t("YouTrack từ chối token: không tải lại được bài."),
  doc_article_yt_403: t("YouTrack từ chối token: không tải lại được bài."),
  doc_article_yt_404: t("YouTrack không trả bài này (đã xóa, hoặc bạn không có quyền đọc)."),
  doc_bad_folder: t("Đường dẫn thư mục không hợp lệ."),
  doc_not_found: t("Tài liệu không còn trong kho: bấm đồng bộ lại."),
  doc_not_a_file: t("Tài liệu này không phải file trên máy."),
  doc_unreadable: t("Không đọc được file (đã bị xóa hoặc đổi chỗ?)."),
  doc_outside: t("File không còn nằm trong thư mục đã chọn."),
  doc_bad_docx: t("Không đọc được nội dung file này."),
  doc_not_text: t("Không đọc được nội dung file này."),
  doc_unsupported: t("Tài liệu chưa đọc được loại file này."),
  doc_bad_pdf: t("Không đọc được file PDF này (hỏng hoặc có mật khẩu)."),
  doc_pdf_no_text: t("PDF này không có chữ (bản scan), Tài liệu chưa đọc được."),
  doc_too_big: t("File quá lớn (tối đa 20 MB)."),
  doc_tg_no_file: t("Tin không còn file đính kèm (đã xóa?)."),
  doc_tg_offline: t("Chưa kết nối Telegram, thử lại sau."),
  doc_not_saved: t("Không lưu được vào kho tài liệu, thử lại."),
  doc_not_removable: t("Chỉ gỡ được file thêm từ Telegram."),
  doc_not_removed: t("Không gỡ được file, thử lại."),
  doc_cache_clear_failed: t("Không xóa được bài KB ngoài nguồn, thử lại."),
  doc_no_match: t("Không tìm thấy trong tài liệu"),
  doc_zeplin_no_token: t("Chưa cấu hình Zeplin MCP (cần ZEPLIN_ACCESS_TOKEN) nên chưa xem được màn Zeplin."),
  doc_zeplin_token_refused: t("Token Zeplin bị từ chối (hết hạn?): cập nhật ZEPLIN_ACCESS_TOKEN của Zeplin MCP."),
  doc_zeplin_unreachable: t("Không kết nối được Zeplin, thử lại sau."),
  doc_empty_question: t("Gõ câu hỏi trước."),
  ai_not_configured: t("AI chưa cài hoặc chưa đăng nhập, xem Cài đặt › AI."),
});

/** One source's sync failure, in words (codes from docs/sync.py). */
export function syncErrorText(e: DocSourceError) {
  const why = e.code === "yt_unreachable" ? t("không kết nối được YouTrack")
    : e.code === "yt_401" || e.code === "yt_403" ? t("YouTrack từ chối token")
    : e.code === "yt_404" ? t("không thấy trên YouTrack")
    : e.code === "folder_missing" ? t("thư mục không còn")
    : e.code === "too_many_files" ? t("quá nhiều file (tối đa {n})", { n: e.detail })
    : e.code === "outside_folder" ? t("file trỏ ra ngoài thư mục")
    : e.code === "unreadable" ? t("không đọc được")
    : e.code === "bad_pdf" ? t("PDF hỏng hoặc có mật khẩu")
    : e.code === "pdf_no_text" ? t("PDF không có chữ (bản scan)")
    : e.detail ? `${e.code}: ${e.detail}` : e.code;
  return `${e.ref}: ${why}`;
}

/** Highlight ranges of the words of `q` in `text`, matched without accents (the server's snippet rule, parts.py):
 *  [start, end) in UTF-16 units of `text`. */
export function findTerms(text: string, q: string): [number, number][] {
  const words = fold(q).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  let flat = "";
  const pos: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    flat += f;
    for (let k = 0; k < f.length; k++) pos.push(i);
  }
  const out: [number, number][] = [];
  for (const w of words) for (let at = flat.indexOf(w); at >= 0; at = flat.indexOf(w, at + w.length)) out.push([pos[at], pos[at + w.length - 1] + 1]);
  return out;
}

/** Yêu thích: the documents starred in the reader, per browser, as "source:ref" (kept across syncs, a doc's id is not). */
const FAVS = "docsFavs";
const favKey = (d: Pick<Doc, "source" | "ref">) => `${d.source}:${d.ref}`;
const readFavs = () => getPref(FAVS) ?? "[]";
export function useDocFavs() {
  const raw = useSyncExternalStore(onPrefs, readFavs, () => "[]");
  const set = useMemo(() => new Set(readList(FAVS, [], isString)), [raw]); // eslint-disable-line react-hooks/exhaustive-deps -- raw: the stored list changed
  return {
    has: (d: Pick<Doc, "source" | "ref">) => set.has(favKey(d)),
    toggle: (d: Pick<Doc, "source" | "ref">) => {
      const k = favKey(d);
      setPref(FAVS, JSON.stringify(set.has(k) ? [...set].filter((x) => x !== k) : [...set, k]));
    },
  };
}
