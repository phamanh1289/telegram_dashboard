"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Rule, type RuleAdded } from "@/lib/api";
import { t as tPlain, useT } from "@/lib/i18n";
import { pendingQuery, toast } from "@/lib/inbox";
import { cn } from "@/lib/utils";

/** Rules that mark matching tags handled automatically (bots, announcements…), and the senders whose tags always go first
 *  ("Luôn ưu tiên", added from a tag's Hoãn menu). Lives in Settings. */
export function RulesSection() {
  const t = useT();
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
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không thêm được, thử lại")) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/rules/${id}`, { method: "DELETE" }),
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không xóa được quy tắc, thử lại")) }),
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
        <Input aria-label={t("Từ khóa")} placeholder={t("Từ khóa, ví dụ #TB")} value={keyword} maxLength={200}
          onChange={(e) => setKeyword(e.target.value)} />
        <Button type="submit" variant="outline" aria-busy={add.isPending} disabled={!keyword.trim() || add.isPending}>{t("Thêm")}</Button>
      </form>
      {senders.length > 0 && (
        <div className="flex gap-2">
          <Dropdown label={t("Người gửi luôn ưu tiên")} value={prio} onChange={setPrio} className="h-9"
            options={[{ value: "", label: t("Ưu tiên người gửi… (tin của họ lên đầu)") }, ...senders.map(([id, name]) => ({ value: id, label: name }))]} />
          <Button variant="outline" aria-busy={addPrio.isPending} disabled={!prio || addPrio.isPending} onClick={() => addPrio.mutate(prio)}>{t("Ưu tiên")}</Button>
        </div>
      )}
      {add.data && <p role="status" className="text-sm text-ok">{t.n("Đã thêm, dọn {n} tin đang chờ.", { n: <span className="font-mono">{add.data.handled}</span> })}</p>}
      {add.isError && <p role="alert" className="text-sm text-error">{t("Không thêm được quy tắc.")}</p>}
      <ul className="grid divide-y divide-rule border-y border-rule text-sm">
        {rules.isPending && <li className="grid gap-2 py-2.5" aria-label={t("Đang tải…")}><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3.5 w-1/2" /></li>}
        {rules.isError && (
          <li role="alert" className="flex items-center gap-2 py-2.5 text-error">
            {t("Không tải được quy tắc.")}
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => void rules.refetch()}>{t("Thử lại")}</Button>
          </li>
        )}
        {rules.data?.length === 0 && <li className="py-2.5 text-ink-3">{t("Chưa có quy tắc nào.")}</li>}
        {rules.data?.map((r) => (
          <li key={r.id} className="flex h-10 items-center gap-3 animate-in fade-in-0 duration-(--dur-short)">
            <span className={cn("w-20 shrink-0 text-xs", r.kind === "priority" ? "font-medium text-ink-2" : "text-ink-3")}>
              {r.kind === "priority" ? t("Ưu tiên") : r.kind === "sender" ? t("Bỏ qua người") : t("Từ khóa")}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink">{r.kind === "keyword" ? r.value : r.label || `#${r.value}`}</span>
            <Button size="icon-xs" variant="ghost" className="hover:bg-error-wash hover:text-error" aria-label={t("Xóa quy tắc")} disabled={remove.isPending}
              onClick={() => remove.mutate(r.id)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

