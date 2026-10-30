"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Filter, Loader2, Newspaper, Trash2 } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type AiResult, type Rule, type RuleAdded } from "@/lib/api";

/** Rules that mark matching tags handled automatically (bots, announcements…). */
export function RulesButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: ({ signal }) => api<Rule[]>("/rules", { signal }),
    enabled: open,
  });
  const add = useMutation({
    mutationFn: (value: string) => api<RuleAdded>("/rules", { method: "POST", json: { kind: "keyword", value } }),
    onSuccess: () => setKeyword(""),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/rules/${id}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label="Quy tắc tự bỏ qua" title="Quy tắc tự bỏ qua" onClick={() => setOpen(true)}>
        <Filter />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Tự đánh dấu “đã xử lý”</DialogTitle>
          <DialogDescription>
            Tin tag khớp quy tắc sẽ tự chuyển sang “Đã xử lý”, không báo thông báo. Thêm người gửi bằng menu “Khác” trên từng tin.
          </DialogDescription>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (keyword.trim()) add.mutate(keyword.trim());
            }}
          >
            <Input aria-label="Từ khóa" placeholder="Từ khóa, ví dụ #TB" value={keyword} maxLength={200}
              onChange={(e) => setKeyword(e.target.value)} />
            <Button type="submit" variant="outline" aria-busy={add.isPending} disabled={!keyword.trim() || add.isPending}>Thêm</Button>
          </form>
          {add.data && <p role="status" className="text-sm text-ok">Đã thêm, dọn <span className="font-mono">{add.data.handled}</span> tin đang chờ.</p>}
          {add.isError && <p role="alert" className="text-sm text-error">Không thêm được quy tắc.</p>}
          <ul className="grid divide-y divide-rule border-y border-rule text-sm">
            {rules.isPending && <li className="grid gap-2 py-2.5" aria-label="Đang tải…"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3.5 w-1/2" /></li>}
            {rules.isError && (
              <li role="alert" className="flex items-center gap-2 py-2.5 text-error">
                Không tải được quy tắc.
                <Button size="xs" variant="outline" className="ml-auto" onClick={() => void rules.refetch()}>Thử lại</Button>
              </li>
            )}
            {rules.data?.length === 0 && <li className="py-2.5 text-ink-3">Chưa có quy tắc nào.</li>}
            {rules.data?.map((r) => (
              <li key={r.id} className="flex h-10 items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-ink-3">{r.kind === "sender" ? "Người gửi" : "Từ khóa"}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{r.kind === "sender" ? (r.label || r.value) : r.value}</span>
                <Button size="icon-xs" variant="ghost" className="hover:bg-error-wash hover:text-error" aria-label="Xóa quy tắc" disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Đóng</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** AI digest of every pending tag, grouped by urgency. */
export function DigestButton({ range, aiConfigured }: { range: string; aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: () => api<AiResult>(`/ai/digest${range ? `?${range}` : ""}`, { method: "POST" }),
    retry: false,
    networkMode: "always",
  });
  return (
    <>
      <Button size="sm" variant="ghost" disabled={!aiConfigured} title="AI tóm tắt mọi tin tag chưa xử lý"
        onClick={() => {
          setOpen(true);
          run.mutate();
        }}>
        <Newspaper /> <span className="hidden lg:inline">Tóm tắt</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogTitle>Tóm tắt việc cần xử lý</DialogTitle>
          {run.isPending && (
            <div className="grid gap-2" aria-label="AI đang đọc các tin tag…">
              <p className="flex items-center gap-1.5 text-sm text-ink-3"><Loader2 className="size-3.5 animate-spin" aria-hidden /> AI đang đọc các tin tag…</p>
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-3.5" style={{ width: `${90 - i * 18}%` }} />)}
            </div>
          )}
          {run.isError && (
            <p role="alert" className="text-sm text-error">
              {run.error instanceof ApiError && run.error.code === "ai_scope_not_allowed"
                ? "Cần AI_REQUIRE_CONSENT=0 để AI đọc toàn bộ tin."
                : "AI lỗi hoặc quá thời gian."}
            </p>
          )}
          {run.data && <p className="max-h-[60vh] max-w-[70ch] overflow-y-auto whitespace-pre-wrap text-[0.9375rem] leading-[1.55] text-ink">{run.data.text}</p>}
          <DialogFooter>
            <Button variant="outline" aria-busy={run.isPending} disabled={run.isPending} onClick={() => run.mutate()}>Làm lại</Button>
            <DialogClose render={<Button />}>Đóng</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
