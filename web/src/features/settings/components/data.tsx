"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderInput, Trash2 } from "lucide-react";
import { useState } from "react";
import { Card, quietBtn, Row, StatusLine, tMap, waitRestart } from "@/features/settings/components/parts";
import { PurgeChat } from "@/features/telegram/components/purge-chat";
import { clearDrafts } from "@/features/telegram/lib/inbox";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { api, ApiError, type DataStats, errorText } from "@/shared/lib/api";
import { fmtBytes, fmtDay, fmtNum, type Key, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";

type DataItem = DataStats["items"][number];
/** The parts of data/ on disk (local_data.DataPart ids): name and categorical colour. The rest of data/ is "Khác". */
const PARTS: Record<string, [Key, string]> = {
  db: ["Database", "var(--cat-2)"],
  sessions: ["Phiên AI", "var(--cat-4)"],
  media: ["Ảnh tag đã tải", "var(--cat-6)"],
  runs: ["Lịch sử chạy AI", "var(--cat-3)"],
  logs: ["Log server", "var(--cat-5)"],
  login: ["Đăng nhập Telegram", "var(--cat-1)"],
  config: ["Cấu hình", "var(--color-ink-3)"],
};
/** One clear (local_data.Item): its tile, its count unit, and the question's "Sẽ mất" / "Giữ nguyên". `safe`: nothing
 *  is really lost (it comes back on its own). {n} in name / lose: the age cut-off in days. */
type Clear = { name: Key; desc: Key; unit: Key; ask: Key; lose: Key; keep: Key; safe?: boolean };
const CLEARS: Record<string, Clear> = {
  messages: {
    name: "Tin đã xử lý cũ hơn {n} ngày", desc: "Tag đã xong và tin bạn đã trả lời.", unit: "{n} tin", ask: "Xóa tin đã xử lý cũ?",
    lose: "Các tin này biến khỏi Đã xử lý, tìm kiếm và thống kê.",
    keep: "Tin trên Telegram; tin chưa xử lý, tin ghim, tin gắn với phiên AI hoặc Báo lại.",
  },
  digests: {
    name: "Bản tóm tắt Briefing", desc: "Bản tóm tắt gần nhất của mỗi nhóm và mốc đã đọc tới.", unit: "{n} nhóm", ask: "Xóa bản tóm tắt Briefing?",
    lose: "Briefing trống tới lần tóm tắt sau; lần đó đọc lại cả khoảng thời gian, tốn một lượt AI mỗi nhóm.",
    keep: "Quyền cho AI đọc nhóm và cài đặt Briefing.",
  },
  outbox: {
    name: "Lịch sử gửi cũ hơn {n} ngày", desc: "Mã truy vết R-… của tin đã gửi thành công.", unit: "{n} tin", ask: "Xóa lịch sử gửi cũ?",
    lose: "Không tra được mã R-… của các tin này nữa.",
    keep: "Tin trên Telegram; tin đang gửi hoặc gửi lỗi.",
  },
  sessions: {
    name: "Phiên AI đã xong", desc: "AI Agent và Trợ lý AI: lịch sử chat, kết quả, tệp đính kèm.", unit: "{n} phiên", ask: "Xóa các phiên AI đã xong?",
    lose: "Phiên đã xong biến khỏi danh sách AI Agent / Trợ lý AI, kèm lịch sử chat và kết quả.",
    keep: "Phiên đang chạy hoặc chưa xong; code đã sửa trong dự án.",
  },
  media: {
    name: "Ảnh tag đã tải", desc: "Ảnh trong tin tag, tải về khi bạn mở. Ảnh quá 30 ngày tự xóa khi khởi động.", unit: "{n} ảnh", ask: "Xóa ảnh đã tải?",
    lose: "Bản lưu trên máy này của ảnh.", keep: "Ảnh gốc trên Telegram: mở tin là tải lại (cần Telegram đang kết nối).", safe: true,
  },
  runs: {
    name: "Lịch sử chạy AI", desc: "Từng lần chạy AI trong app: model, token, chi phí. Lần chạy quá 90 ngày tự cắt khi khởi động.", unit: "{n} lần chạy", ask: "Xóa lịch sử chạy AI?",
    lose: "Lịch sử và thống kê chi phí ở Cài đặt › AI › Tài khoản đếm lại từ đầu.",
    keep: "Lần chạy ngoài app (Claude Code, Codex): được đọc từ máy.",
  },
  logs: {
    name: "Log server", desc: "Nhật ký dò lỗi của bản chạy từ git. Quá 5 MB tự chuyển thành server.log.1 khi khởi động.", unit: "{n} tệp", ask: "Xóa log server?",
    lose: "Nhật ký các lỗi đã xảy ra.", keep: "App chạy bình thường; log mới vẫn ghi tiếp.",
  },
};
/** What each table of dashboard.sqlite3 holds. */
const TABLES: Record<string, Key> = {
  messages: "Tin tag và tin bạn trả lời", chats: "Nhóm đã theo dõi", outbox: "Tin gửi đi", rules: "Luôn bỏ qua, quy tắc Vòng BE",
  tasks: "Phiên AI", task_refs: "Tin gắn với phiên AI", projects: "Dự án", changes: "Nhật ký thay đổi (tự giữ 50.000 dòng)",
  digest_consents: "Đồng ý gửi nhóm cho Digest", digests: "Bản tóm tắt Briefing", qa_marks: "Q&A đã đóng / gỡ", loop_back: "Báo lại",
  metadata: "Thông tin nội bộ",
};

const dataQuery = { queryKey: ["data"], queryFn: ({ signal }: { signal: AbortSignal }) => api<DataStats>("/data", { signal }) };
const pct = (n: number, of: number) => Math.round((n / Math.max(1, of)) * 100);

/** Cài đặt › Dữ liệu: a dashboard of how big each part of data/ is, then one tile per thing you can clear (its size,
 *  age and whether it comes back), the database by group and by table, and this browser's drafts. */
export function DataGroup() {
  const t = useT();
  const q = useQuery(dataQuery);
  const [asking, setAsking] = useState<DataItem | null>(null);
  const [purging, setPurging] = useState<{ chat_id: string; title: string } | null>(null);
  const d = q.data;
  const drafts = (
    <Card title="Dữ liệu trên trình duyệt này">
      <Row label={t("Nháp trả lời")} desc={t("Chỉ lưu trên máy này; tin đã xử lý tự xóa nháp của nó.")}>
        <Button type="button" size="sm" variant="outline"
          onClick={() => { clearDrafts(); toast({ text: t("Đã xóa nháp trên máy này") }); }}>
          {t("Xóa nháp")}
        </Button>
      </Row>
    </Card>
  );
  if (q.isError) return <>
    <Card title="Dung lượng">
      <Row label={<StatusLine tone="error">{errorText(q.error, {}, t("Không đọc được dung lượng dữ liệu."))}</StatusLine>}>
        <Button type="button" size="sm" variant="outline" onClick={() => q.refetch()}>{t("Thử lại")}</Button>
      </Row>
    </Card>
    {drafts}
  </>;
  if (!d) return <>
    <Skeleton className="h-64 rounded-[var(--radius-card)]" />
    <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-[var(--radius-card)]" />)}</div>
  </>;
  const tiles = (ids: string[]) => ids.flatMap((id) => {
    const it = d.items.find((i) => i.id === id);
    return it ? [<ClearTile key={id} it={it} c={CLEARS[id]} total={d.total} keep={d.keep_days} onAsk={() => setAsking(it)} />] : [];
  });
  const clearable = d.items.filter((i) => CLEARS[i.id]).reduce((a, i) => a + i.bytes, 0);
  return <>
    <DataOverview d={d} clearable={clearable} />

    <DataSection title="Dọn trong database" lead={d.db_free > 0
      ? t("dashboard.sqlite3 {size}, {free} trống chờ thu gọn.", { size: fmtBytes(d.db), free: fmtBytes(d.db_free) })
      : t("dashboard.sqlite3 {size}. Tự thu gọn ngay sau mỗi lần xóa.", { size: fmtBytes(d.db) })}>
      {tiles(["messages", "digests", "outbox"])}
    </DataSection>

    <DataSection title="Dọn tệp trên máy" lead={t("Tệp trong thư mục dữ liệu, ngoài database.")}>
      {tiles(["sessions", "media", "runs", "logs"])}
    </DataSection>

    <Card title="Tin theo nhóm" info="Dung lượng ước tính từ nội dung tin. Xóa ở đây giống ⋯ › Xóa dữ liệu nhóm trên trang nhóm.">
      {d.chats.length === 0 ? <Row label={t("Chưa lưu tin nào.")} /> : <ChatSizes chats={d.chats} onPurge={setPurging} />}
    </Card>

    <Card advanced title="Chi tiết từng bảng" info="Dung lượng từng bảng trong dashboard.sqlite3, đã tính cả chỉ mục.">
      <DataTables tables={d.tables} />
    </Card>

    {drafts}

    {asking && <ClearData it={asking} keep={d.keep_days} onClose={() => setAsking(null)} />}
    {purging && <PurgeChat chatId={purging.chat_id} title={purging.title} onClose={() => setPurging(null)} />}
  </>;
}

/** The dashboard head: the figures that decide a clean-up, then the split of data/ by part. */
function DataOverview({ d, clearable }: { d: DataStats; clearable: number }) {
  const t = useT();
  const [moving, setMoving] = useState(false);
  const known = d.parts.reduce((a, p) => a + p.bytes, 0);
  const parts = [...d.parts.map((p) => ({ id: p.id, bytes: p.bytes, name: PARTS[p.id]?.[0] ?? (p.id as Key), color: PARTS[p.id]?.[1] ?? "var(--color-ink-3)" })),
    { id: "other", bytes: Math.max(0, d.total - known), name: "Khác" as Key, color: "var(--color-rule-2)" }]
    .filter((p) => p.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const sessions = d.parts.find((p) => p.id === "sessions")?.bytes ?? 0;
  const figs: [Key, string, React.ReactNode, boolean?][] = [
    ["Tổng trên máy", fmtBytes(d.total), t("{n} phần", { n: parts.length })],
    ["Dọn được ngay", fmtBytes(clearable), t("{p}% tổng", { p: pct(clearable, d.total) }), true],
    ["Database", fmtBytes(d.db), t("{n} bảng", { n: d.tables.length })],
    ["Phiên AI", fmtBytes(sessions), t("{p}% tổng", { p: pct(sessions, d.total) })],
  ];
  return (
    <Card title="Dung lượng" info="Tự dọn khi khởi động: ảnh tag quá 30 ngày, lịch sử chạy AI quá 90 ngày; log server quá 5 MB chuyển thành server.log.1.">
      <div className="@container grid gap-5 py-3 first:pt-1">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 @2xl:grid-cols-4 @2xl:divide-x @2xl:divide-rule">
          {figs.map(([label, value, sub, hl]) => (
            <div key={label} className="grid content-start gap-0.5 @2xl:px-5 @2xl:first:pl-0">
              <dt className="text-xs text-ink-3">{t(label)}</dt>
              <dd className={cn("font-mono text-2xl font-medium tabular-nums", hl ? "text-hl-2" : "text-ink")}>{value}</dd>
              <dd className="text-xs text-ink-3 tabular-nums">{sub}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-3">
          <div role="img" aria-label={parts.map((p) => `${t(p.name)} ${fmtBytes(p.bytes)}`).join(", ")} className="flex h-3.5 gap-0.5 overflow-hidden rounded-md bg-paper-3">
            {parts.map((p) => <span key={p.id} className="h-full min-w-1" style={{ flexGrow: p.bytes, background: p.color }} />)}
          </div>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2 @lg:grid-cols-2">
            {parts.map((p) => (
              <li key={p.id} className="flex min-w-0 items-center gap-2 text-sm">
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate text-ink-2">{t(p.name)}</span>
                <span className="font-mono text-sm text-ink tabular-nums">{fmtBytes(p.bytes)}</span>
                <span className="w-11 text-right font-mono text-xs text-ink-3 tabular-nums">{pct(p.bytes, d.total)}%</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="grid gap-1 border-t border-rule pt-3 text-xs leading-relaxed text-ink-3">
          <span>{t("Đăng nhập Telegram và Cấu hình không xóa ở đây: đăng xuất ở Cài đặt › Telegram, sửa cấu hình ở từng mục.")}</span>
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="min-w-0 font-mono break-all">{d.dir}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setMoving(true)}><FolderInput />{t("Đổi thư mục")}</Button>
          </span>
          {d.move_error === "failed" && <span role="alert" className="text-error">{t("Lần đổi thư mục vừa rồi không thành: dữ liệu vẫn ở thư mục cũ, chưa mất gì. Xem server.log rồi thử lại.")}</span>}
          {d.move_error === "old_left" && <span role="alert" className="text-warn">{t("Đã chuyển, nhưng chưa xóa hết thư mục cũ (còn đăng nhập Telegram và token trong đó). App thử xóa lại mỗi lần mở; hoặc xóa tay: {dir}", { dir: d.move_old })}</span>}
        </p>
        {moving && <MoveData dir={d.dir} onClose={() => setMoving(false)} />}
      </div>
    </Card>
  );
}

const MOVE_ERRORS: Record<string, Key> = {
  agent_running: "Đang có task AI Agent chạy; đợi xong rồi đổi thư mục.",
  data_move_relative: "Cần đường dẫn tuyệt đối (vd. /Volumes/Data/Radar hoặc D:\\Radar).",
  data_move_same: "Dữ liệu đang ở đúng thư mục này.",
  data_move_inside: "Không đặt trong thư mục dữ liệu hiện tại hay trong thư mục cài app.",
  data_move_used: "Thư mục này đã có data/ chứa tệp: chọn thư mục khác hoặc dọn data/ ở đó trước.",
  data_move_cloud: "Thư mục này được đồng bộ đám mây (iCloud, Dropbox, OneDrive, Google Drive): database sẽ hỏng. Chọn thư mục khác.",
  data_move_bad_data: "Database ở thư mục đó hỏng hoặc do bản app mới hơn tạo: không dùng được.",
  data_move_unwritable: "Không tạo hoặc ghi được vào thư mục này.",
  data_move_full: "Ổ đích không đủ chỗ trống.",
};

/** "Đổi thư mục": where data/ goes. The server plans it, restarts, and moves before opening anything; mounted only while asking. */
function MoveData({ dir, onClose }: { dir: string; onClose: () => void }) {
  const t = useT();
  const [path, setPath] = useState("");
  const [lost, setLost] = useState(false);
  const move = useMutation({
    mutationFn: (adopt: boolean) => api<void>("/data/move", { method: "POST", json: { path, adopt } }),
    retry: false,
    onSuccess: async () => { if (!(await waitRestart())) setLost(true); },
  });
  const restarting = move.isSuccess && !lost;
  // the folder already holds a Radar data/ (a disk another install used): asked, then sent again with adopt
  const adopt = move.error instanceof ApiError && move.error.code === "data_move_has_data";
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(); }} tone="default" icon={FolderInput} title={t("Đổi thư mục dữ liệu")}
      description={t("App khởi động lại để chuyển database, đăng nhập Telegram, phiên AI và cấu hình sang thư mục mới, rồi xóa bản ở thư mục cũ.")}
      confirmLabel={restarting ? t("Đang khởi động lại…") : adopt ? t("Dùng dữ liệu ở đó") : t("Chuyển và khởi động lại")} busy={move.isPending || restarting}
      error={adopt ? undefined : move.isError ? errorText(move.error, tMap(t, MOVE_ERRORS), t("Không đổi được thư mục, thử lại."))
        : lost && t("Server chưa chạy lại sau 1 phút: mở lại app (Start Dashboard) rồi xem lại Cài đặt › Dữ liệu.")}
      onConfirm={() => { if (path.trim()) move.mutate(adopt); }}>
      <div className="grid gap-2">
        <Input aria-label={t("Thư mục mới")} placeholder="/Volumes/Data/Radar" value={path} maxLength={1024} autoFocus spellCheck={false}
          className="font-mono" onChange={(e) => { setPath(e.target.value); if (move.isError) move.reset(); }} />
        {adopt && <p role="alert" className="rounded-lg bg-warn-wash px-3 py-2 text-sm leading-relaxed text-ink">{t("Thư mục này đã có dữ liệu Radar. Dùng nó thì app khởi động lại và chạy trên dữ liệu đó (đăng nhập Telegram, tin, phiên AI ở đó). Dữ liệu đang dùng không bị xóa, vẫn nằm ở thư mục hiện tại; không chép gì sang.")}</p>}
        <p className="text-xs leading-relaxed text-ink-3">{t("Đường dẫn tuyệt đối; app tạo data/ bên trong. Tránh ổ mạng và thư mục Desktop / Documents đang bật đồng bộ iCloud (database dễ hỏng). Ổ ngoài phải gắn sẵn mỗi lần mở app.")}</p>
        <p className="text-xs text-ink-3">{t("Đang ở:")} <span className="font-mono break-all">{dir}</span></p>
      </div>
    </ConfirmDialog>
  );
}

/** A dashboard section: a head outside the cards, then its tiles two to a row when there is room. */
function DataSection({ title, lead, children }: { title: Key; lead: React.ReactNode; children: React.ReactNode }) {
  const t = useT();
  return (
    <section aria-label={t(title)} data-card={title} className="grid scroll-mt-24 gap-3 pt-3">
      <header className="grid gap-0.5">
        <h3 className="text-base font-bold text-ink">{t(title)}</h3>
        <p className="text-xs text-ink-3">{lead}</p>
      </header>
      <div className="@container"><div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">{children}</div></div>
    </section>
  );
}

/** One thing you can clear: how big, how many, since when, its share of the total, whether it comes back, and Xóa. */
function ClearTile({ it, c, total, keep, onAsk }: { it: DataItem; c: Clear; total: number; keep: number; onAsk: () => void }) {
  const t = useT();
  const empty = !it.count;
  const name = t(c.name, { n: keep });
  return (
    <article aria-label={name} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-rule bg-cotton p-4 shadow-stock">
      <header className="grid gap-0.5">
        <h4 className="text-sm font-bold text-ink">{name}</h4>
        <p className="text-xs leading-relaxed text-ink-3">{t(c.desc)}</p>
      </header>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className={cn("font-mono text-2xl font-medium tabular-nums", empty ? "text-ink-3" : "text-ink")}>{empty ? "—" : fmtBytes(it.bytes)}</span>
          {empty ? <span className="text-xs text-ink-3">{t("Không có gì để xóa")}</span> : <>
            <span className="text-xs text-ink-2 tabular-nums">{t(c.unit, { n: fmtNum(it.count) })}</span>
            {it.oldest && <span className="text-xs text-ink-3 tabular-nums">{t("từ {day}", { day: fmtDay(it.oldest) })}</span>}
          </>}
        </div>
        {!empty && <div className="flex items-center gap-2">
          <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-3">
            <span className="block h-full rounded-full bg-hl" style={{ width: `${Math.max(2, pct(it.bytes, total))}%` }} />
          </span>
          <span className="w-16 text-right text-xs text-ink-3 tabular-nums">{t("{p}% tổng", { p: pct(it.bytes, total) })}</span>
        </div>}
      </div>
      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-rule pt-3">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", c.safe ? "bg-ok" : "bg-warn")} />
          {t(c.safe ? "Tải lại được khi cần" : "Không hoàn tác được")}
        </span>
        <Button type="button" size="sm" variant="destructive" disabled={empty} onClick={onAsk} aria-label={t("Xóa: {name}", { name })}>
          <Trash2 aria-hidden />{t("Xóa")}
        </Button>
      </footer>
    </article>
  );
}

/** Groups by stored size: a ranked bar each, and the group's own Xóa dữ liệu nhóm. */
function ChatSizes({ chats, onPurge }: { chats: DataStats["chats"]; onPurge: (c: { chat_id: string; title: string }) => void }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const top = Math.max(1, ...chats.map((c) => c.bytes));
  const sum = chats.reduce((a, c) => a + c.bytes, 0);
  return <>
    {(all ? chats : chats.slice(0, 8)).map((c, i) => (
      <div key={c.chat_id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 first:pt-1">
        <span className="text-right font-mono text-xs text-ink-3 tabular-nums">{i + 1}</span>
        <span className="grid min-w-0 gap-1.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-ink">{c.title}</span>
            <span className="shrink-0 text-xs text-ink-3 tabular-nums">{t("{n} tin", { n: fmtNum(c.rows) })}</span>
          </span>
          <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-paper-3">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (c.bytes / top) * 100)}%`, background: "var(--cat-2)" }} />
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="grid justify-items-end">
            <span className="font-mono text-sm text-ink tabular-nums">≈ {fmtBytes(c.bytes)}</span>
            <span className="text-xs text-ink-3 tabular-nums">{pct(c.bytes, sum)}%</span>
          </span>
          <Hint side="bottom" text={t("Xóa dữ liệu nhóm")}>
            <Button type="button" size="icon-sm" variant="destructive" aria-label={t("Xóa dữ liệu nhóm {title}", { title: c.title })} onClick={() => onPurge(c)}>
              <Trash2 aria-hidden />
            </Button>
          </Hint>
        </span>
      </div>
    ))}
    {chats.length > 8 && (
      <div className="pt-2.5">
        <button type="button" className={quietBtn} onClick={() => setAll(!all)}>{all ? t("Thu gọn") : t("Hiện tất cả {n} nhóm", { n: chats.length })}</button>
      </div>
    )}
  </>;
}

/** dashboard.sqlite3 table by table, biggest first. */
function DataTables({ tables }: { tables: DataStats["tables"] }) {
  const t = useT();
  return (
    <div className="overflow-x-auto py-1">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-3">
          <th className="py-1.5 pr-3 font-medium">{t("Bảng")}</th>
          <th className="py-1.5 pr-3 text-right font-medium">{t("Dòng")}</th>
          <th className="py-1.5 text-right font-medium">{t("Dung lượng")}</th>
        </tr></thead>
        <tbody className="divide-y divide-rule">
          {[...tables].sort((a, b) => b.bytes - a.bytes || b.rows - a.rows).map((tb) => (
            <tr key={tb.name}>
              <td className="py-1.5 pr-3"><span className="font-mono text-xs text-ink">{tb.name}</span><span className="block text-xs text-ink-3">{TABLES[tb.name] ? t(TABLES[tb.name]) : ""}</span></td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs text-ink tabular-nums">{fmtNum(tb.rows)}</td>
              <td className="py-1.5 text-right font-mono text-xs text-ink tabular-nums">{tb.bytes ? fmtBytes(tb.bytes) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The question before a clear: how much, then "Sẽ mất" / "Giữ nguyên". Mounted only while asking; stays open on failure. */
function ClearData({ it, keep, onClose }: { it: DataItem; keep: number; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const c = CLEARS[it.id];
  const clear = useMutation({
    mutationFn: () => api<void>(`/data/${it.id}`, { method: "DELETE" }),
    retry: false,
    onSuccess: () => {
      onClose();
      toast({ text: t("Đã giải phóng {size}", { size: fmtBytes(it.bytes) }) });
    },
    onSettled: () => qc.invalidateQueries(), // messages, sessions, Briefing, AI history: every view may have shown them
  });
  const meta = [t(c.unit, { n: fmtNum(it.count) }), it.oldest && t("từ {day}", { day: fmtDay(it.oldest) })].filter(Boolean).join(", ");
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(); }} title={t(c.ask)} confirmLabel={t("Xóa")}
      description={t(c.safe ? "Không mất gì thật sự: phần này tự có lại khi cần." : "Không hoàn tác được.")}
      busy={clear.isPending} error={clear.isError && errorText(clear.error, {}, t("Xóa thất bại, thử lại."))} onConfirm={() => clear.mutate()}
      items={[{ id: it.id, tag: fmtBytes(it.bytes), label: meta }]}>
      <dl className="grid gap-2 text-sm">
        <div className="grid gap-0.5 rounded-lg bg-error-wash px-3 py-2">
          <dt className="text-xs font-medium text-error">{t("Sẽ mất")}</dt>
          <dd className="text-ink">{t(c.lose, { n: keep })}</dd>
        </div>
        <div className="grid gap-0.5 rounded-lg bg-ok-wash px-3 py-2">
          <dt className="text-xs font-medium text-ok">{t("Giữ nguyên")}</dt>
          <dd className="text-ink">{t(c.keep, { n: keep })}</dd>
        </div>
      </dl>
    </ConfirmDialog>
  );
}
