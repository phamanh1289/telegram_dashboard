"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitPullRequest, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { AiFetching } from "@/components/ai/fetching";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorText, type Task } from "@/lib/api";
import { toast } from "@/lib/inbox";
import { cn } from "@/lib/utils";

type Changes = { root: string; branch: string; files: { path: string; status: string; secret: boolean }[]; diff: string; truncated: boolean };
type Pr = { url: string | null; branch: string; skipped: string[]; note: string | null };

const ERR = {
  not_git_repo: "Thư mục dự án không phải repo git.", git_missing: "Máy chưa cài git.", no_changes: "Không có thay đổi nào để commit.",
  git_push_failed: "Không đẩy được nhánh lên remote (quyền hoặc mạng).", git_failed: "Git báo lỗi.", git_timeout: "Git chạy quá lâu, thử lại.",
  task_busy: "AI đang chạy: đợi xong lượt này.",
};
const TONE: Record<string, string> = { M: "text-warn", A: "text-ok", "??": "text-ok", D: "text-error", R: "text-info" };

/** What the session's project changed, and a branch + PR from it. Mounted only while open; push needs a second click. */
export function TaskChanges({ t, open, onOpenChange }: { t: Task; open: boolean; onOpenChange: (o: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <Body t={t} />}</Dialog>;
}

function Body({ t }: { t: Task }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["task-changes", t.id], queryFn: ({ signal }) => api<Changes>(`/tasks/${t.id}/changes`, { signal }), staleTime: 0, retry: false });
  const [title, setTitle] = useState(() => (t.title || t.message_text || t.prompt || "").split("\n")[0].slice(0, 120));
  const [sure, setSure] = useState(false);
  const pr = useMutation({
    mutationFn: () => api<Pr>(`/tasks/${t.id}/pr`, { method: "POST", json: { title: title.trim(), body: `Từ phiên AI Agent ${t.id}.` } }),
    onSuccess: (r) => {
      toast({ text: r.url ? "Đã mở PR" : `Đã đẩy nhánh ${r.branch}` });
      void qc.invalidateQueries({ queryKey: ["task-events", t.id] });
      void q.refetch();
    },
    onError: () => setSure(false),
  });
  const files = q.data?.files ?? [];
  const keep = files.filter((f) => !f.secret);
  const secret = files.filter((f) => f.secret);
  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><GitPullRequest className="size-4 text-hl-2" aria-hidden />Thay đổi của phiên</DialogTitle>
        <DialogDescription>{q.data ? <>Nhánh <b className="font-mono">{q.data.branch || "(detached)"}</b> · {q.data.root}</> : t.project}</DialogDescription>
      </DialogHeader>
      {q.isPending ? <AiFetching kind="agent" lines={["Đang mở dự án", "Đang đọc git status", "Đang lấy diff"]} className="min-h-0 py-2" />
        : q.isError ? <p role="alert" className="text-sm text-error">{errorText(q.error, ERR, "Không đọc được thay đổi.")}</p>
        : !files.length ? <p className="text-sm text-ink-3">Không có thay đổi nào trong thư mục dự án.</p>
        : <div className="grid min-w-0 gap-3">
          <ul aria-label="File thay đổi" className="grid max-h-40 gap-0.5 overflow-y-auto rounded-md bg-paper-2 p-2 font-mono text-xs">
            {files.map((f) => (
              <li key={f.path} className={cn("flex gap-2", f.secret && "text-ink-3 line-through")}>
                <span className={cn("w-5 shrink-0 font-semibold", TONE[f.status[0]] ?? TONE[f.status] ?? "text-ink-2")}>{f.status}</span>
                <span className="min-w-0 truncate">{f.path}</span>
              </li>
            ))}
          </ul>
          {secret.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-warn-wash px-3 py-2 text-xs text-warn">
              <ShieldAlert className="size-4 shrink-0" aria-hidden />
              {secret.length} file trông như chứa bí mật (.env, khóa, chứng chỉ) sẽ không được commit: {secret.map((f) => f.path).join(", ")}
            </p>
          )}
          <pre className="max-h-[40vh] overflow-auto rounded-md bg-paper-2 p-3 font-mono text-[11px] leading-relaxed text-ink-2">
            {q.data!.diff.split("\n").map((ln, i) => (
              <span key={i} className={cn("block", ln.startsWith("+") && !ln.startsWith("+++") ? "text-ok" : ln.startsWith("-") && !ln.startsWith("---") ? "text-error" : ln.startsWith("@@") && "text-info")}>{ln || " "}</span>
            ))}
            {q.data!.truncated && <span className="block text-ink-3">… (diff dài, phần còn lại không hiện)</span>}
          </pre>
          <label className="grid gap-1 text-xs text-ink-3">Tiêu đề commit và PR
            <Input id={`pr-title-${t.id}`} value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setSure(false); }} />
          </label>
          {pr.isError && <p role="alert" className="text-xs text-error">{errorText(pr.error, ERR, "Không tạo được PR.")}</p>}
          {pr.data && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ok">
              {pr.data.url ? <a href={pr.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">Mở PR <ExternalLink className="size-3.5" aria-hidden /></a>
                : <span className="text-ink-2">{pr.data.note}</span>}
            </p>
          )}
        </div>}
      {keep.length > 0 && !pr.data && (
        <DialogFooter>
          {sure ? <span className="mr-auto self-center text-xs text-ink-2">Commit {keep.length} file, đẩy lên remote và mở PR?</span> : null}
          <Button variant={sure ? "default" : "outline"} disabled={title.trim().length < 3 || pr.isPending} onClick={() => (sure ? pr.mutate() : setSure(true))}>
            {pr.isPending ? <Loader2 className="animate-spin" /> : <GitPullRequest />} {sure ? "Xác nhận tạo PR" : "Tạo nhánh + PR"}
          </Button>
        </DialogFooter>
      )}
    </DialogContent>
  );
}
