"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError, type Project } from "@/lib/api";

/** Project the AI agent may read when drafting; "" = none. */
export function ProjectPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => api<Project[]>("/projects", { signal }),
  });
  const add = useMutation({
    mutationFn: (p: string) => api<Project>("/projects", { method: "POST", json: { path: p } }),
    onSuccess: (p) => {
      onChange(p.path);
      setAdding(false);
      setPath("");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  // Opens the native Finder folder dialog on this Mac (backend runs locally); 204 = cancelled.
  const pick = useMutation({
    mutationFn: () => api<Project | undefined>("/projects/pick", { method: "POST" }),
    onSuccess: (p) => p && onChange(p.path),
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  const remove = useMutation({
    mutationFn: (p: string) => api<void>(`/projects?path=${encodeURIComponent(p)}`, { method: "DELETE" }),
    onSuccess: () => onChange(""),
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  const items = projects.data ?? [];
  // A stored choice that no longer exists falls back to "none".
  const current = items.some((p) => p.path === value) ? value : "";

  return (
    <span className="flex items-center gap-1 text-xs text-ink-3">
      <FolderGit2 className="size-4 shrink-0" aria-hidden />
      <select
        aria-label="Dự án tham chiếu cho AI"
        title={current || "AI không đọc dự án nào"}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 max-w-40 rounded-md border border-rule-2 bg-cotton px-2 text-ink transition-[border-color] duration-(--dur-micro) hover:border-ink-3"
      >
        <option value="">Không dùng dự án</option>
        {items.map((p) => (
          <option key={p.path} value={p.path}>{p.name}</option>
        ))}
      </select>
      {current && (
        <Button size="icon-xs" variant="ghost" className="hover:bg-error-wash hover:text-error" aria-label="Gỡ dự án khỏi danh sách" title="Gỡ dự án khỏi danh sách"
          disabled={remove.isPending} onClick={() => remove.mutate(current)}>
          <X />
        </Button>
      )}
      <Button size="xs" variant="ghost" title="Chọn thư mục dự án trong Finder" aria-busy={pick.isPending} disabled={pick.isPending}
        onClick={() => pick.mutate()}>
        <Plus /> {pick.isPending ? "Đang chọn…" : "Thêm"}
      </Button>
      {pick.isError && (
        <Button size="xs" variant="link" className="whitespace-normal text-left text-error" onClick={() => setAdding(true)}>
          {pick.error instanceof ApiError && pick.error.code === "not_found"
            ? "Backend cũ: khởi động lại dashboard (hoặc nhập đường dẫn)"
            : "Không mở được hộp chọn thư mục, nhập đường dẫn"}
        </Button>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (path.trim()) add.mutate(path.trim());
            }}
          >
            <DialogTitle>Thêm dự án</DialogTitle>
            <DialogDescription>
              Dán đường dẫn thư mục dự án trên máy (ví dụ ~/Documents/my-app). Mẹo: kéo thư mục từ Finder vào Terminal để lấy đường dẫn.
              Khi chọn dự án, AI chỉ được đọc file (không sửa, không chạy lệnh) để trả lời đúng logic.
            </DialogDescription>
            <Input autoFocus aria-label="Đường dẫn dự án" placeholder="/Users/…/my-app" value={path}
              onChange={(e) => setPath(e.target.value)} maxLength={1000} />
            {add.isError && (
              <p role="alert" className="text-sm text-error">
                {add.error instanceof ApiError && add.error.code === "project_not_a_directory"
                  ? "Không tìm thấy thư mục này."
                  : "Không thêm được dự án."}
              </p>
            )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Hủy</DialogClose>
              <Button type="submit" aria-busy={add.isPending} disabled={!path.trim() || add.isPending}>Thêm</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </span>
  );
}
