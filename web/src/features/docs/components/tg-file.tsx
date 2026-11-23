"use client";

import { FileCheck2, FileDiff, FileMinus, FilePlus, FileText, Loader2, MessageCircle, Paperclip, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { errorText, type Message } from "@/shared/lib/api";
import { fmtNum, useT } from "@/shared/lib/i18n";
import { ago } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { allDocsQuery, type Doc, docDetailQuery, docErrors, docs, extOf, READABLE } from "@/features/docs/lib/docs";
import { DocPop, type Tone } from "./doc-pop";
import { DocSheet } from "./doc-sheet";
import { docHref } from "./kb-chip";

// A document attached to a Telegram message, as an attachment chip (name, size, a mark for its state in Tài liệu); a
// hover opens what the library holds under that name and the one thing to do; a click pins that (none / older) or, the
// library holding this file or a newer one, opens its text in place (DocSheet). The state is read from the library list
// already loaded, by file name: nothing is downloaded or read until "Thêm" / "Cập nhật" (library.py add_tg_file).
//   none: "Thêm vào Tài liệu";  this very file (or the same size, or a chosen folder's file of that name): "Mở";
//   another version, sent before this message: "Cập nhật bằng file này" (what changed is recorded, Lịch sử thay đổi);
//   another version sent after it: the library holds the newer one, "Mở bản đó" (no roll back).
// A type the library can't read shows name and size only.

const kb = (n: number) => (n >= 1e6 ? `${fmtNum(Math.round(n / 1e5) / 10)} MB` : `${fmtNum(Math.max(1, Math.round(n / 1e3)))} KB`);
const PILL = "my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-rule bg-paper-2 px-2 py-1 text-xs";

/** The stored document for this file: the one from this message, else the Telegram file of that name, else a folder
 *  file of that name. ponytail: matched by the name as sent; one the server had to rename (odd characters, > 120
 *  characters) reads as missing, and adding it again updates the stored one. */
function match(list: Doc[], m: Message, name: string) {
  const origin = `${m.chat_id}:${m.message_id}`;
  return list.find((d) => d.source === "telegram" && d.origin === origin)
    ?? list.find((d) => d.source === "telegram" && d.ref === name)
    ?? list.find((d) => d.source === "file" && d.title === name);
}

type State = "none" | "have" | "older" | "newer";

function stateOf(d: Doc | undefined, m: Message, size: number): State {
  if (!d) return "none";
  if (d.source === "file" || d.origin === `${m.chat_id}:${m.message_id}` || d.size === size) return "have";
  return d.updated_at && new Date(d.updated_at) > new Date(m.date) ? "newer" : "older";
}

export function TgFile({ m }: { m: Message & { file: NonNullable<Message["file"]> } }) {
  const t = useT();
  const { name, size } = m.file;
  const readable = READABLE.has(extOf(name));
  const list = useQuery({ ...allDocsQuery, staleTime: 60_000, retry: false, enabled: readable });
  const face = (
    <>
      <Paperclip aria-hidden className="size-3.5 shrink-0 text-ink-3" />
      <span className="truncate font-medium text-ink">{name || t("Tệp")}</span>
      {size > 0 && <span className="shrink-0 font-mono tabular-nums text-ink-3">{kb(size)}</span>}
    </>
  );
  if (!readable || !list.data) return (
    <Hint text={readable ? (list.isError ? errorText(list.error, docErrors()) : t("Đang đọc kho tài liệu…")) : t("Tài liệu chưa đọc được loại file này.")}>
      <span tabIndex={0} className={cn(PILL, "cursor-default")}>{face}{!readable && <FileMinus aria-hidden className="size-3.5 shrink-0 text-ink-3" />}</span>
    </Hint>
  );
  return <TgFilePop m={m} doc={match(list.data, m, name)} face={face} />;
}

function TgFilePop({ m, doc: d, face }: { m: Message & { file: NonNullable<Message["file"]> }; doc?: Doc; face: React.ReactNode }) {
  const t = useT();
  const qc = useQueryClient();
  const { name, size } = m.file;
  const st = stateOf(d, m, size);
  const add = useMutation({
    mutationFn: () => docs.addTelegram(m.chat_id, m.message_id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["docs"] }),
    onError: () => {}, // shown in the popover
  });
  const MARK = { none: FilePlus, have: FileCheck2, older: FileDiff, newer: FileCheck2 }[st];
  const tone: Tone = { none: "none", have: "ok", older: "warn", newer: "none" }[st] as Tone;
  const when = d?.updated_at ? ago(d.updated_at) : "";
  const status = {
    none: t("Chưa có trong Tài liệu"),
    have: d?.source === "file" ? t("Có trong thư mục {folder}", { folder: d.folder ?? "" }) : t("Có trong Tài liệu"),
    older: t("Tài liệu đang giữ bản khác cùng tên ({size}, gửi {when})", { size: kb(d?.size ?? 0), when }),
    newer: t("Tài liệu đang giữ bản mới hơn ({size}, gửi {when})", { size: kb(d?.size ?? 0), when }),
  }[st];
  const [reading, setReading] = useState(false); // DocSheet: the stored text in place
  const note = { none: t("Tải file vào kho để đọc, tìm và hỏi AI trong Tài liệu."), have: t("Bấm vào chip để đọc nội dung ngay tại đây."),
    older: t("Thay bằng file này; bản cũ vẫn xem được ở Lịch sử thay đổi."), newer: t("File trong tin này cũ hơn bản đang lưu.") }[st];
  const open = d && (st === "older" ? (
    <Hint text={t("Mở bản đang lưu trong Tài liệu")}>
      <Link href={docHref(d.id)} aria-label={t("Mở bản đang lưu trong Tài liệu")} className={buttonVariants({ size: "icon-sm", variant: "ghost", className: "text-ink-3" })}><FileText /></Link>
    </Hint>
  ) : <Link href={docHref(d.id)} className={buttonVariants({ size: "sm", className: "no-underline" })}>{t("Mở trong Tài liệu")}</Link>);
  const run = (
    <Button type="button" size="sm" aria-busy={add.isPending} disabled={add.isPending} onClick={() => add.mutate()}>
      {add.isPending ? <Loader2 className="animate-spin" /> : st === "older" ? <FileDiff /> : <FilePlus />}
      {add.isPending ? (st === "older" ? t("Đang cập nhật…") : t("Đang thêm…")) : st === "older" ? t("Cập nhật bằng file này") : t("Thêm vào Tài liệu")}
    </Button>
  );
  return (
    <>
    <DocPop label={t("File {name} trong Tài liệu", { name })} onPress={d && (st === "have" || st === "newer") ? () => setReading(true) : undefined}
      trigger={(
        <button type="button" className={cn(PILL, "transition-colors duration-(--dur-micro) hover:border-rule-2 hover:bg-paper-3 data-popup-open:border-rule-2 data-popup-open:bg-paper-3")}>
          {face}<MARK aria-hidden className={cn("size-3.5 shrink-0", st === "have" ? "text-ok" : st === "older" ? "text-warn" : "text-ink-3")} />
        </button>
      )}
      icon={<Paperclip />} title={name || t("Tệp")} sub={size > 0 ? `${kb(size)} · ${t("đính kèm trong tin")}` : t("đính kèm trong tin")}
      tone={tone} status={status} note={note} error={add.error && errorText(add.error, docErrors())}
      secondary={st === "older" ? open : undefined}
      primary={st === "none" || st === "older" ? run : open} />
    <DocSheet id={reading && d ? d.id : null} onClose={() => setReading(false)} />
    </>
  );
}

