"use client";

import { Combobox } from "@base-ui/react/combobox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bot, Forward, Hash, type LucideIcon, Plus, Star, UserX, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { OPTION, POPUP } from "@/shared/components/ui/dropdown";
import { PILL_SPRING } from "@/shared/components/ui/segmented";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { api, errorText, type Member, type Rule, type RuleAdded } from "@/shared/lib/api";
import { type Key, t as tPlain, useT } from "@/shared/lib/i18n";
import { ignoreSender } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { aboutMe, useRole, usesCode } from "@/shared/lib/prefs";
import { fold } from "@/shared/lib/utils";
import { cn } from "@/shared/lib/utils";

/** Every rule kind: its row name, one line on what it does, the icon and the colours of its chips. */
const KINDS: { kind: Rule["kind"]; label: Key; desc: Key; icon: LucideIcon; wash: string; ink: string }[] = [
  { kind: "sender", label: "Người gửi", desc: "Tag của họ tự sang Đã xử lý; tin của họ không vào Briefing / Digest.", icon: UserX, wash: "bg-error-wash", ink: "text-error" },
  { kind: "keyword", label: "Từ khóa", desc: "Tag có chứa từ này tự sang Đã xử lý, không báo.", icon: Hash, wash: "bg-warn-wash", ink: "text-warn" },
  { kind: "priority", label: "Luôn ưu tiên", desc: "Tag của họ lên đầu Việc cần xử lý, quá hạn ở nửa ngưỡng.", icon: Star, wash: "bg-ok-wash", ink: "text-ok" },
  { kind: "relay", label: "Tự chuyển vào phiên", desc: "Trả lời của họ cho câu hỏi phiên AI Agent đã gửi tự chạy tiếp trong phiên đó.", icon: Forward, wash: "bg-info-wash", ink: "text-info" },
  { kind: "agent", label: "Tự giao AI Agent", desc: "Mỗi tin mới của họ tự mở một phiên AI Agent chỉ đọc.", icon: Bot, wash: "bg-hl-wash", ink: "text-hl" },
  // who an AI Agent session's ask to BE / PO / QC tags (ai.role_tags): in its prompt, and added on send when missing
  { kind: "tag_be", label: "Bot BE", desc: "Được tag ở đầu câu hỏi phiên AI gửi BE.", icon: AtSign, wash: "bg-info-wash", ink: "text-info" },
  { kind: "tag_po", label: "PO", desc: "Được tag ở đầu câu hỏi phiên AI gửi PO.", icon: AtSign, wash: "bg-info-wash", ink: "text-info" },
  { kind: "tag_qc", label: "QC", desc: "Được tag ở đầu câu hỏi phiên AI gửi QC.", icon: AtSign, wash: "bg-info-wash", ink: "text-info" },
];
const isTag = (kind: Rule["kind"]) => kind.startsWith("tag_");

export const rulesQuery = { queryKey: ["rules"], queryFn: ({ signal }: { signal: AbortSignal }) => api<Rule[]>("/rules", { signal }) };

/** How many rules of these kinds exist: the count beside a folded Settings card's title. */
export function RulesCount({ kinds }: { kinds: Rule["kind"][] }) {
  const n = useQuery({ ...rulesQuery, select: (rs) => rs.filter((r) => kinds.includes(r.kind)).length }).data;
  return n ? <span className="font-mono text-2xs font-normal text-ink-3">{n}</span> : null;
}

export const POP = { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.6 }, transition: PILL_SPRING } as const;
export const ADD_CHIP = "flex h-7 items-center gap-1 rounded-full border border-dashed border-rule-2 bg-transparent pr-1.5 pl-2 text-xs text-ink-3 transition-colors duration-(--dur-micro) hover:border-hl hover:text-ink focus-within:border-hl data-popup-open:border-hl data-popup-open:text-ink";

/** The rules of the given kinds, one row each (name + what it does on the left, chips on the right; stacked when
 *  narrow): auto-handled senders / keywords, senders that go first or feed AI Agent sessions, who AI asks tag.
 *  Lives in Settings, one card per concern; add / remove pop in place. */
