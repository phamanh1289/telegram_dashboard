"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RotateCw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Card, linkCls, Row, StatusLine, Switch, tMap } from "@/features/settings/components/parts";
import { PromptManager } from "@/features/youtrack/components/prompts";
import { WorkflowSection } from "@/features/youtrack/components/workflow";
import { yt } from "@/features/youtrack/lib/yt";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { Textarea } from "@/shared/components/ui/textarea";
import { api, errorText } from "@/shared/lib/api";
import { type Key, tMaybe, useT } from "@/shared/lib/i18n";
import { onPrefs, readReportAt, readYtRole, type ReportAt, saveReportAt, YT_ROLES, type YtRole } from "@/shared/lib/prefs";

export type YtView = "connect" | "ai" | "workflow";
const YT_VIEWS: { value: YtView; label: Key; title: Key }[] = [
  { value: "connect", label: "Kết nối và báo cáo", title: "Token YouTrack, báo cáo release tự động" },
  { value: "ai", label: "AI và prompt", title: "Instructions cho AI theo vai trò, kho prompt" },
  { value: "workflow", label: "Workflow", title: "Luồng State cho từng project và vai trò" },
];

export function YouTrackGroup({ view, setView }: { view: YtView; setView: (v: YtView) => void }) {
  const t = useT();
  const role = useSyncExternalStore(onPrefs, readYtRole, () => null);
  const roleName = YT_ROLES.find(([r]) => r === role)?.[1];
  return <>
    <Segmented id="set-yt-view" variant="card" label={t("Nhóm cài đặt YouTrack")} value={view} onChange={setView}
      items={YT_VIEWS.map((v) => ({ value: v.value, label: t(v.label), title: t(v.title) }))} />
    {view === "connect" && <>
      <Card title="Tài khoản YouTrack" info="Token chỉ lưu trên máy này (thư mục data/), dùng cho trang YouTrack và nút tạo issue.">
        <YouTrackSection />
      </Card>
      <Card advanced title="Báo cáo release" info="AI tự viết báo cáo (kịp release không, bàn giao QC, stuck, kết quả test, việc trễ, quá tải, bug) theo vai trò và project đang chọn bên trang YouTrack. Chạy khi trang YouTrack đang mở; lỡ giờ thì tạo lúc mở lại trong ngày. Xuất MD / PDF / CSV ở card Báo cáo.">
        <ReportSection />
      </Card>
    </>}
    {view === "ai" && <>
      <Card title="Instructions cho AI" action={roleName && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs text-ink-2 shadow-groove">{t("Vai trò:")} <b className="font-bold">{t(roleName)}</b></span>}
        info="Hướng dẫn riêng của team cho vai trò đang chọn (Cài đặt › Chung), AI làm theo ở mọi tính năng YouTrack (phiên AI, test case, triage, báo cáo, tạo ticket…), trừ lọc ticket. Lưu trên máy này (data/).">
        <NotesSection role={role} />
      </Card>
      <Card advanced title="Kho prompt" info="Prompt cho phiên AI YouTrack, dùng chung cả team (data/). Ghim tối đa 5 làm nút cho từng vai trò và số ticket; mặc định 4 prompt có sẵn theo vai trò. Prompt có sẵn xóa được, khôi phục ở cuối danh sách.">
        <div className="pt-1"><PromptManager role={role ?? "dev"} /></div>
      </Card>
    </>}
    {view === "workflow" && (
      <Card advanced title="Workflow" info="Luồng State cho từng project và vai trò đang chọn (Cài đặt › Chung): Dev, QA, PO mỗi vai trò một luồng, dùng chung cả team (data/). Kéo ô để di chuyển, kéo chấm tròn sang ô khác để nối mũi tên, bấm mũi tên rồi Delete (hoặc ×) để xóa; × ở góc ô để ẩn state khỏi workflow, hiện lại ở dòng Đã ẩn. Bật Áp dụng thì menu State và kéo thả trên Board chỉ cho đi theo mũi tên; YouTrack vẫn kiểm tra luồng của nó.">
        <div className="pt-1"><WorkflowSection /></div>
      </Card>
    )}
  </>;
}

const YT_ERRORS: Record<string, Key> = {
  youtrack_unauthorized: "Token sai, đã thu hồi hoặc không đủ quyền.",
  youtrack_unreachable: "Không kết nối được YouTrack ở URL này.",
};

/** Paste a permanent token (made on the YouTrack profile page); the server checks it before keeping it. Connected: the form folds away. */
function YouTrackSection() {
  const t = useT();
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["yt-config"],
    queryFn: ({ signal }) => api<{ base: string; mock: boolean; hint: string | null }>("/yt/config", { signal }),
  });
  const [url, setUrl] = useState<string | null>(null); // null: still showing the server's URL
  const [token, setToken] = useState("");
  const [edit, setEdit] = useState(false);
  const base = (url ?? cfg.data?.base ?? "").trim().replace(/\/+$/, "");
  const save = useMutation({
    mutationFn: () => api<{ login: string; name: string }>("/youtrack/auth", { method: "PUT", json: { url: base, token: token.trim() } }),
    onSuccess: () => {
      setToken("");
      setEdit(false);
      void qc.invalidateQueries({ queryKey: ["yt-config"] });
      void qc.invalidateQueries({ queryKey: ["status"] });
      qc.removeQueries({ queryKey: ["yt"] }); // projects/me/issues of the old token (or sample data) are cached forever
    },
  });
  if (!cfg.data) return <div className="pt-1"><StatusLine tone={cfg.isError ? "error" : "idle"}>{cfg.isError ? t("Không đọc được cấu hình YouTrack") : t("Đang kiểm tra…")}</StatusLine></div>;
  const live = !cfg.data.mock;
  const validUrl = /^https?:\/\/\S+$/.test(base);
  return (
    <div className="grid gap-2.5 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusLine tone={live ? "ok" : "warn"}>
          {save.isSuccess ? <>{t("Đã kết nối:")} <b className="font-bold">{save.data.name}</b></> : live ? <>{t("Đang dùng")} <span className="font-mono text-xs">{cfg.data.base}</span></> : t("Chưa có token, trang YouTrack đang hiện dữ liệu mẫu")}
        </StatusLine>
        {live && !edit && <Button size="sm" variant="outline" onClick={() => setEdit(true)}>{t("Đổi URL / token")}</Button>}
      </div>
      {(!live || edit) && (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Input aria-label="URL YouTrack" placeholder="https://youtrack.example.com" inputMode="url" maxLength={200}
            value={url ?? cfg.data.base} onChange={(e) => setUrl(e.target.value)} />
          <div className="flex gap-2">
            <Input aria-label={t("Token YouTrack")} type="password" autoComplete="off" placeholder={cfg.data.hint ?? "perm-…"} maxLength={500}
              value={token} onChange={(e) => setToken(e.target.value)} />
            <Button type="submit" aria-busy={save.isPending} disabled={save.isPending || !validUrl || token.trim().length < 8}>
              {save.isPending ? t("Đang kiểm tra…") : cfg.data.hint ? t("Cập nhật") : t("Lưu")}
            </Button>
            {edit && <Button type="button" variant="ghost" onClick={() => setEdit(false)}>{t("Hủy")}</Button>}
          </div>
          {validUrl && (
            <a href={`${base}/users/me?tab=account-security`} target="_blank" rel="noreferrer" className={linkCls}>
              {t("Tạo token trên YouTrack (Hồ sơ → Account Security → New token)")} <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </form>
      )}
      {save.isError && <p role="alert" className="text-xs text-error">{errorText(save.error, tMap(t, YT_ERRORS), t("Không lưu được. Kiểm tra URL (bắt đầu bằng https://) và token."))}</p>}
    </div>
  );
}

const NOTES_HINT: Record<YtRole, Key> = {
  qa: "Vd.\n- Test case dạng bảng: ID | Tiền điều kiện | Bước | Kết quả mong đợi | Mức ưu tiên\n- Luôn kiểm cả iOS và Android; môi trường dev rồi staging\n- Khi phân tích bug: nêu mức ảnh hưởng người dùng và vùng regression\n- Viết test case bằng tiếng Việt, tên màn hình giữ tiếng Anh",
  dev: "Vd.\n- Khi chia task: ước lượng theo giờ, tách FE / BE\n- Standup ngắn, tối đa 5 dòng",
  po: "Vd.\n- Báo cáo cho khách hàng: tránh thuật ngữ kỹ thuật\n- Luôn nêu rủi ro về deadline trước",
};

/** Team instructions per role, kept on the server; this box edits the role picked in Chung. */
function NotesSection({ role }: { role: YtRole | null }) {
  const t = useT();
  const q = useQuery({ queryKey: ["yt", "notes"], queryFn: () => yt.notes() });
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ role: YtRole; text: string } | null>(null); // null: showing the saved text
  const save = useMutation({
    mutationFn: (text: string) => yt.setNotes({ ...q.data!, [role!]: text }),
    onSuccess: (d) => { qc.setQueryData(["yt", "notes"], d); setEdit(null); },
  });
  if (!role) return <p className="pt-1 text-sm text-ink-3">{t("Chọn vai trò ở Cài đặt › Chung trước.")}</p>;
  if (!q.data) return (
    <p className="flex items-center gap-2 pt-1 text-sm text-ink-3">
      {q.isError ? <>{t("Không tải được:")} {tMaybe((q.error as Error).message)} <Button size="xs" variant="outline" onClick={() => void q.refetch()}><RotateCw /> {t("Thử lại")}</Button></> : t("Đang tải…")}
    </p>
  );
  const draft = edit?.role === role ? edit.text : null; // an edit belongs to the role it was typed for
  const text = draft ?? q.data[role];
  const name = YT_ROLES.find(([r]) => r === role)![1];
  return (
    <form className="grid gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); save.mutate(text.trim()); }}>
      <Textarea rows={6} maxLength={4000} value={text} onChange={(e) => setEdit({ role, text: e.target.value })} aria-label={t("Instructions cho AI, vai trò {role}", { role: t(name) })} placeholder={t(NOTES_HINT[role])} className="text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={draft === null || save.isPending}>{t("Lưu")}</Button>
        {draft !== null && <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>{t("Hủy")}</Button>}
        <span className="ml-auto font-mono text-xs text-ink-3 tabular-nums">{text.length}/4000</span>
      </div>
      {save.isError && <p role="alert" className="text-xs text-error">{t("Không lưu được:")} {tMaybe((save.error as Error).message)}</p>}
    </form>
  );
}

