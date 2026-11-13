"use client";

import { createTicket, TicketForm } from "@/components/ticket-form";
import { Dialog, DialogContent, DIALOG_SHEET } from "@/components/ui/dialog";
import { t as tNow, useT } from "@/lib/i18n";
import { toast } from "@/lib/inbox";
import { yt } from "@/lib/yt";
import { saveOneShot } from "./history";
import { useYt } from "./state";

// A new ticket from the YouTrack tab: typed by hand, or a rough note the AI turns into summary / Type / Priority / description.
// Open tickets that look the same are shown before it is created. Same create API as the Telegram composer.

export function CreateTicket() {
  const t = useT();
  const y = useYt();
  const start = y.newTicket ?? "";
  return (
    <Dialog open={y.newTicket != null} onOpenChange={(o) => { if (!o) y.setNewTicket(null); }}>
      <DialogContent className={DIALOG_SHEET}>
        <TicketForm
          title={<>{t("Tạo ticket")} <span className="rounded bg-paper-2 px-1.5 font-mono text-xs font-medium text-ink-2">{y.project}</span></>}
          hint={t("Tự điền, hoặc kể vấn đề cho AI soạn theo mẫu rồi sửa lại trước khi tạo.")}
          initial={{ summary: start.split("\n")[0].slice(0, 200), description: start.includes("\n") ? start : "" }}
          note={start}
          notePlaceholder={t("vd. Màn chốt giá trên Android bấm Ký sau bị crash khi chưa có hợp đồng, máy Samsung A52, bản 3.2.1")}
          aiOn={y.aiOn}
          aiKind="yt"
          aiDraft={async (note, f, signal) => {
            const { done, session } = saveOneShot(tNow("AI · Soạn ticket {project}", { project: y.project }), note, tNow("AI soạn ticket"));
            const d = await yt.aiDraft(note, f.types, f.priorities, signal, session);
            done(`**${d.summary}**\n\n${[d.type && `Type: ${d.type}`, d.priority && `Priority: ${d.priority}`].filter(Boolean).join(" · ")}\n\n${d.description}`);
            return d;
          }}
          onSubmit={async (v) => {
            const r = await createTicket(v);
            toast({ text: r.warning ? `${tNow("Đã tạo {id}", { id: r.id })}. ${r.warning}` : tNow("Đã tạo {id}", { id: r.id }) });
            y.setNewTicket(null);
            y.refresh();
            y.openTicket(r.id);
          }}
          demo={!!y.config?.mock}
        />
      </DialogContent>
    </Dialog>
  );
}
