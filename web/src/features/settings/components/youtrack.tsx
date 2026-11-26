"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, RotateCw, Sparkles, UserRound, Workflow } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { Card, Row, useFillHeight } from "@/features/settings/components/parts";
import { Switch } from "@/shared/components/ui/switch";
import { PromptManager } from "@/features/youtrack/components/prompts";
import { YtConnect } from "@/features/youtrack/components/connect";
import { WorkflowSection } from "@/features/youtrack/components/workflow";
import { yt, ytNotesQuery } from "@/features/youtrack/lib/yt";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { Textarea } from "@/shared/components/ui/textarea";
import { CharCount } from "@/shared/components/ui/char-count";
import { type Key, tMaybe, useT } from "@/shared/lib/i18n";
import { onPrefs, readReportAt, readYtRole, type ReportAt, saveReportAt, YT_ROLES, type YtRole } from "@/shared/lib/prefs";

export type YtView = "connect" | "ai" | "workflow";
const YT_VIEWS: { value: YtView; label: Key; title: Key; icon: typeof Plug }[] = [
  { value: "connect", label: "Kết nối và báo cáo", icon: Plug, title: "Token YouTrack, báo cáo release tự động" },
  { value: "ai", label: "AI và prompt", icon: Sparkles, title: "Instructions cho AI theo vai trò, kho prompt" },
  { value: "workflow", label: "Workflow", icon: Workflow, title: "Luồng State cho từng project và vai trò" },
];

export function YouTrackGroup({ view, setView }: { view: YtView; setView: (v: YtView) => void }) {
  const t = useT();
  const role = useSyncExternalStore(onPrefs, readYtRole, () => null);
  // the role a card edits for (Instructions; Workflow falls back to Dev, as the server does), picked in Cài đặt › Chung
  const chip = (r: YtRole | null) => {
    const name = YT_ROLES.find(([x]) => x === r)?.[1];
    // stands out: what the card shows and saves depends on it
    return name && <span className="inline-flex items-center gap-1.5 rounded-full bg-hl-wash px-2.5 py-1 text-sm text-hl-2 ring-1 ring-hl/35">
      <UserRound className="size-3.5" aria-hidden />{t("Vai trò:")} <b className="font-bold">{t(name)}</b>
    </span>;
  };
  return <>
    <Segmented id="set-yt-view" variant="card" label={t("Nhóm cài đặt YouTrack")} value={view} onChange={setView}
      items={YT_VIEWS.map((v) => ({ value: v.value, label: <><v.icon className="size-3.5" aria-hidden />{t(v.label)}</>, title: t(v.title) }))} />
    {view === "connect" && <>
      <Card title="Tài khoản YouTrack" info="Token chỉ lưu trên máy này (thư mục data/), dùng cho trang YouTrack và nút tạo issue.">
        <YtConnect />
      </Card>
      <Card advanced title="Báo cáo release" info="AI tự viết báo cáo (kịp release không, bàn giao QC, stuck, kết quả test, việc trễ, quá tải, bug) theo vai trò và project đang chọn bên trang YouTrack. Chạy khi trang YouTrack đang mở; lỡ giờ thì tạo lúc mở lại trong ngày. Xuất MD / PDF / CSV ở card Báo cáo.">
        <ReportSection />
      </Card>
    </>}
    {view === "ai" && <>
      <Card title="Instructions cho AI" action={chip(role)}
        info="Hướng dẫn riêng của team cho vai trò đang chọn (Cài đặt › Chung), AI làm theo ở mọi tính năng YouTrack (phiên AI, test case, triage, báo cáo, tạo ticket…), trừ lọc ticket. Lưu trên máy này (data/).">
        <NotesSection role={role} />
      </Card>
      <Card advanced title="Kho prompt" info="Prompt cho phiên AI YouTrack, dùng chung cả team (data/). Ghim tối đa 5 làm nút cho từng vai trò và số ticket; mặc định 4 prompt có sẵn theo vai trò. Prompt có sẵn xóa được, khôi phục ở cuối danh sách.">
        <div className="pt-1"><PromptManager role={role ?? "dev"} /></div>
      </Card>
    </>}
    {view === "workflow" && <WorkflowCard action={chip(role ?? "dev")} />}
  </>;
}

/** Down to the window's foot (wide screens): the canvas takes all the room the card has. */
function WorkflowCard({ action }: { action: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const height = useFillHeight(box, 520);
  return (
    <div ref={box} className="min-w-0" style={height ? { height } : undefined}>
      <Card fill title="Workflow" action={action} info="Mỗi project, mỗi vai trò (Cài đặt › Chung) một luồng State, dùng chung cả team (data/). Ticket chỉ đổi State theo mũi tên; chưa có mũi tên nào thì chưa đổi được State. Kéo State giữa sơ đồ và cột phải để thêm / bớt, kéo chấm tròn sang ô khác để nối, chọn ô hoặc mũi tên rồi Delete để bỏ. Sửa gì cũng là bản nháp tới khi bấm Lưu.">
        <div className="flex min-h-0 flex-col pt-1"><WorkflowSection /></div>
      </Card>
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
  const q = useQuery(ytNotesQuery);
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ role: YtRole; text: string } | null>(null); // null: showing the saved text
  const save = useMutation({
    mutationFn: (text: string) => yt.setNotes({ ...q.data!, [role!]: text }),
    onSuccess: (d) => { qc.setQueryData(ytNotesQuery.queryKey, d); setEdit(null); },
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
        <CharCount n={text.length} max={4000} className="ml-auto" />
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