const WEEK = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;

/** When the YouTrack release report writes itself (per browser); the report follows the role and the project on the YouTrack page. */
function ReportSection() {
  const t = useT();
  const [v, setV] = useState(readReportAt);
  const set = (next: Partial<ReportAt>) => { const n = { ...v, ...next }; setV(n); saveReportAt(n); };
  return <>
    <Row label={t("Tự tạo báo cáo")} desc={t("Theo vai trò và project đang chọn bên trang YouTrack.")}>
      <Switch label={t("Tự tạo báo cáo")} checked={v.on} onChange={(on) => set({ on })} />
    </Row>
    {v.on && (
      <Row label={t("Lịch")} stack>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("Ngày tạo báo cáo")} className="flex flex-wrap gap-1">
            {WEEK.map((d, k) => {
              const on = v.days.includes(k);
              return <Button key={d} type="button" size="xs" variant={on ? "default" : "outline"} aria-pressed={on} className="w-9"
                onClick={() => set({ days: on ? v.days.filter((x) => x !== k) : [...v.days, k].sort() })}>{t(d)}</Button>;
            })}
          </div>
          <span className="text-xs text-ink-3">{t("lúc")}</span>
          <Input aria-label={t("Giờ tạo báo cáo")} type="time" className="h-8 w-28" value={v.time} onChange={(e) => /^\d\d:\d\d$/.test(e.target.value) && set({ time: e.target.value })} />
        </div>
      </Row>
    )}
  </>;
}
