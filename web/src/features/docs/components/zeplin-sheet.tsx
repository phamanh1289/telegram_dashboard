"use client";

import { ExternalLink, Frame } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { ImageView } from "@/shared/components/markdown";
import { buttonVariants } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { Empty } from "@/shared/components/ui/empty";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { docErrors, docs } from "@/features/docs/lib/docs";

// A Zeplin screen named in the open document (doc-links.tsx): a page sliding in from the right with every screen of
// that name (the same name first: a Web and a Mobile one can share it), its design and "Mở trên Zeplin". The names are
// read from Zeplin once an hour (backend zeplin_names.py); `name` null closes it, the last one stays while it slides out.

export function ZeplinSheet({ name, onClose }: { name: string | null; onClose: () => void }) {
  const t = useT();
  const [shown, setShown] = useState(name);
  if (name && name !== shown) setShown(name);
  return (
    <Dialog open={!!name} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn(DIALOG_SHEET, "sm:max-w-3xl")}>
        <DialogHeader className="shrink-0 border-b bg-paper-2 px-5 py-4">
          <DialogTitle className="flex items-center gap-2"><Frame aria-hidden className="size-4 text-hl-2" /><span className="font-mono">{shown}</span></DialogTitle>
          <DialogDescription>{t("Màn Zeplin có tên này (tên trùng hoặc chứa nó), đọc bằng token Zeplin MCP của bạn.")}</DialogDescription>
        </DialogHeader>
        {shown && <Screens name={shown} />}
      </DialogContent>
    </Dialog>
  );
}

function Screens({ name }: { name: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["docs", "zeplin", name], queryFn: ({ signal }) => docs.zeplin(name, signal), staleTime: 300_000 });
  const wait = useAiWait(q.isPending);
  if (wait) return <AiFetching kind="zeplin" project={name} />; // fills the sheet under its head, the scene in its middle
  return <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-5 py-4">{
    q.isError ? <p role="alert" className="text-sm text-error">{errorText(q.error, docErrors())}</p>
    : !q.data?.length ? <Empty icon={<Frame />} title={t("Không thấy màn Zeplin tên này")}>{t("Tên trong tài liệu có thể đã đổi trên Zeplin, hoặc project chưa chia sẻ với tài khoản Zeplin của bạn.")}</Empty>
    : q.data.map((s) => (
    <section key={`${s.project}/${s.id}`} className="grid gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{s.name}</h3>
        <span className="text-xs text-ink-3">{[s.project_name, s.platform].filter(Boolean).join(" · ")}</span>
        <a href={s.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "xs", variant: "outline", className: "no-underline" })}>
          <ExternalLink />{t("Mở trên Zeplin")}
        </a>
      </div>
      {s.image ? <ImageView src={s.image} alt={s.name} boxClass="justify-self-start" className="max-h-[70dvh] max-w-full rounded-md border border-rule bg-paper-2" />
        : <p className="text-xs text-ink-3">{t("Màn này chưa có ảnh.")}</p>}
    </section>
  ))}</div>;
}
