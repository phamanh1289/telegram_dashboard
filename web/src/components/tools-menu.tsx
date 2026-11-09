"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Rule, type RuleAdded } from "@/lib/api";
import { pendingQuery, toast } from "@/lib/inbox";
import { cn } from "@/lib/utils";

/** Rules that mark matching tags handled automatically (bots, announcements…), and the senders whose tags always go first
 *  ("Luôn ưu tiên", added from a tag's Hoãn menu). Lives in Settings. */
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
  // "Luôn ưu tiên": pick from the senders of tags waiting now (also in a tag's Hoãn menu).
  const [prio, setPrio] = useState("");
  const senders = useQuery({
    ...pendingQuery(""),
    select: (rows) => [...new Map(rows.filter((p) => p.message.sender_id && !p.message.priority)
      .map((p) => [p.message.sender_id!, p.message.sender_name || `#${p.message.sender_id}`])).entries()],
  }).data ?? [];
  const addPrio = useMutation({
    mutationFn: (id: string) => api<RuleAdded>("/rules", { method: "POST", json: { kind: "priority", value: id, label: senders.find(([s]) => s === id)?.[1] ?? "" } }),
    onSuccess: () => setPrio(""),
    onError: (e) => toast({ text: errorText(e, {}, "Không thêm được, thử lại") }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/rules/${id}`, { method: "DELETE" }),
    onError: (e) => toast({ text: errorText(e, {}, "Không xóa được quy tắc, thử lại") }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  return (
    <div className="grid gap-3 pt-1">
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
      {senders.length > 0 && (
        <div className="flex gap-2">
          <Dropdown label="Người gửi luôn ưu tiên" value={prio} onChange={setPrio} className="h-9"
            options={[{ value: "", label: "Ưu tiên người gửi… (tin của họ lên đầu)" }, ...senders.map(([id, name]) => ({ value: id, label: name }))]} />
          <Button variant="outline" aria-busy={addPrio.isPending} disabled={!prio || addPrio.isPending} onClick={() => addPrio.mutate(prio)}>Ưu tiên</Button>
        </div>
      )}
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
            <span className={cn("w-20 shrink-0 text-xs", r.kind === "priority" ? "font-medium text-ink-2" : "text-ink-3")}>
              {r.kind === "priority" ? "Ưu tiên" : r.kind === "sender" ? "Bỏ qua người" : "Từ khóa"}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink">{r.kind === "keyword" ? r.value : r.label || `#${r.value}`}</span>
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

