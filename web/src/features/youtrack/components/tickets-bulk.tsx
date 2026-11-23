"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { Told } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { t as tNow, useT } from "@/shared/lib/i18n";
import { type Ticket, yt, ytFieldsQuery } from "@/features/youtrack/lib/yt";
import { Avatar, Picker, Prio, StatePill } from "./bits";
import { saveTicket, type TicketPatch, useYt } from "./state";
import { useFlow } from "./workflow";

type Edit = [Ticket, Partial<Ticket>]; // a ticket as it is now, and the values to put on it
/** One change on many tickets, 5 calls at a time, each through `saveTicket`: shown at once, and its answer never lands
 *  over a newer edit of the same ticket. Returns the tickets done and [id, reason] of each failure. */
export async function saveMany(patch: (t: TicketPatch) => Promise<void>, edits: Edit[], call: (x: Ticket) => Promise<Ticket>) {
  const done: Ticket[] = [], fail: [string, string][] = [];
  for (let k = 0; k < edits.length; k += 5) await Promise.all(edits.slice(k, k + 5).map(([x, local]) =>
    saveTicket(patch, x, local, () => call(x), { quiet: true }).then(() => { done.push(x); }, (e: Error) => { fail.push([x.id, e.message]); })));
  return { done, fail };
}
/** A toast's undo of `saveMany`: every ticket is tried; a partial failure says how many went back and the first reason. */
export async function undoMany(patch: (t: TicketPatch) => Promise<void>, edits: Edit[], call: (x: Ticket) => Promise<Ticket>) {
  const { fail } = await saveMany(patch, edits, call), n = edits.length;
  if (fail.length) throw new Told(`${fail.length < n ? tNow("Chỉ hoàn tác được {n}/{all} ticket", { n: n - fail.length, all: n }) : tNow("Không hoàn tác được")} — ${fail[0].join(": ")}`);
}

/** Change the picked tickets at once: Assignee / State / Priority apply on pick (5 calls at a time), the toast puts each one back. */
export function BulkBar() {
  const t = useT();
  const y = useYt();
  const flow = useFlow(y.project);
  const [busy, setBusy] = useState(false);
  const write = !y.config?.mock;
  const fields = useQuery({ ...ytFieldsQuery(y.project), enabled: write });
  const ids = [...y.picked];
  async function apply(label: string, prevOf: (x: Ticket) => string | null, call: (id: string, v: string | null) => Promise<Ticket>, v: string | null, local: Partial<Ticket>, nullable = false, allowed?: (x: Ticket) => boolean) {
    const changed = ids.map((id) => y.rows.find((i) => i.id === id)).filter((x): x is Ticket => !!x && prevOf(x) !== v);
    const todo = allowed ? changed.filter(allowed) : changed;
    const off = changed.length - todo.length; // "Áp dụng" workflow: no arrow from their State to this one
    const offText = off ? t("{n} ticket không có mũi tên sang {label} trong workflow", { n: off, label }) : "";
    if (!todo.length) { toast({ text: offText || t("Không có gì thay đổi") }); return; }
    setBusy(true);
    const { done, fail } = await saveMany(y.patchTicket, todo.map((x) => [x, local]), (x) => call(x.id, v));
    setBusy(false);
    const err = [offText, fail.length ? t("Lỗi {n} ticket — {first}", { n: fail.length, first: fail[0].join(": ") }) : ""].filter(Boolean).join(". ");
    if (!done.length) { toast({ text: err }); return; }
    const keys = Object.keys(local) as (keyof Ticket)[], prev = new Map(done.map((x) => [x.id, prevOf(x)]));
    toast({ text: `${done.length === 1 ? done[0].id : t("{n} ticket", { n: done.length })} → ${label}${err ? `. ${err}` : ""}`,
      undo: () => undoMany(y.patchTicket, done.filter((x) => prevOf(x) !== null || nullable).map((x) => [{ ...x, ...local }, Object.fromEntries(keys.map((k) => [k, x[k] ?? null])) as Partial<Ticket>]),
        (x) => call(x.id, prev.get(x.id) ?? null)) });
    y.setPicked(new Set(fail.map(([id]) => id))); // the failed ones stay picked: try again
  }
  const none = "\u0000"; // nothing ticked in the list: every pick is a change
  const bar = "h-8 bg-board-type/15 px-2.5 text-board-type hover:bg-board-type/25 aria-expanded:bg-board-type/25";
  const person = (p: { login: string; name: string }) => ({ v: p.login, text: p.name, node: <><Avatar name={p.name} /><span className="truncate">{p.name}</span></> });
  const field = (name: "State" | "Priority", node: (v: string) => React.ReactNode) => (fields.data?.[name]?.length ? (
    <Picker label={name} title={t("Đổi {name} cho các ticket đã chọn", { name })} value={none} disabled={busy} className={bar}
      options={fields.data[name]!.map((v) => ({ v, node: node(v) }))}
      onPick={(v) => void apply(v, (x) => (name === "State" ? x.state : x.priority), (id, x) => yt.setField(id, name, x!), v, name === "State" ? { state: v } : { priority: v }, false,
        name === "State" ? (x) => { const f = flow(x.state); return !f || f.includes(v); } : undefined)} />
  ) : null);
  return (
    <motion.div role="region" aria-label={t("Thao tác hàng loạt")} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      className="flex flex-wrap items-center gap-2 rounded-lg bg-board px-3 py-2 text-sm text-board-type">
      <b className="font-bold">{t("{n} ticket đã chọn", { n: ids.length })}</b>
      {write && <>
        <Picker label="Assignee" title={t("Đổi assignee cho các ticket đã chọn")} value={none} disabled={busy} search={t("Tìm người…")} className={bar}
          options={[{ v: "", text: t("Chưa assign"), node: <span className="text-ink-2">{t("Chưa assign")}</span> }, ...y.people.map(person)]}
          onPick={(login) => { const name = y.people.find((p) => p.login === login)?.name ?? null;
            void apply(name ?? t("Chưa assign"), (x) => x.assigneeLogin, (id, l) => yt.setAssignee(id, l), login || null, { assignee: name, assigneeLogin: login || null }, true); }} />
        {field("State", (v) => <StatePill state={v} />)}
        {field("Priority", (v) => <Prio p={v} />)}
        {fields.isError && <span role="alert" className="text-xs opacity-80">{t("Không tải được State / Priority: {msg}", { msg: fields.error.message })}</span>}
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