export function RulesSection({ kinds }: { kinds: Rule["kind"][] }) {
  const t = useT();
  const qc = useQueryClient();
  const code = usesCode(useRole()); // QA / PO have no rules that run AI Agent sessions
  const [keyword, setKeyword] = useState("");
  const rules = useQuery(rulesQuery);
  const add = useMutation({
    mutationFn: (value: string) => api<RuleAdded>("/rules", { method: "POST", json: { kind: "keyword", value } }),
    onSuccess: (r) => { setKeyword(""); if (r.handled) toast({ text: tPlain("Đã thêm, dọn {n} tin đang chờ.", { n: r.handled }) }); },
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không thêm được quy tắc, thử lại")) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const remove = useMutation({
    mutationFn: (r: Rule) => api<void>(`/rules/${r.id}`, { method: "DELETE" }),
    onMutate: async (r) => { // the chip leaves at once; a failure brings it back with the refetch
      await qc.cancelQueries({ queryKey: ["rules"] });
      qc.setQueryData<Rule[]>(["rules"], (rs) => rs?.filter((x) => x.id !== r.id));
    },
    // Undo adds the same rule back (relay / agent: with its project and who you are, as the Hoãn menu sends them)
    onSuccess: (_, r) => toast({
      text: tPlain("Đã gỡ {name}", { name: chipName(r) }),
      undo: () => api<RuleAdded>("/rules", { method: "POST", json: { kind: r.kind, value: r.value, label: r.label, project: r.project, ...aboutMe() } })
        .finally(() => qc.invalidateQueries({ queryKey: ["rules"] })),
    }),
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

  return <>
    {KINDS.filter((k) => kinds.includes(k.kind)).map(({ kind, label, desc, icon: Icon, wash, ink }) => {
      const list = rules.data.filter((r) => r.kind === kind);
      if (!list.length && !code && (kind === "relay" || kind === "agent")) return null;
      const adder = kind !== "relay" && kind !== "agent"; // those need a project: added from a tag's Hoãn menu
      return (
        <section key={kind} aria-label={t(label)} className="@container py-3 first:pt-1 last:pb-0">
          <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-[18rem_minmax(0,1fr)] @2xl:gap-6">
            <div className="grid content-start gap-0.5">
              <h4 className="flex items-center gap-2 text-sm font-medium text-ink">
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", wash)}><Icon className={cn("size-3.5", ink)} aria-hidden /></span>
                {t(label)}
                {list.length > 0 && <span className="rounded-full bg-paper-2 px-1.5 font-mono text-2xs font-normal text-ink-3">{list.length}</span>}
              </h4>
              <p className="pl-8 text-xs leading-relaxed text-ink-3">{t(desc)}</p>
            </div>
            <ul className="flex flex-wrap content-start items-center gap-1.5 pl-8 @2xl:pl-0">
              <AnimatePresence initial={false} mode="popLayout">
                {list.map((r) => {
                  const name = chipName(r);
                  return (
                    <motion.li key={r.id} layout {...POP}
                      className={cn("flex h-7 max-w-full min-w-0 items-center gap-1 rounded-full pr-0.5 pl-2.5 text-xs font-medium text-ink", wash)}>
                      <span className="truncate">{name}</span>
                      {r.project && <span className="shrink-0 text-ink-3">· {r.project.split("/").pop()}</span>}
                      <button type="button" aria-label={t("Xóa {name}", { name })} onClick={() => remove.mutate(r)}
                        className={cn("grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-(--dur-micro) hover:bg-cotton/70 focus-visible:outline-2 focus-visible:outline-(--color-focus)", ink)}>
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </motion.li>
                  );
                })}
                {!list.length && !adder && (
                  <motion.li key="empty" layout="position" {...POP} className="text-xs leading-7 text-ink-3">{t("Chưa có, thêm từ menu Hoãn của một tin.")}</motion.li>
                )}
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
                {kind === "sender" && (
                  <motion.li key="add" layout="position" className="flex">
                    <SenderPicker taken={list.map((r) => r.value)} label={t("Thêm người gửi bỏ qua")}
                      pick={(m) => ignoreSender({ sender_id: m.user_id, sender_name: m.name })} />
                  </motion.li>
                )}
                {(kind === "priority" || isTag(kind)) && (
                  <motion.li key="add" layout="position" className="flex">
                    <SenderPicker taken={list.map((r) => r.value)} label={kind === "priority" ? t("Người gửi luôn ưu tiên") : t("Tag {role} khi AI Agent hỏi", { role: t(label) })}
                      pick={(m) => api<RuleAdded>("/rules", { method: "POST", json: { kind, value: m.user_id, label: m.name } })} />
                  </motion.li>
                )}
              </AnimatePresence>
            </ul>
          </div>
        </section>
      );
    })}
  </>;
}

const chipName = (r: Rule) => (r.kind === "keyword" ? r.value : r.label || `#${r.value}`);

/** Type a name, pick one of the people seen writing in saved messages (/senders); `pick` saves the rule (ignore: same
 *  rule, toast and Undo as "Luôn bỏ qua …" in a tag's Hoãn menu). */
function SenderPicker({ taken, label, pick }: { taken: string[]; label: string; pick: (m: Member) => Promise<unknown> }) {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const people = useQuery({ queryKey: ["senders"], queryFn: ({ signal }) => api<Member[]>("/senders", { signal }), staleTime: 60_000 });
  const add = useMutation({
    mutationFn: pick,
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
        <Combobox.Input aria-label={label} placeholder={t("Tên người gửi…")} disabled={add.isPending}
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
