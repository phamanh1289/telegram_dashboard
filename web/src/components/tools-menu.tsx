"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Filter, Newspaper, Trash2 } from "lucide-react";
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
            <Button type="submit" disabled={!keyword.trim() || add.isPending}>Thêm</Button>
          </form>
          {add.data && <p className="text-xs text-emerald-600">Đã thêm, dọn {add.data.handled} tin đang chờ.</p>}
          <ul className="grid gap-1 text-sm">
            {rules.data?.length === 0 && <li className="text-muted-foreground">Chưa có quy tắc nào.</li>}
            {rules.data?.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-md border px-2 py-1">
                <span className="text-xs text-muted-foreground">{r.kind === "sender" ? "Người gửi" : "Từ khóa"}</span>
                <span className="min-w-0 flex-1 truncate">{r.kind === "sender" ? (r.label || r.value) : r.value}</span>
                <Button size="icon-xs" variant="ghost" aria-label="Xóa quy tắc" disabled={remove.isPending}
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
          {run.isPending && <p className="animate-pulse text-sm text-muted-foreground">AI đang đọc các tin tag…</p>}
          {run.isError && (
            <p className="text-sm text-destructive">
              {run.error instanceof ApiError && run.error.code === "ai_scope_not_allowed"
                ? "Cần AI_REQUIRE_CONSENT=0 để AI đọc toàn bộ tin."
                : "AI lỗi hoặc quá thời gian."}
            </p>
          )}
          {run.data && <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm">{run.data.text}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Làm lại</Button>
            <DialogClose render={<Button />}>Đóng</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
