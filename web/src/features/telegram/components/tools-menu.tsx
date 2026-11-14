"use client";

import { Combobox } from "@base-ui/react/combobox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Forward, Hash, type LucideIcon, Plus, Star, UserX, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Dropdown, OPTION, POPUP } from "@/shared/components/ui/dropdown";
import { PILL_SPRING } from "@/shared/components/ui/segmented";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { api, errorText, type Member, type Rule, type RuleAdded } from "@/shared/lib/api";
import { type Key, t as tPlain, useT } from "@/shared/lib/i18n";
import { ignoreSender, pendingQuery } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { fold } from "@/shared/lib/utils";
import { cn } from "@/shared/lib/utils";

/** One group per rule kind, in this order; `wash`/`ink` colour its chips. */
const KINDS: { kind: Rule["kind"]; label: Key; icon: LucideIcon; wash: string; ink: string }[] = [
  { kind: "sender", label: "Người gửi bỏ qua", icon: UserX, wash: "bg-error-wash", ink: "text-error" },
  { kind: "keyword", label: "Từ khóa", icon: Hash, wash: "bg-warn-wash", ink: "text-warn" },
  { kind: "priority", label: "Ưu tiên", icon: Star, wash: "bg-ok-wash", ink: "text-ok" },
  { kind: "relay", label: "Tự chuyển vào phiên", icon: Forward, wash: "bg-info-wash", ink: "text-info" },
  { kind: "agent", label: "Tự giao AI Agent", icon: Bot, wash: "bg-hl-wash", ink: "text-hl" },
];

const POP = { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.6 }, transition: PILL_SPRING } as const;
const ADD_CHIP = "flex h-7 items-center gap-1 rounded-full border border-dashed border-rule-2 bg-transparent pr-1.5 pl-2 text-xs text-ink-3 transition-colors duration-(--dur-micro) hover:border-hl hover:text-ink focus-within:border-hl data-popup-open:border-hl data-popup-open:text-ink";

