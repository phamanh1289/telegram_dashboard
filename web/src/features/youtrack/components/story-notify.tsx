"use client";

import { Check, Loader2, Plus, Send, Settings2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { Picker } from "@/features/youtrack/components/bits";
import { Avatar } from "@/shared/components/avatar";
import { type MentionSource, useMention } from "@/shared/components/mention";
import { Button } from "@/shared/components/ui/button";
import { Fold } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import type { Member } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { isString, put, readList, setPref } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

// Cập nhật story › Báo cho ai: one message box per platform (a YouTrack comment, a Telegram message). Each is typed
// freely, "@" lists that platform's own people, quick groups (Android, iOS, FE, BE, QA/QC…) add theirs in one click,
// and each has its own send button: neither waits for the other, nor for the description's "Lưu".

/** People as chips: × drops one, "Thêm người" picks another from `all` (that platform's own list). `who`: the group's
 *  people, shown whether or not `all` has them. */
function People({ label, all, who, onAdd, onDrop }: { label: string; all: Member[]; who: Member[]; onAdd: (m: Member) => void; onDrop: (id: string) => void }) {
  const t = useT();
  const rest = all.filter((m) => !who.some((w) => w.user_id === m.user_id));
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-xs text-ink-3 tabular-nums">{t("{n} người", { n: who.length })}</span>
      <AnimatePresence initial={false} mode="popLayout">
        {who.map((m) => (
          <motion.span key={m.user_id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.12 }}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-paper-3 px-1 text-xs text-ink">
            <Avatar name={m.name} className="size-5" />
            <span className="min-w-0 truncate">{m.name}</span>
            <button type="button" aria-label={t("Bỏ {name} khỏi nhóm", { name: m.name })} onClick={() => onDrop(m.user_id)}
              className="grid size-5 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-(--dur-micro) hover:bg-paper-2 hover:text-ink">
              <X className="size-3" aria-hidden />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      {!!rest.length && (
        <Picker title={t("Thêm người")} value="" search={t("Tìm người…")} onPick={(v) => { const m = rest.find((x) => x.user_id === v); if (m) onAdd(m); }}
          label={<span className="inline-flex items-center gap-1 text-xs text-ink-2"><Plus className="size-3.5" aria-hidden />{t("Thêm người")}</span>}
          options={rest.map((m) => ({ v: m.user_id, text: `${m.name} ${m.username ?? ""}`, hint: m.username ? `@${m.username}` : undefined,
            node: <><Avatar name={m.name} className="size-5" /><span className="min-w-0 truncate">{m.name}</span></> }))} />
      )}
    </div>
  );
}

/** A quick-tag group: its name and who is in it, by that platform's id (YouTrack login, Telegram user id). `known`: the
 *  people as last seen (name, @username), kept beside the ids (this browser's preference) so the group reads the same
 *  before its list is loaded: a Telegram box has no members until a group is picked. */
type QuickGroup = { name: string; ids: string[]; known?: Member[] };
type Quick = Required<QuickGroup>;
const QUICK = ["Android", "iOS", "FE", "BE", "QA/QC"];
const isMember = (x: unknown): x is Member => {
  const m = x as Member | null;
  return !!m && typeof m.user_id === "string" && typeof m.name === "string";
};
const isGroup = (x: unknown): x is QuickGroup => {
  const g = x as QuickGroup | null;
  return !!g && typeof g.name === "string" && Array.isArray(g.ids) && g.ids.every(isString) && (g.known === undefined || (Array.isArray(g.known) && g.known.every(isMember)));
};
/** Who is in the group: as the live list has them (a name changed since), else as remembered. */
const people = (g: QuickGroup, all: Member[]): Member[] => g.ids.flatMap((id) => {
  const m = all.find((x) => x.user_id === id) ?? g.known?.find((x) => x.user_id === id);
  return m ? [{ user_id: m.user_id, name: m.name, username: m.username }] : [];
});
// ponytail: kept per browser (prefs); move to the server's team settings when the team needs to share one set
function useQuick(key: string, all: Member[]) {
  const [saved, set] = useState(() => readList<QuickGroup>(key, QUICK.map((name) => ({ name, ids: [] })), isGroup));
  const groups: Quick[] = saved.map((g) => ({ ...g, known: people(g, all) }));
  const json = JSON.stringify(groups);
  // names found on a list just loaded (a group saved as ids only, a name changed since) are kept for the next open
  useEffect(() => { if (all.length) put(key, json); }, [all.length, key, json]);
  return [groups, (g: Quick[]) => { set(g); setPref(key, JSON.stringify(g)); }] as const;
}

/** One platform's message: free text (`start`: the ready-made line, until typed over), "@" lists `source`'s people.
 *  `known`: "@Name" → id of tags the ready-made line holds for people without a @username. `wired`: the text as sent. */
export function useNote<T>(source: MentionSource<T>, start: string, known?: Record<string, string>) {
  const [typed, setText] = useState<string | null>(null);
  const text = typed ?? start;
  const [named, setNamed] = useState<Record<string, string>>({}); // "@Name" → id put in by a quick group
  const { attach, ...mention } = useMention(source, text, setText, { ...known, ...named }); // attach: the box's ref, handed over apart
  /** Tags these people at the start of the text; those already tagged are left alone. */
  const add = (who: Member[]) => {
    const tags = who.map((m) => `@${m.username || m.name}`).filter((tag) => !text.includes(tag));
    setNamed((n) => ({ ...n, ...Object.fromEntries(who.filter((m) => !m.username).map((m) => [`@${m.name}`, m.user_id])) }));
    if (tags.length) setText(`${tags.join(" ")} ${text}`);
  };
  return { attach, text, setText, mention, add, wired: mention.wire(text.trim()), reset: () => setText(null) };
}
export type Note = Omit<ReturnType<typeof useNote>, "attach">;

const CHIP = "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs transition-colors duration-(--dur-micro)";

/** The box of one platform. `all`: its people (quick groups pick from them; `none`: why there are none to pick yet).
 *  `quickKey`: where its quick groups are kept. `send.sent`: this very text is already out. `head`: beside the label
 *  (the Telegram groups). `foot`: a note under it. */
export function NoteBox({ label, head, note, attach, all, none, quickKey, send, foot }: {
  label: string; head?: ReactNode; note: Note; attach: (el: HTMLTextAreaElement | null) => void; all: Member[]; none?: string; quickKey: string; foot?: ReactNode;
  send: { run: () => void; label: string; hint: string; busy?: boolean; sent?: boolean; off?: boolean };
}) {
  const t = useT();
  const [groups, save] = useQuick(quickKey, all);
  const [editing, setEditing] = useState(false);
  const change = (k: number, g: Quick) => save(groups.map((x, i) => (i === k ? g : x)));
  return (
    <section aria-label={label} className="grid grid-cols-1 gap-1.5 rounded-lg bg-paper-2 p-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-medium text-ink-2">{label}</span>
        {head}
      </div>
      <div className="relative">
        <Textarea ref={attach} value={note.text} maxLength={4000} aria-label={label} placeholder={t("Gõ @ để tag người")} className="min-h-16"
          onChange={(e) => { note.setText(e.target.value); note.mention.track(e); }} onSelect={note.mention.track} onKeyDown={(e) => { note.mention.onKeyDown(e); }} />
        {note.mention.popup}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label={t("Tag nhanh theo nhóm")} className="flex min-w-0 flex-wrap items-center gap-1">
          {groups.map((g, k) => {
            const who = g.known;
            return (
              <Hint key={k} side="bottom" text={who.length ? t("Tag {names}", { names: who.map((m) => m.name).join(", ") }) : t("Chưa có ai trong nhóm này: bấm để thêm người")}>
                <button type="button" onClick={() => (who.length ? note.add(who) : setEditing(true))}
                  className={cn(CHIP, who.length ? "bg-paper-3 text-ink hover:bg-hl-wash hover:text-hl-2" : "border border-dashed border-rule-2 text-ink-3 hover:text-ink")}>
                  {g.name || t("Nhóm mới")}{!!who.length && <span className="text-ink-3">{who.length}</span>}
                </button>
              </Hint>
            );
          })}
          <Hint side="bottom" text={t("Sửa nhóm tag nhanh: đổi tên, thêm / bớt người, thêm nhóm")}>
            <button type="button" aria-label={t("Sửa nhóm tag nhanh")} aria-expanded={editing} onClick={() => setEditing(!editing)}
              className={cn("grid size-6 place-items-center rounded-full text-ink-3 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink", editing && "bg-paper-3 text-ink")}>
              <Settings2 className="size-3.5" aria-hidden />
            </button>
          </Hint>
        </div>
        <span className="ml-auto" />
        <Hint side="bottom" text={send.hint}>
          <Button type="button" size="sm" variant="outline" disabled={send.off || send.busy || send.sent || !note.text.trim()} aria-busy={send.busy} onClick={send.run}>
            {send.busy ? <Loader2 className="animate-spin" aria-hidden /> : send.sent ? <Check aria-hidden /> : <Send aria-hidden />} {send.label}
          </Button>
        </Hint>
      </div>
      <Fold open={editing}>
        <div className="grid grid-cols-1 gap-2 rounded-md bg-paper p-2">
          {!all.length && !!none && <p className="text-xs text-ink-3">{none}</p>}
          {groups.map((g, k) => (
            <div key={k} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-start gap-2">
              <Input value={g.name} maxLength={20} placeholder={t("Tên nhóm")} aria-label={t("Tên nhóm tag")} className="h-7 px-2 text-xs md:text-xs"
                onChange={(e) => change(k, { ...g, name: e.target.value })} />
              <People label={t("Người trong nhóm {name}", { name: g.name })} all={all} who={g.known}
                onAdd={(m) => change(k, { ...g, ids: [...g.ids, m.user_id], known: [...g.known, m] })}
                onDrop={(id) => change(k, { ...g, ids: g.ids.filter((x) => x !== id), known: g.known.filter((m) => m.user_id !== id) })} />
              <button type="button" aria-label={t("Xóa nhóm {name}", { name: g.name })} onClick={() => save(groups.filter((_, i) => i !== k))}
                className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors duration-(--dur-micro) hover:bg-error-wash hover:text-error">
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <Button type="button" size="xs" variant="ghost" className="justify-self-start text-ink-2" onClick={() => save([...groups, { name: "", ids: [], known: [] }])}><Plus aria-hidden /> {t("Thêm nhóm")}</Button>
        </div>
      </Fold>
      {foot}
    </section>
  );
}
