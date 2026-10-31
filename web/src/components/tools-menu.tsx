"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Rule, type RuleAdded } from "@/lib/api";

/** Rules that mark matching tags handled automatically (bots, announcements…). Lives in Settings. */
export function RulesSection() {
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: ({ signal }) => api<Rule[]>("/rules", { signal }),
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
    <div className="grid gap-3">
      <p className="text-xs leading-relaxed text-ink-3">
        Tin tag khớp quy tắc sẽ tự chuyển sang “Đã xử lý”, không báo. Bỏ qua người gửi bằng nút ⊘ trên từng tin.
      </p>
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
          <li key={r.id} className="flex h-10 items-center gap-3 animate-in fade-in-0 duration-(--dur-short)">
            <span className="w-20 shrink-0 text-xs text-ink-3">{r.kind === "sender" ? "Người gửi" : "Từ khóa"}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{r.kind === "sender" ? (r.label || r.value) : r.value}</span>
            <Button size="icon-xs" variant="ghost" className="hover:bg-error-wash hover:text-error" aria-label="Xóa quy tắc" disabled={remove.isPending}
              onClick={() => remove.mutate(r.id)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

