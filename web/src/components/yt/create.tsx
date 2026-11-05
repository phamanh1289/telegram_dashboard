"use client";

import { TicketForm } from "@/components/ticket-form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api, type YouTrackIssue } from "@/lib/api";
import { toast } from "@/lib/inbox";
import { yt } from "@/lib/yt";
import { useYt } from "./state";

// A new ticket from the YouTrack tab: typed by hand, or a rough note the AI turns into summary / Type / Priority / description.
// Open tickets that look the same are shown before it is created. Same create API as the Telegram composer.

export function CreateTicket() {
  const y = useYt();
  const start = y.newTicket ?? "";
  return (
    <Dialog open={y.newTicket != null} onOpenChange={(o) => { if (!o) y.setNewTicket(null); }}>
      <DialogContent className="flex flex-col sm:max-w-2xl">
        <TicketForm
          title={<>Tạo ticket <span className="rounded bg-paper-2 px-1.5 font-mono text-xs font-medium text-ink-2">{y.project}</span></>}
          hint="Tự điền, hoặc kể vấn đề cho AI soạn theo mẫu rồi sửa lại trước khi tạo."
          project={y.project}
          initial={{ summary: start.split("\n")[0].slice(0, 200), description: start.includes("\n") ? start : "" }}
          meta={{ assignee: y.me ? y.loginOf.get(y.me) ?? "" : "" }}
          note={start}
          notePlaceholder="vd. Màn chốt giá trên Android bấm Ký sau bị crash khi chưa có hợp đồng, máy Samsung A52, bản 3.2.1"
          aiOn={y.aiOn}
          aiDraft={(note, f) => yt.aiDraft(note, f.types, f.priorities)}
          onSubmit={async (v) => {
            const r = await api<YouTrackIssue>("/youtrack/issues", { method: "POST", json: {
              summary: v.summary, description: v.description, markdown: v.markdown, project: v.project,
              type: v.type || null, priority: v.priority || null, assignee: v.assignee || null } });
            toast({ text: r.warning ? `Đã tạo ${r.id}. ${r.warning}` : `Đã tạo ${r.id}` });
            y.setNewTicket(null);
            y.refresh();
            y.openTicket(r.id);
          }}
          onOpenTicket={y.openTicket}
          demo={!!y.config?.mock}
        />
      </DialogContent>
    </Dialog>
  );
}
