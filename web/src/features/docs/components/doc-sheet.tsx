"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Markdown } from "@/shared/components/markdown";
import { buttonVariants } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { ago } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { type DocPart, docDetailQuery, docErrors } from "@/features/docs/lib/docs";
import { docHref } from "./kb-chip";

// A library document read in place (Telegram's Tài liệu chips, once the library has it): a page sliding in from the
// right with its text only (no Mục lục, find, AI or history: those are the Tài liệu page's) and "Mở trong Tài liệu"
// to go there on that document. `id` null closes it; the last one stays while it slides out.

/** The parts as one text, each heading once (as the reader shows them). ponytail: drawn in one go; the reader's
 *  placeholders for off-screen parts are not needed at this size of panel unless a ~100KB article proves slow. */
const textOf = (parts: DocPart[]) =>
  parts.map((p, i) => (p.heading && p.heading !== parts[i - 1]?.heading ? `${p.heading}\n\n${p.body}` : p.body)).join("\n\n");

export function DocSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [shown, setShown] = useState(id);
  if (id != null && id !== shown) setShown(id);
  return (
    <Dialog open={id != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn(DIALOG_SHEET, "sm:max-w-3xl")}>{shown != null && <Body id={shown} />}</DialogContent>
    </Dialog>
  );
}

function Body({ id }: { id: number }) {
  const t = useT();
  const q = useQuery(docDetailQuery(id));
  const doc = q.data?.doc;
  const text = useMemo(() => (q.data ? textOf(q.data.parts) : ""), [q.data]);
  return (
    <>
      <DialogHeader className="shrink-0 gap-2 border-b bg-paper-2 px-5 py-4 pr-12">
        <DialogTitle className="line-clamp-2 break-words">{doc ? doc.title || doc.ref : t("Tài liệu")}</DialogTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <DialogDescription className="min-w-0 flex-1 truncate">
            {doc && [doc.source === "youtrack" ? doc.ref : doc.source === "telegram" ? "Telegram" : doc.folder,
              doc.updated_at && t("sửa {when}", { when: ago(doc.updated_at) })].filter(Boolean).join(" · ")}
          </DialogDescription>
          <Link href={docHref(id)} className={buttonVariants({ size: "sm", className: "no-underline" })}>
            {t("Mở trong Tài liệu")}<ArrowUpRight />
          </Link>
        </div>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {q.isError ? <p role="alert" className="text-sm text-error">{errorText(q.error, docErrors())}</p>
          : !q.data ? <div className="grid gap-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-3/4" /></div>
          : <Markdown text={text} className="md-wrap text-md leading-[1.6] text-ink" />}
      </div>
    </>
  );
}
