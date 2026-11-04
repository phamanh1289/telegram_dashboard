"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type YouTrackIssue } from "@/lib/api";
import { toast } from "@/lib/inbox";
import { yt } from "@/lib/yt";
import { useYt } from "./state";

// A new ticket from the YouTrack tab: type a rough note, the AI fills summary / Type / Priority / a templated description,
// open tickets that look the same are shown before it is created. Same create API as the Telegram composer.

export function CreateTicket() {
  const y = useYt();
  const open = y.newTicket != null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) y.setNewTicket(null); }}>
      <DialogContent className="flex flex-col sm:max-w-2xl">
        {open && <Form key={y.newTicket} note={y.newTicket!} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ note: start }: { note: string }) {
  const y = useYt();
  const [note, setNote] = useState(start);
  const [summary, setSummary] = useState(() => start.split("\n")[0].slice(0, 200));
  const [desc, setDesc] = useState(start.includes("\n") ? start : "");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState(() => (y.me ? y.loginOf.get(y.me) ?? "" : ""));
  const fields = useQuery({ queryKey: ["yt", "fields", y.project], queryFn: () => yt.fields(y.project), staleTime: Infinity, enabled: !y.config?.mock });
  const q = useDeferredValue(summary.trim());
  const similar = useQuery({
    queryKey: ["youtrack-similar", q, y.project],
    queryFn: ({ signal }) => api<YouTrackIssue[]>(`/youtrack/similar?q=${encodeURIComponent(q)}&project=${encodeURIComponent(y.project)}`, { signal }),
    enabled: q.length > 8, staleTime: 60_000,
  });
  const draft = useMutation({
    mutationFn: () => yt.aiDraft(note.trim(), fields.data?.Type ?? [], fields.data?.Priority ?? []),
    onSuccess: (r) => {
      if (r.summary) setSummary(r.summary);
      setDesc(r.description);
      if (r.type) setType(r.type);
      if (r.priority) setPriority(r.priority);
    },
    onError: (e) => toast({ text: `AI soạn lỗi: ${(e as Error).message}` }),
  });
  const create = useMutation({
    mutationFn: () => api<YouTrackIssue>("/youtrack/issues", { method: "POST", json: {
      summary: summary.trim(), description: desc, project: y.project, type: type || null, priority: priority || null, assignee: assignee || null } }),
    onSuccess: (r) => {
      toast({ text: r.warning ? `Đã tạo ${r.id}, chưa đặt được Type / Priority / Assignee: ${r.warning}` : `Đã tạo ${r.id}` });
      y.setNewTicket(null);
      y.refresh();
      y.openTicket(r.id);
    },
    onError: (e) => toast({ text: `Không tạo được: ${(e as Error).message}` }),
  });
  const sel = "h-8 min-w-0 rounded-md border border-rule bg-cotton px-2 text-sm";
  const field = (label: string, v: string, set: (v: string) => void, opts: [string, string][]) => (
    <label className="grid gap-1 text-xs text-ink-3">{label}
      <select className={sel} value={v} onChange={(e) => set(e.target.value)}>
        <option value="">Mặc định</option>
        {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <DialogTitle>Tạo ticket · {y.project}</DialogTitle>
      <DialogDescription>Gõ hoặc dán ghi chú thô (lỗi gặp phải, yêu cầu của khách…), để AI soạn theo mẫu, sửa lại rồi tạo.</DialogDescription>
      {y.aiOn && (
        <div className="grid gap-2 rounded-lg bg-paper-2 p-3">
          <Textarea rows={3} maxLength={8000} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Ghi chú thô cho AI"
            placeholder="vd. Màn chốt giá trên Android bấm Ký sau bị crash khi chưa có hợp đồng, máy Samsung A52, bản 3.2.1" />
          <Button size="sm" variant="outline" className="justify-self-end" disabled={!note.trim() || draft.isPending} aria-busy={draft.isPending} onClick={() => draft.mutate()}>
            {draft.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {draft.isPending ? "AI đang soạn…" : "AI soạn ticket"}
          </Button>
        </div>
      )}
      <label className="grid gap-1 text-xs text-ink-3">Tiêu đề
        <Input value={summary} maxLength={300} onChange={(e) => setSummary(e.target.value)} placeholder="Một dòng nêu vấn đề / yêu cầu" />
      </label>
      {!!similar.data?.length && (
        <div className="grid gap-1 rounded-lg bg-warn-wash px-3 py-2 text-xs">
          <span className="font-medium text-warn">Có ticket đang mở giống thế này, kiểm tra trước khi tạo:</span>
          {similar.data.map((i) => (
            <button key={i.id} type="button" onClick={() => y.openTicket(i.id)} className="flex gap-2 text-left text-ink-2 hover:text-ink">
              <b className="shrink-0 font-mono">{i.id}</b><span className="truncate">{i.summary}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {field("Type", type, setType, (fields.data?.Type ?? []).map((v) => [v, v]))}
        {field("Priority", priority, setPriority, (fields.data?.Priority ?? []).map((v) => [v, v]))}
        {field("Assignee", assignee, setAssignee, y.people.map((p) => [p.login, p.name]))}
      </div>
      <label className="grid gap-1 text-xs text-ink-3">Mô tả (Markdown)
        <Textarea rows={10} maxLength={20000} value={desc} onChange={(e) => setDesc(e.target.value)} className="font-mono text-sm" />
      </label>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Hủy</DialogClose>
        <Button type="button" disabled={!summary.trim() || create.isPending || !!y.config?.mock} aria-busy={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Tạo ticket
        </Button>
      </DialogFooter>
    </>
  );
}