/** Rules that mark matching tags handled automatically (bots, announcements…), and the senders whose tags always go first
 *  ("Luôn ưu tiên", added from a tag's Hoãn menu). Lives in Settings. Chips grouped by kind; add / remove pop in place. */
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
    onSuccess: (r) => { setKeyword(""); if (r.handled) toast({ text: tPlain("Đã thêm, dọn {n} tin đang chờ.", { n: r.handled }) }); },
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không thêm được quy tắc, thử lại")) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  // "Luôn ưu tiên": pick from the senders of tags waiting now (also in a tag's Hoãn menu).
  const senders = useQuery({
    ...pendingQuery(""),
    select: (rows) => [...new Map(rows.filter((p) => p.message.sender_id && !p.message.priority)
      .map((p) => [p.message.sender_id!, p.message.sender_name || `#${p.message.sender_id}`])).entries()],
  }).data ?? [];
  const addPrio = useMutation({
    mutationFn: (id: string) => api<RuleAdded>("/rules", { method: "POST", json: { kind: "priority", value: id, label: senders.find(([s]) => s === id)?.[1] ?? "" } }),
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không thêm được, thử lại")) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/rules/${id}`, { method: "DELETE" }),
    onMutate: async (id) => { // the chip leaves at once; a failure brings it back with the refetch
      await qc.cancelQueries({ queryKey: ["rules"] });
      qc.setQueryData<Rule[]>(["rules"], (rs) => rs?.filter((r) => r.id !== id));
    },
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không xóa được quy tắc, thử lại")) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  if (rules.isPending) return (
    <div className="flex flex-wrap gap-1.5 pt-1" aria-label={t("Đang tải…")}>
      {[20, 28, 16, 24].map((w) => <Skeleton key={w} className="h-7 rounded-full" style={{ width: `${w * 0.25}rem` }} />)}
    </div>
  );
  if (rules.isError) return (
    <p role="alert" className="flex items-center gap-2 pt-1 text-sm text-error">
      {t("Không tải được quy tắc.")}
      <Button size="xs" variant="outline" className="ml-auto" onClick={() => void rules.refetch()}>{t("Thử lại")}</Button>
    </p>
  );

  return (
    <div className="grid grid-cols-1 gap-4 pt-1">
      {KINDS.map(({ kind, label, icon: Icon, wash, ink }) => {
        const list = rules.data.filter((r) => r.kind === kind);
        const adder = kind === "keyword" || kind === "sender" || (kind === "priority" && senders.length > 0);
        if (!list.length && !adder) return null;
        return (
          <section key={kind} aria-label={t(label)} className="grid gap-1.5">
            <h4 className="flex items-center gap-1.5 text-2xs font-bold text-ink-3">
              <Icon className={cn("size-3.5", ink)} aria-hidden /> {t(label)}
              {list.length > 0 && <span className="font-mono font-normal">{list.length}</span>}
            </h4>
            <ul className="flex flex-wrap items-center gap-1.5">
              <AnimatePresence initial={false} mode="popLayout">
                {list.map((r) => {
                  const name = r.kind === "keyword" ? r.value : r.label || `#${r.value}`;
                  return (
                    <motion.li key={r.id} layout {...POP}
                      className={cn("flex h-7 max-w-full min-w-0 items-center gap-1 rounded-full pr-0.5 pl-2.5 text-xs font-medium text-ink", wash)}>
                      <span className="truncate">{name}</span>
                      {r.project && <span className="shrink-0 text-ink-3">· {r.project.split("/").pop()}</span>}
                      <button type="button" aria-label={t("Xóa {name}", { name })} onClick={() => remove.mutate(r.id)}
                        className={cn("grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-(--dur-micro) hover:bg-cotton/70 focus-visible:outline-2 focus-visible:outline-(--color-focus)", ink)}>
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </motion.li>
                  );
                })}
                {kind === "keyword" && (
                  <motion.li key="add" layout="position" className="flex">
                    <form className={ADD_CHIP} onSubmit={(e) => { e.preventDefault(); if (keyword.trim()) add.mutate(keyword.trim()); }}>
                      <Plus className="size-3.5 shrink-0" aria-hidden />
                      <input aria-label={t("Từ khóa")} placeholder={t("Từ khóa, ví dụ #TB")} value={keyword} maxLength={200}
                        disabled={add.isPending} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setKeyword("")}
                        className="w-32 bg-transparent text-ink outline-none placeholder:text-ink-3" />
                    </form>
                  </motion.li>
                )}
                {kind === "priority" && senders.length > 0 && (
                  <motion.li key="add" layout="position" className="flex">
                    <Dropdown label={t("Người gửi luôn ưu tiên")} value="" trigger={ADD_CHIP} prefix={<Plus className="size-3.5 shrink-0" aria-hidden />}
                      onChange={(id) => id && addPrio.mutate(id)}
                      options={[{ value: "", label: t("Ưu tiên người gửi…") }, ...senders.map(([id, n]) => ({ value: id, label: n }))]} />
                  </motion.li>
                )}
                {kind === "sender" && (
                  <motion.li key="add" layout="position" className="flex"><SenderPicker taken={list.map((r) => r.value)} /></motion.li>
                )}
              </AnimatePresence>
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Type a name, pick one of the people seen writing in saved messages (/senders): same rule, toast and Undo as
 *  "Luôn bỏ qua …" in a tag's Hoãn menu. */
function SenderPicker({ taken }: { taken: string[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const people = useQuery({ queryKey: ["senders"], queryFn: ({ signal }) => api<Member[]>("/senders", { signal }), staleTime: 60_000 });
  const add = useMutation({
    mutationFn: (m: Member) => ignoreSender({ sender_id: m.user_id, sender_name: m.name }),
    onSuccess: () => setQ(""),
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không thêm được quy tắc, thử lại")) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const items = (people.data ?? []).filter((m) => !taken.includes(m.user_id));
  const twins = new Set(items.map((m) => m.name).filter((n, i, all) => all.indexOf(n) !== i)); // same name: show the id
  return (
    <Combobox.Root items={items} value={null} inputValue={q} onInputValueChange={setQ} onValueChange={(m) => m && add.mutate(m)}
      itemToStringLabel={(m: Member) => m.name} filter={(m: Member, s) => fold(m.name).includes(fold(s))} autoHighlight limit={50}>
      <label className={ADD_CHIP}>
        <Plus className="size-3.5 shrink-0" aria-hidden />
        <Combobox.Input aria-label={t("Thêm người gửi bỏ qua")} placeholder={t("Tên người gửi…")} disabled={add.isPending}
          className="w-32 bg-transparent text-ink outline-none placeholder:text-ink-3" />
      </label>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} align="start" className="z-50 outline-none">
          <Combobox.Popup className={cn(POPUP, "w-64")}>
            <Combobox.Empty className="text-xs text-ink-3 empty:hidden">
              <p className="px-2.5 py-1.5">{people.isError ? t("Không tải được danh sách người gửi.") : people.isPending ? t("Đang tải…") : t("Không thấy ai khớp")}</p>
            </Combobox.Empty>
            <Combobox.List>
              {(m: Member) => <Combobox.Item key={m.user_id} value={m} className={OPTION}><span className="truncate">{m.name}{twins.has(m.name) && <span className="font-mono text-xs text-ink-3"> #{m.user_id}</span>}</span></Combobox.Item>}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
