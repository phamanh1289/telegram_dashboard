"use client";

import { Menu } from "@base-ui/react/menu";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Link2, Loader2, MessageCircleQuestion, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { AiBotIcon } from "@/shared/components/ai/chat";
import { buttonVariants } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { MENU_ACTION, MENU_ITEM, MENU_POPUP } from "@/shared/components/ui/menu";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";
import { addLine } from "@/features/telegram/lib/attach";
import { groupsQuery, sessionId, taskListQuery } from "@/features/telegram/lib/inbox";
import { type DocDetail, docName, docRef } from "@/features/docs/lib/docs";

// "Dùng tài liệu ▾" in the reader's header: put this document to work elsewhere.
// · Đính kèm vào phiên AI: its line goes into the session's box (docRef: a KB article's ID, a file "#DOC<id>", which
//   links.py reads from the library), then the session opens.
// · Hỏi trong Q&A nhóm: the group's Q&A box pre-filled with the KB link (?qa=&ask=, as the YouTrack sheet does).
// · Sao chép link. A file on this machine has no link the team can open: those two are off for it.

const SUB = cn(MENU_ACTION, MENU_ITEM, "text-sm");

export function UseDoc({ doc }: { doc: DocDetail["doc"] }) {
  const t = useT();
  const router = useRouter();
  const name = docName(doc);
  const line = t("Đọc tài liệu {ref} ({title})", { ref: docRef(doc), title: name });
  const copy = () => navigator.clipboard.writeText(doc.url ?? "").then(
    () => toast({ text: t("Đã chép link tài liệu") }),
    () => toast({ text: t("Không chép được link, mở Bản gốc để lấy") }),
  );
  return (
    <Menu.Root>
      <Hint side="bottom" text={t("Đính kèm tài liệu này vào phiên AI Agent, hỏi team trong Q&A nhóm kèm link, hoặc chép link.")}>
        <Menu.Trigger aria-label={t("Dùng tài liệu")} className={buttonVariants({ size: "sm", variant: "ghost", className: "gap-0.5 px-1.5" })}>
          <Paperclip /><ChevronDown className="size-3 text-ink-3" />
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          <Menu.Popup className={cn(MENU_POPUP, "w-64")}>
            <Sub icon={<AiBotIcon />} label={t("Đính kèm vào phiên AI")}><Sessions onPick={(id) => { addLine(id, line); router.push(`/?task=${id}`); }} /></Sub>
            {doc.url ? <>
              <Sub icon={<MessageCircleQuestion />} label={t("Hỏi trong Q&A nhóm")}>
                <Groups onPick={(chat) => router.push(`/?qa=${encodeURIComponent(chat)}&ask=${encodeURIComponent(`${name}\n${doc.url}\n\n`)}`)} />
              </Sub>
              <Menu.Item className={SUB} onClick={() => void copy()}><Link2 />{t("Sao chép link")}</Menu.Item>
            </> : doc.source === "file" && (
              <p className="px-2.5 py-1.5 text-xs leading-relaxed text-ink-3">{t("File trên máy không có link cho team mở: chỉ đính kèm được vào phiên AI.")}</p>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Sub({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={SUB}>{icon}<span className="min-w-0 flex-1 truncate">{label}</span><ChevronRight /></Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} className="z-50 outline-none">
          <Menu.Popup aria-label={label} className={cn(MENU_POPUP, "max-h-80 w-72 overflow-y-auto")}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

/** Open AI Agent sessions (Giao AI Agent, Đối chiếu BE), as the message clip lists them; Trợ lý AI reads no links. */
function Sessions({ onPick }: { onPick: (id: string) => void }) {
  const t = useT();
  const q = useQuery(taskListQuery);
  const open = (q.data ?? []).filter((tk) => tk.mode !== "terminal" && !tk.handled && tk.kind !== "assist").slice(0, 8);
  if (q.isPending) return <Wait />;
  if (q.isError) return <Note error>{errorText(q.error, {}, t("Không tải được danh sách phiên"))}</Note>;
  if (!open.length) return <Note>{t("Chưa có phiên AI Agent nào đang làm (Doing).")}</Note>;
  return open.map((tk) => (
    <Menu.Item key={tk.id} onClick={() => onPick(tk.id)} className={cn("grid gap-0.5", MENU_ITEM)}>
      <span className="truncate text-sm font-medium text-ink">{tk.title || tk.message_text || tk.prompt}</span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
        {tk.running && <Loader2 className="-mr-1 size-3 shrink-0 animate-spin text-hl-2" aria-label={t("Đang chạy")} />}
        <span className="shrink-0 font-mono tabular-nums">{sessionId(tk)}</span>
        <span className="shrink-0">{tk.kind === "deep" ? t("Đối chiếu BE") : t("Giao AI Agent")}</span>
        <span className="truncate">{tk.chat_title || tk.project.split("/").pop()}</span>
      </span>
    </Menu.Item>
  ));
}

function Groups({ onPick }: { onPick: (chatId: string) => void }) {
  const t = useT();
  const q = useQuery(groupsQuery);
  if (q.isPending) return <Wait />;
  if (q.isError) return <Note error>{errorText(q.error, { not_connected: t("Chưa kết nối Telegram") }, t("Không tải được danh sách nhóm"))}</Note>;
  if (!q.data.length) return <Note>{t("Chưa theo dõi nhóm Telegram nào.")}</Note>;
  return q.data.map((g) => (
    <Menu.Item key={g.chat_id} onClick={() => onPick(g.chat_id)} className={cn("truncate text-sm text-ink", MENU_ITEM)}>{g.title}</Menu.Item>
  ));
}

const Wait = () => <p className="flex justify-center py-2 text-ink-3"><Loader2 className="size-4 animate-spin" aria-hidden /></p>;
const Note = ({ children, error }: { children: ReactNode; error?: boolean }) => (
  <p role={error ? "alert" : undefined} className={cn("px-2.5 py-1.5 text-xs leading-relaxed", error ? "text-error" : "text-ink-2")}>{children}</p>
);
