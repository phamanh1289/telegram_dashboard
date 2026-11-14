"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { Told } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { useT } from "@/shared/lib/i18n";
import { type Ticket, yt } from "@/features/youtrack/lib/yt";
import { Avatar, Picker, Prio, StatePill } from "./bits";
import { useYt } from "./state";
import { useFlow } from "./workflow";

/** Change the picked tickets at once: Assignee / State / Priority apply on pick (5 calls at a time), the toast puts each one back. */
export function BulkBar() {
  const t = useT();
  const y = useYt();
  const flow = useFlow(y.project);
  const [busy, setBusy] = useState(false);
  const write = !y.config?.mock;
  const fields = useQuery({ queryKey: ["yt", "fields", y.project], queryFn: () => yt.fields(y.project), staleTime: Infinity, enabled: write });
  const ids = [...y.picked];
  async function apply(label: string, prevOf: (x: Ticket) => string | null, call: (id: string, v: string | null) => Promise<Ticket>, v: string | null, nullable = false, allowed?: (x: Ticket) => boolean) {
    const changed = ids.map((id) => y.rows.find((i) => i.id === id)).filter((x): x is Ticket => !!x && prevOf(x) !== v);
    const todo = allowed ? changed.filter(allowed) : changed;
    const off = changed.length - todo.length; // "Áp dụng" workflow: no arrow from their State to this one
    const offText = off ? t("{n} ticket không có mũi tên sang {label} trong workflow", { n: off, label }) : "";
    if (!todo.length) { toast({ text: offText || t("Không có gì thay đổi") }); return; }
    setBusy(true);
    const done: [string, string | null][] = [], fail: string[] = [], failed = new Set<string>();
    for (let k = 0; k < todo.length; k += 5) await Promise.all(todo.slice(k, k + 5).map(async (x) => {
      try { await y.patchTicket(await call(x.id, v)); done.push([x.id, prevOf(x)]); } catch (e) { fail.push(`${x.id}: ${(e as Error).message}`); failed.add(x.id); }
    }));
    setBusy(false);
    const err = [offText, fail.length ? t("Lỗi {n} ticket — {first}", { n: fail.length, first: fail[0] }) : ""].filter(Boolean).join(". ");
    if (!done.length) { toast({ text: err }); return; }
    toast({ text: `${done.length === 1 ? done[0][0] : t("{n} ticket", { n: done.length })} → ${label}${err ? `. ${err}` : ""}`, undo: async () => {
      const back = done.filter(([, prev]) => prev !== null || nullable), bad: string[] = [];
      for (const [id, prev] of back) await call(id, prev).then(y.patchTicket, (e: Error) => { bad.push(`${id}: ${e.message}`); });
      if (bad.length) throw new Told(`${bad.length < back.length ? t("Chỉ hoàn tác được {n}/{all} ticket", { n: back.length - bad.length, all: back.length }) : t("Không hoàn tác được")} — ${bad[0]}`);
    } });
    y.setPicked(failed); // the failed ones stay picked: try again
  }
  const none = "\u0000"; // nothing ticked in the list: every pick is a change
  const bar = "h-8 bg-board-type/15 px-2.5 text-board-type hover:bg-board-type/25 aria-expanded:bg-board-type/25";
  const person = (p: { login: string; name: string }) => ({ v: p.login, text: p.name, node: <><Avatar name={p.name} /><span className="truncate">{p.name}</span></> });
  const field = (name: "State" | "Priority", node: (v: string) => React.ReactNode) => (fields.data?.[name]?.length ? (
    <Picker label={name} title={t("Đổi {name} cho các ticket đã chọn", { name })} value={none} disabled={busy} className={bar}
      options={fields.data[name]!.map((v) => ({ v, node: node(v) }))}
      onPick={(v) => void apply(v, (x) => (name === "State" ? x.state : x.priority), (id, x) => yt.setField(id, name, x!), v, false,
        name === "State" ? (x) => { const f = flow(x.state); return !f || f.includes(v); } : undefined)} />
  ) : null);
  return (
    <motion.div role="region" aria-label={t("Thao tác hàng loạt")} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      className="flex flex-wrap items-center gap-2 rounded-lg bg-board px-3 py-2 text-sm text-board-type">
      <b className="font-bold">{t("{n} ticket đã chọn", { n: ids.length })}</b>
      {write && <>
        <Picker label="Assignee" title={t("Đổi assignee cho các ticket đã chọn")} value={none} disabled={busy} search={t("Tìm người…")} className={bar}
          options={[{ v: "", text: t("Chưa assign"), node: <span className="text-ink-2">{t("Chưa assign")}</span> }, ...y.people.map(person)]}
          onPick={(login) => void apply(y.people.find((p) => p.login === login)?.name ?? t("Chưa assign"), (x) => x.assigneeLogin, (id, l) => yt.setAssignee(id, l), login || null, true)} />
        {field("State", (v) => <StatePill state={v} />)}
        {field("Priority", (v) => <Prio p={v} />)}
        {busy && <span role="status" className="text-xs opacity-80">{t("Đang cập nhật…")}</span>}
      </>}
      {y.aiOn && (
        <Hint side="bottom" text={t(y.mode === "dev" ? "Hỏi AI về các ticket đã chọn, có thể trace code trong thư mục dự án" : "Hỏi AI về các ticket đã chọn")}><Button size="sm" variant="outline"
          onClick={() => y.setSheet({ kind: "work", title: "AI", ids })}><Sparkles /> AI</Button></Hint>
      )}
      <Button size="sm" variant="ghost" className="ml-auto text-board-type hover:bg-board-type/15 hover:text-board-type" onClick={() => y.setPicked(new Set())}>{t("Bỏ chọn")}</Button>
    </motion.div>
  );
}