/** The reader's tools for a file kept from Telegram: the message it came from, and "Gỡ" (nothing else removes it). */
export function TgDocActions({ doc, onRemoved }: { doc: Doc; onRemoved: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [chat, msg] = (doc.origin ?? "").split(":");
  const remove = useMutation({
    mutationFn: () => docs.remove(doc.id),
    onSuccess: () => {
      setAsking(false);
      onRemoved();
      qc.removeQueries({ queryKey: docDetailQuery(doc.id).queryKey }); // gone: no refetch of it into a 404
      void qc.invalidateQueries({ queryKey: ["docs"] });
    },
    onError: () => {}, // shown in the dialog (`error`), which stays open
  });
  return (
    <>
      {chat && msg && (
        <Hint side="bottom" text={t("Mở tin Telegram đã gửi bản file này.")}>
          <Link href={`/?chat=${encodeURIComponent(chat)}&msg=${msg}`} aria-label={t("Tin gốc")} className={buttonVariants({ size: "icon-sm", variant: "ghost" })}>
            <MessageCircle />
          </Link>
        </Hint>
      )}
      <Hint side="bottom" text={t("Gỡ file này khỏi Tài liệu (tin Telegram vẫn còn).")}>
        <Button size="icon-sm" variant="ghost" aria-label={t("Gỡ khỏi Tài liệu")} onClick={() => setAsking(true)}><Trash2 /></Button>
      </Hint>
      <ConfirmDialog open={asking} onOpenChange={(o) => { if (!o) { remove.reset(); setAsking(false); } }}
        title={t("Gỡ {name} khỏi Tài liệu?", { name: doc.title })}
        description={t("Bản lưu, lịch sử thay đổi và tóm tắt của file sẽ mất; tin Telegram vẫn còn để thêm lại.")}
        confirmLabel={t("Gỡ")} busy={remove.isPending} onConfirm={() => remove.mutate()}
        error={remove.error ? errorText(remove.error, docErrors()) : undefined} />
    </>
  );
}
